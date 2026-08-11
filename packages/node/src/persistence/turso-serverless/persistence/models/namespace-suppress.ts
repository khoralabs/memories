import type { MemoryOpContext } from "../../../../persistence/core";
import { namespacePathFromStored } from "../../../../persistence/core/models/namespace-path";
import type { DbCtx } from "../context";
import type { TursoDatabase } from "../db";
import { ctxExec, ctxQueryOne, readQueryOne } from "../db";

/**
 * Closest covering suppressed namespace (self or ancestor): longest matching `_id`.
 * `null` when none apply.
 */
export async function findClosestSuppressedNamespace(
  db: TursoDatabase,
  namespace: string,
): Promise<string | null> {
  const ns = namespacePathFromStored(namespace);
  const row = await readQueryOne<{ namespace: string }>(
    db,
    `SELECT _id AS namespace FROM namespace_metadata
     WHERE suppressed != 0
       AND (_id = ? OR ? LIKE _id || '/%')
     ORDER BY length(_id) DESC
     LIMIT 1`,
    [ns, ns],
  );
  return row?.namespace ?? null;
}

/** True when `namespace` equals a suppressed path or is a descendant of one. */
export async function isNamespaceSuppressed(
  db: TursoDatabase,
  namespace: string,
): Promise<boolean> {
  return (await findClosestSuppressedNamespace(db, namespace)) != null;
}

export async function setNamespaceSuppressed(
  ctx: DbCtx,
  op: MemoryOpContext,
  input: { namespace: string; suppressed: boolean },
): Promise<void> {
  const ns = namespacePathFromStored(input.namespace);
  const existing = await ctxQueryOne<{ alias: string | null; description: string }>(
    ctx,
    `SELECT display_name AS alias, description FROM namespace_metadata WHERE _id = ?`,
    [ns],
  );
  const flag = input.suppressed ? 1 : 0;
  if (existing) {
    await ctxExec(
      ctx,
      `UPDATE namespace_metadata SET suppressed = ?, _ts_updated = ? WHERE _id = ?`,
      [flag, op.now, ns],
    );
    return;
  }
  await ctxExec(
    ctx,
    `INSERT INTO namespace_metadata (_id, display_name, description, suppressed, _ts_created, _ts_updated)
     VALUES (?, NULL, '', ?, ?, ?)`,
    [ns, flag, op.now, op.now],
  );
}
