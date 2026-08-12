import type { Database } from "bun:sqlite";
import { sqlNamespaceEqualsOrUnderPrefix } from "../../../../persistence/core";
import { namespacePathFromStored } from "../../../../persistence/core/models/namespace-path";
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
  const ns = namespacePathFromStored(namespace);
  const row = db
    .query<{ namespace: string }, [string, string]>(
      `SELECT _id AS namespace FROM namespace_metadata
       WHERE suppressed != 0
         AND (? = _id OR substr(?, 1, length(_id) + 1) = _id || '/')
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
  const ns = namespacePathFromStored(input.namespace);
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

/** Resolve canonical alias from upsert input. */
export function resolveAliasPatch(input: { alias?: string | null }): string | null | undefined {
  if (input.alias !== undefined) return input.alias;
  return undefined;
}

/** Metadata row for one namespace, or `undefined` if none. */
export function getNamespaceMetadata(
  db: Database,
  namespace: string,
): NamespaceMetadataInfo | undefined {
  const ns = namespacePathFromStored(namespace);
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

/**
 * Catalog rows under a path-boundary prefix (`= prefix` or nested under `prefix/`).
 * Same row shape and suppression rules as {@link listNamespacesWithMetadata}.
 */
export function listNamespacesWithMetadataUnderPrefix(
  db: Database,
  prefix: string,
  opts?: { includeSuppressed?: boolean },
): NamespaceMetadataInfo[] {
  const root = namespacePathFromStored(prefix);
  const include = opts?.includeSuppressed === true;
  const byKey = new Map<string, NamespaceMetadataInfo>();
  for (const { namespace } of db
    .query<{ namespace: string }, [string, string, string]>(
      `SELECT DISTINCT namespace FROM memories
       WHERE ${sqlNamespaceEqualsOrUnderPrefix("namespace")}`,
    )
    .all(root, root, root)) {
    if (!include && isNamespaceSuppressed(db, namespace)) continue;
    byKey.set(namespace, { namespace, alias: null, description: "", suppressed: false });
  }
  for (const row of db
    .query<NamespaceMetadataRow & { suppressed: number }, [string, string, string]>(
      `SELECT _id AS id, display_name AS alias, description, suppressed FROM namespace_metadata
       WHERE ${sqlNamespaceEqualsOrUnderPrefix("_id")}`,
    )
    .all(root, root, root)) {
    if (!include && isNamespaceSuppressed(db, row.id)) continue;
    byKey.set(row.id, rowToInfo(row));
  }
  return [...byKey.values()].sort((a, b) => a.namespace.localeCompare(b.namespace));
}

/**
 * True when at least one catalog path exists under the path-boundary prefix
 * (after the same suppression filter as {@link listNamespacesWithMetadata}).
 */
export function namespaceExistsUnderPrefix(
  db: Database,
  prefix: string,
  opts?: { includeSuppressed?: boolean },
): boolean {
  const root = namespacePathFromStored(prefix);
  const include = opts?.includeSuppressed === true;
  for (const { namespace } of db
    .query<{ namespace: string }, [string, string, string]>(
      `SELECT DISTINCT namespace FROM memories
       WHERE ${sqlNamespaceEqualsOrUnderPrefix("namespace")}`,
    )
    .all(root, root, root)) {
    if (include || !isNamespaceSuppressed(db, namespace)) return true;
  }
  for (const { id } of db
    .query<{ id: string }, [string, string, string]>(
      `SELECT _id AS id FROM namespace_metadata
       WHERE ${sqlNamespaceEqualsOrUnderPrefix("_id")}`,
    )
    .all(root, root, root)) {
    if (include || !isNamespaceSuppressed(db, id)) return true;
  }
  return false;
}

/** Upsert display metadata for a namespace path. */
export function upsertNamespaceMetadata(
  db: Database,
  op: MemoryOpContext,
  input: {
    namespace: string;
    alias?: string | null;
    description?: string;
  },
): void {
  const ns = namespacePathFromStored(input.namespace);
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
  const ns = namespacePathFromStored(namespace);
  db.run(`DELETE FROM namespace_metadata WHERE _id = ?`, [ns]);
}

/** Memory keys in one primary namespace. */
export function listMemoryKeysInNamespace(db: Database, namespace: string): string[] {
  const ns = namespacePathFromStored(namespace);
  return db
    .query<{ key: string }, [string]>(`SELECT key FROM memories WHERE namespace = ?`)
    .all(ns)
    .map((r) => r.key);
}
