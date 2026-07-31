import type { Database } from "bun:sqlite";
import { namespacePath } from "../../../../persistence/core/models/namespace-path";
import type {
  MemoryOpContext,
  NamespaceMetadataInfo,
} from "../../../../persistence/core/persistence/types";

type NamespaceMetadataRow = {
  id: string;
  displayName: string | null;
  description: string;
};

function rowToInfo(row: NamespaceMetadataRow): NamespaceMetadataInfo {
  return {
    namespace: row.id,
    displayName: row.displayName,
    description: row.description,
  };
}

/** Metadata row for one namespace, or `undefined` if none. */
export function getNamespaceMetadata(
  db: Database,
  namespace: string,
): NamespaceMetadataInfo | undefined {
  const ns = namespacePath(namespace);
  const row = db
    .query<NamespaceMetadataRow, [string]>(
      `SELECT _id AS id, display_name AS displayName, description
       FROM namespace_metadata WHERE _id = ?`,
    )
    .get(ns);
  return row ? rowToInfo(row) : undefined;
}

/**
 * Union of namespaces with memories and/or metadata, sorted by path.
 * Memory-only keys get `displayName: null` and empty `description`.
 */
export function listNamespacesWithMetadata(db: Database): NamespaceMetadataInfo[] {
  const byKey = new Map<string, NamespaceMetadataInfo>();
  for (const { namespace } of db
    .query<{ namespace: string }, []>(`SELECT DISTINCT namespace FROM memories`)
    .all()) {
    byKey.set(namespace, { namespace, displayName: null, description: "" });
  }
  for (const row of db
    .query<NamespaceMetadataRow, []>(
      `SELECT _id AS id, display_name AS displayName, description FROM namespace_metadata`,
    )
    .all()) {
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
    displayName?: string | null;
    description?: string;
  },
): void {
  const ns = namespacePath(input.namespace);
  const existing = db
    .query<{ displayName: string | null; description: string }, [string]>(
      `SELECT display_name AS displayName, description FROM namespace_metadata WHERE _id = ?`,
    )
    .get(ns);

  const displayName =
    input.displayName !== undefined ? input.displayName : (existing?.displayName ?? null);
  const description =
    input.description !== undefined ? input.description : (existing?.description ?? "");

  if (existing) {
    db.run(
      `UPDATE namespace_metadata
       SET display_name = ?, description = ?, _ts_updated = ?
       WHERE _id = ?`,
      [displayName, description, op.now, ns],
    );
    return;
  }
  db.run(
    `INSERT INTO namespace_metadata (_id, display_name, description, _ts_created, _ts_updated)
     VALUES (?, ?, ?, ?, ?)`,
    [ns, displayName, description, op.now, op.now],
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
