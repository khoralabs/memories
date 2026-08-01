import type { MemoryOpContext } from "../../../../persistence/core";
import { namespacePath } from "../../../../persistence/core/models/namespace-path";
import type { DbCtx } from "../context";
import type { LibsqlDatabase } from "../db";
import { ctxExec, ctxQueryOne, readQueryOne } from "../db";

/** True when `namespace` equals a suppressed path or is a descendant of one. */
export async function isNamespaceSuppressed(
  db: LibsqlDatabase,
  namespace: string,
): Promise<boolean> {
  const ns = namespacePath(namespace);
  const row = await readQueryOne<{ ok: number }>(
    db,
    `SELECT 1 AS ok FROM namespace_metadata
     WHERE suppressed != 0
       AND (_id = ? OR ? LIKE _id || '/%')
     LIMIT 1`,
    [ns, ns],
  );
  return row != null;
}

export async function setNamespaceSuppressed(
  ctx: DbCtx,
  op: MemoryOpContext,
  input: { namespace: string; suppressed: boolean },
): Promise<void> {
  const ns = namespacePath(input.namespace);
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
