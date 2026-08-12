import {
  asOfSqlClause,
  canonicalizeNamespacePrefixes,
  namespacePathFromStored,
  type SearchAsOf,
  type SearchNamespaceScope,
  sqlNamespaceEqualsOrUnderPrefix,
  sqlNamespaceEqualsOrUnderPrefixCol,
} from "../../../persistence/core";

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export function vector32Json(vector: Float32Array | readonly number[]): string {
  const values = vector instanceof Float32Array ? Array.from(vector) : vector;
  return JSON.stringify(values);
}

export function vectorByteLength(dim: number): number {
  return dim * Float32Array.BYTES_PER_ELEMENT;
}

export function parsePropsColumn(raw: unknown): Record<string, unknown> {
  if (raw == null || raw === "") return {};
  if (typeof raw === "string") {
    try {
      const o = JSON.parse(raw) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

/**
 * FTS5 MATCH string: AND-combines whitespace-separated tokens as phrase terms.
 * Porter stemming comes from the FTS tokenizer, not the query builder.
 */
export function buildFtsMatchFromUserText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const clauses = tokens.map((raw) => {
    const tok = raw.replace(/"/g, '""');
    if (tok.length >= 3 && /^[\p{L}\p{N}]+$/u.test(raw)) {
      return `("${tok}" OR ${tok}*)`;
    }
    return `"${tok}"`;
  });
  return clauses.join(" AND ");
}

export function namespaceSubtreeOrClauses(
  namespaces: readonly string[],
  tableAlias?: string,
): { sql: string; bindings: unknown[] } {
  const roots = canonicalizeNamespacePrefixes(namespaces.map((n) => namespacePathFromStored(n)));
  if (roots.length === 0) {
    return { sql: "1 = 0", bindings: [] };
  }
  const parts: string[] = [];
  const bindings: unknown[] = [];
  const col = tableAlias ? `${tableAlias}.namespace` : "namespace";
  for (const root of roots) {
    parts.push(sqlNamespaceEqualsOrUnderPrefix(col));
    bindings.push(root, root, root);
  }
  return { sql: parts.join(" OR "), bindings };
}

/** Hide suppressed memories, suppressed namespaces (self/ancestor), and edges to suppressed endpoints. */
function memoryDiscoveryVisibleSql(tableAlias?: string): string {
  // Default to `memories.` so EXISTS joins to other memories rows stay unambiguous.
  const prefix = tableAlias ?? "memories";
  const col = (name: string) => `${prefix}.${name}`;
  return `${col("suppressed")} = 0
    AND NOT EXISTS (
      SELECT 1 FROM namespace_metadata nm
      WHERE nm.suppressed != 0
        AND ${sqlNamespaceEqualsOrUnderPrefixCol(col("namespace"), "nm._id")}
    )
    AND NOT (
      ${col("kind")} = 'edge' AND ${col("edge_id")} IS NOT NULL AND EXISTS (
        SELECT 1
        FROM edges e
        JOIN nodes n_from ON n_from._id = e.from_node_id
        JOIN nodes n_to ON n_to._id = e.to_node_id
        JOIN memories m_from ON m_from._id = n_from.memory_id
        JOIN memories m_to ON m_to._id = n_to.memory_id
        WHERE e._id = ${col("edge_id")}
          AND (
            m_from.suppressed != 0 OR m_to.suppressed != 0
            OR EXISTS (
              SELECT 1 FROM namespace_metadata nm
              WHERE nm.suppressed != 0
                AND (
                  ${sqlNamespaceEqualsOrUnderPrefixCol("m_from.namespace", "nm._id")}
                  OR ${sqlNamespaceEqualsOrUnderPrefixCol("m_to.namespace", "nm._id")}
                )
            )
          )
      )
    )`;
}

export function memoriesWhereClauseFromScope(
  scope: SearchNamespaceScope,
  memoryIds: string[] | undefined,
  asOf?: SearchAsOf,
  tableAlias?: string,
  includeSuppressed?: boolean,
): { sql: string; bindings: unknown[] } {
  const col = (name: string) => (tableAlias ? `${tableAlias}.${name}` : name);
  const visible = includeSuppressed === true ? "" : ` AND ${memoryDiscoveryVisibleSql(tableAlias)}`;
  const { sql: asOfClause, bindings: asOfBind } = asOfSqlClause(asOf, col("_ts_created"));

  const idClause =
    memoryIds === undefined ? "" : ` AND ${col("_id")} IN (${placeholders(memoryIds.length)})`;
  const idBindings: unknown[] = memoryIds === undefined ? [] : [...memoryIds];

  if (scope.kind === "unscoped") {
    return {
      sql: `1 = 1${idClause}${asOfClause}${visible}`,
      bindings: [...idBindings, ...asOfBind],
    };
  }

  if (scope.kind === "pathSubtree") {
    const ns = scope.namespaces;
    if (ns.length === 0) {
      return { sql: "1 = 0", bindings: [] };
    }
    const { sql: nsOr, bindings: nsBindings } = namespaceSubtreeOrClauses(ns, tableAlias);
    return {
      sql: `(${nsOr})${idClause}${asOfClause}${visible}`,
      bindings: [...nsBindings, ...idBindings, ...asOfBind],
    };
  }

  if (scope.kind === "exactScope") {
    const ss = scope.scopes.map((s) => namespacePathFromStored(s));
    if (ss.length === 0) {
      return { sql: "1 = 0", bindings: [] };
    }
    return {
      sql: `${col("_id")} IN (
        SELECT memory_id FROM memory_scopes
        WHERE scope_id IN (${placeholders(ss.length)})
      )${idClause}${asOfClause}${visible}`,
      bindings: [...ss, ...idBindings, ...asOfBind],
    };
  }

  const roots = scope.roots.map((r) => namespacePathFromStored(r));
  if (roots.length === 0) {
    return { sql: "1 = 0", bindings: [] };
  }
  return {
    sql: `${col("_id")} IN (
      SELECT DISTINCT ms.memory_id
      FROM memory_scopes ms
      INNER JOIN scope_closure c ON c.descendant_scope_id = ms.scope_id
      WHERE c.ancestor_scope_id IN (${placeholders(roots.length)})
    )${idClause}${asOfClause}${visible}`,
    bindings: [...roots, ...idBindings, ...asOfBind],
  };
}

export function memoryIdSubqueryFromScope(
  scope: SearchNamespaceScope,
  memoryIds: string[] | undefined,
  asOf?: SearchAsOf,
  featureAlias?: string,
  includeSuppressed?: boolean,
): { sql: string; bindings: unknown[] } {
  const { sql: innerSql, bindings } = memoriesWhereClauseFromScope(
    scope,
    memoryIds,
    asOf,
    "memories",
    includeSuppressed,
  );
  const memoryCol = featureAlias ? `${featureAlias}.memory_id` : "memory_id";
  return {
    sql: `${memoryCol} IN (SELECT _id FROM memories WHERE ${innerSql})`,
    bindings,
  };
}
