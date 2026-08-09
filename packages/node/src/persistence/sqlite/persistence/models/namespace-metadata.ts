import type { Database } from "bun:sqlite";
import { namespacePath } from "../../../../persistence/core/models/namespace-path";
import type {
  MemoryOpContext,
  NamespaceMetadataInfo,
} from "../../../../persistence/core/persistence/types";

type NamespaceMetadataRow = {
  id: string;
  alias: string | null;
  description: string;
};

function rowToInfo(row: NamespaceMetadataRow & { suppressed?: number }): NamespaceMetadataInfo {
  return {
    namespace: row.id,
    alias: row.alias,
    description: row.description,
    suppressed: row.suppressed !== undefined && row.suppressed !== 0,
  };
}

/**
 * Closest covering suppressed namespace (self or ancestor): longest matching `_id`.
 * `null` when none apply.
 */
export function findClosestSuppressedNamespace(db: Database, namespace: string): string | null {
  const ns = namespacePath(namespace);
  const row = db
    .query<{ namespace: string }, [string, string]>(
      `SELECT _id AS namespace FROM namespace_metadata
       WHERE suppressed != 0
         AND (_id = ? OR ? LIKE _id || '/%')
       ORDER BY length(_id) DESC
       LIMIT 1`,
    )
    .get(ns, ns);
  return row?.namespace ?? null;
}

/** True when `namespace` equals a suppressed path or is a descendant of one. */
export function isNamespaceSuppressed(db: Database, namespace: string): boolean {
  return findClosestSuppressedNamespace(db, namespace) != null;
}

/**
 * Ensure a metadata row exists and set/clear exact-path suppression.
 * Does not fan out to children; discovery inherits via ancestor checks.
 */
export function setNamespaceSuppressed(
  db: Database,
  op: MemoryOpContext,
  input: { namespace: string; suppressed: boolean },
): void {
  const ns = namespacePath(input.namespace);
  const existing = db
    .query<{ alias: string | null; description: string }, [string]>(
      `SELECT display_name AS alias, description FROM namespace_metadata WHERE _id = ?`,
    )
    .get(ns);
  const flag = input.suppressed ? 1 : 0;
  if (existing) {
    db.run(`UPDATE namespace_metadata SET suppressed = ?, _ts_updated = ? WHERE _id = ?`, [
      flag,
      op.now,
      ns,
    ]);
    return;
  }
  db.run(
    `INSERT INTO namespace_metadata (_id, display_name, description, suppressed, _ts_created, _ts_updated)
     VALUES (?, NULL, '', ?, ?, ?)`,
    [ns, flag, op.now, op.now],
  );
}

/** Resolve canonical alias from upsert input (`alias` wins over deprecated `displayName`). */
export function resolveAliasPatch(input: {
  alias?: string | null;
  displayName?: string | null;
}): string | null | undefined {
  if (input.alias !== undefined) return input.alias;
  if (input.displayName !== undefined) return input.displayName;
  return undefined;
}

/** Metadata row for one namespace, or `undefined` if none. */
export function getNamespaceMetadata(
  db: Database,
  namespace: string,
): NamespaceMetadataInfo | undefined {
  const ns = namespacePath(namespace);
  const row = db
    .query<NamespaceMetadataRow & { suppressed: number }, [string]>(
      `SELECT _id AS id, display_name AS alias, description, suppressed
       FROM namespace_metadata WHERE _id = ?`,
    )
    .get(ns);
  return row ? rowToInfo(row) : undefined;
}

/**
 * Union of namespaces with memories and/or metadata, sorted by path.
 * Memory-only keys get `alias: null` and empty `description`.
 */
export function listNamespacesWithMetadata(
  db: Database,
  opts?: { includeSuppressed?: boolean },
): NamespaceMetadataInfo[] {
  const include = opts?.includeSuppressed === true;
  const byKey = new Map<string, NamespaceMetadataInfo>();
  for (const { namespace } of db
    .query<{ namespace: string }, []>(`SELECT DISTINCT namespace FROM memories`)
    .all()) {
    if (!include && isNamespaceSuppressed(db, namespace)) continue;
    byKey.set(namespace, { namespace, alias: null, description: "", suppressed: false });
  }
  for (const row of db
    .query<NamespaceMetadataRow & { suppressed: number }, []>(
      `SELECT _id AS id, display_name AS alias, description, suppressed FROM namespace_metadata`,
    )
    .all()) {
    if (!include && isNamespaceSuppressed(db, row.id)) continue;
    byKey.set(row.id, rowToInfo(row));
  }
  return [...byKey.values()].sort((a, b) => a.namespace.localeCompare(b.namespace));
}

/** Upsert display metadata for a namespace path. */
export function upsertNamespaceMetadata(
  db: Database,
  op: MemoryOpContext,
  input: {
    namespace: string;
    alias?: string | null;
    displayName?: string | null;
    description?: string;
  },
): void {
  const ns = namespacePath(input.namespace);
  const existing = db
    .query<{ alias: string | null; description: string }, [string]>(
      `SELECT display_name AS alias, description FROM namespace_metadata WHERE _id = ?`,
    )
    .get(ns);

  const aliasPatch = resolveAliasPatch(input);
  const alias = aliasPatch !== undefined ? aliasPatch : (existing?.alias ?? null);
  const description =
    input.description !== undefined ? input.description : (existing?.description ?? "");

  if (existing) {
    db.run(
      `UPDATE namespace_metadata
       SET display_name = ?, description = ?, _ts_updated = ?
       WHERE _id = ?`,
      [alias, description, op.now, ns],
    );
    return;
  }
  db.run(
    `INSERT INTO namespace_metadata (_id, display_name, description, _ts_created, _ts_updated)
     VALUES (?, ?, ?, ?, ?)`,
    [ns, alias, description, op.now, op.now],
  );
}

/** Remove metadata row; no-op if missing. */
export function deleteNamespaceMetadata(
  db: Database,
  _op: MemoryOpContext,
  namespace: string,
): void {
  const ns = namespacePath(namespace);
  db.run(`DELETE FROM namespace_metadata WHERE _id = ?`, [ns]);
}

/** Memory keys in one primary namespace. */
export function listMemoryKeysInNamespace(db: Database, namespace: string): string[] {
  const ns = namespacePath(namespace);
  return db
    .query<{ key: string }, [string]>(`SELECT key FROM memories WHERE namespace = ?`)
    .all(ns)
    .map((r) => r.key);
}
