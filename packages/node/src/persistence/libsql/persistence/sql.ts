import {
  canonicalizeNamespacePrefixes,
  namespacePath,
  namespacePrefixFieldForDepth,
  namespaceSegments,
  type SearchNamespaceScope,
} from "@khoralabs/memories-persistence-core";

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
  const roots = canonicalizeNamespacePrefixes(namespaces.map((n) => namespacePath(n)));
  if (roots.length === 0) {
    return { sql: "1 = 0", bindings: [] };
  }
  const parts: string[] = [];
  const bindings: unknown[] = [];
  for (const root of roots) {
    const depth = namespaceSegments(root).length;
    const key = namespacePrefixFieldForDepth(depth);
    const col = tableAlias ? `${tableAlias}.${key}` : key;
    parts.push(`(${col} = ?)`);
    bindings.push(root);
  }
  return { sql: parts.join(" OR "), bindings };
}

export function memoriesWhereClauseFromScope(
  scope: SearchNamespaceScope,
  memoryIds: string[] | undefined,
  asOfTimestampMs?: number,
  tableAlias?: string,
): { sql: string; bindings: unknown[] } {
  const col = (name: string) => (tableAlias ? `${tableAlias}.${name}` : name);
  const asOfClause = asOfTimestampMs !== undefined ? ` AND ${col("_ts_created")} <= ?` : "";
  const asOfBind: unknown[] = asOfTimestampMs !== undefined ? [asOfTimestampMs] : [];

  const idClause =
    memoryIds === undefined ? "" : ` AND ${col("_id")} IN (${placeholders(memoryIds.length)})`;
  const idBindings: unknown[] = memoryIds === undefined ? [] : [...memoryIds];

  if (scope.kind === "unscoped") {
    return {
      sql: `1 = 1${idClause}${asOfClause}`,
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
      sql: `(${nsOr})${idClause}${asOfClause}`,
      bindings: [...nsBindings, ...idBindings, ...asOfBind],
    };
  }

  if (scope.kind === "exactScope") {
    const ss = scope.scopes.map((s) => namespacePath(s));
    if (ss.length === 0) {
      return { sql: "1 = 0", bindings: [] };
    }
    return {
      sql: `${col("_id")} IN (
        SELECT memory_id FROM memory_scopes
        WHERE scope_id IN (${placeholders(ss.length)})
      )${idClause}${asOfClause}`,
      bindings: [...ss, ...idBindings, ...asOfBind],
    };
  }

  const roots = scope.roots.map((r) => namespacePath(r));
  if (roots.length === 0) {
    return { sql: "1 = 0", bindings: [] };
  }
  return {
    sql: `${col("_id")} IN (
      SELECT DISTINCT ms.memory_id
      FROM memory_scopes ms
      INNER JOIN scope_closure c ON c.descendant_scope_id = ms.scope_id
      WHERE c.ancestor_scope_id IN (${placeholders(roots.length)})
    )${idClause}${asOfClause}`,
    bindings: [...roots, ...idBindings, ...asOfBind],
  };
}

export function memoryIdSubqueryFromScope(
  scope: SearchNamespaceScope,
  memoryIds: string[] | undefined,
  asOfTimestampMs?: number,
  featureAlias?: string,
): { sql: string; bindings: unknown[] } {
  const { sql: innerSql, bindings } = memoriesWhereClauseFromScope(
    scope,
    memoryIds,
    asOfTimestampMs,
    "memories",
  );
  const memoryCol = featureAlias ? `${featureAlias}.memory_id` : "memory_id";
  return {
    sql: `${memoryCol} IN (SELECT _id FROM memories WHERE ${innerSql})`,
    bindings,
  };
}
