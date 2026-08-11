import { namespacePathFromStored, stableId } from "../../../../persistence/core";
import { memoriesPersistenceDocumentSchema } from "../../../../persistence/core/persistence";
import { documentValidator } from "../_lib";
import type { DbCtx } from "../context";
import { ctxExec, ctxQueryAll, ctxQueryOne } from "../db";

async function parseAdjacency(ctx: DbCtx): Promise<Map<string, string[]>> {
  const rows = await ctxQueryAll<{ parent_scope_id: string; child_scope_id: string }>(
    ctx,
    `SELECT parent_scope_id, child_scope_id FROM scope_edges`,
  );
  const adj = new Map<string, string[]>();
  for (const r of rows) {
    const list = adj.get(r.parent_scope_id) ?? [];
    list.push(r.child_scope_id);
    adj.set(r.parent_scope_id, list);
  }
  return adj;
}

function dfsReachable(start: string, adj: Map<string, string[]>): Set<string> {
  const stack = [start];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const u = stack.pop();
    if (u === undefined || seen.has(u)) continue;
    seen.add(u);
    for (const v of adj.get(u) ?? []) {
      if (!seen.has(v)) stack.push(v);
    }
  }
  return seen;
}

export async function rebuildScopeClosure(ctx: DbCtx): Promise<void> {
  await ctxExec(ctx, `DELETE FROM scope_closure`);

  const scopeRows = await ctxQueryAll<{ _id: string }>(ctx, `SELECT _id FROM scopes`);
  if (scopeRows.length === 0) return;

  const adj = await parseAdjacency(ctx);
  const doc = documentValidator(memoriesPersistenceDocumentSchema, "scope_closure");

  for (const { _id: ancestor } of scopeRows) {
    const descendants = dfsReachable(ancestor, adj);
    for (const descendant of descendants) {
      const rowId = stableId("sclo", ancestor, descendant);
      doc.parse({
        _id: rowId,
        _ts_created: ctx.now,
        ancestor_scope_id: ancestor,
        descendant_scope_id: descendant,
      });
      await ctxExec(
        ctx,
        `INSERT OR REPLACE INTO scope_closure (_id, _ts_created, ancestor_scope_id, descendant_scope_id)
         VALUES (?, ?, ?, ?)`,
        [rowId, ctx.now, ancestor, descendant],
      );
    }
  }
}

export async function upsertScope(ctx: DbCtx, input: { scopeId: string }): Promise<void> {
  const scopeId = namespacePathFromStored(input.scopeId);
  const doc = documentValidator(memoriesPersistenceDocumentSchema, "scopes");
  doc.parse({
    _id: scopeId,
    _ts_created: ctx.now,
  });
  await ctxExec(ctx, `INSERT OR IGNORE INTO scopes (_id, _ts_created) VALUES (?, ?)`, [
    scopeId,
    ctx.now,
  ]);
}

async function pathWouldCreateCycle(ctx: DbCtx, parent: string, child: string): Promise<boolean> {
  if (parent === child) return true;
  const adj = await parseAdjacency(ctx);
  return dfsReachable(child, adj).has(parent);
}

export async function linkScopes(
  ctx: DbCtx,
  input: { parentScopeId: string; childScopeId: string },
): Promise<void> {
  const parent = namespacePathFromStored(input.parentScopeId);
  const child = namespacePathFromStored(input.childScopeId);
  await upsertScope(ctx, { scopeId: parent });
  await upsertScope(ctx, { scopeId: child });

  const exists = await ctxQueryOne<{ _id: string }>(
    ctx,
    `SELECT _id FROM scope_edges WHERE parent_scope_id = ? AND child_scope_id = ?`,
    [parent, child],
  );
  if (exists) {
    await rebuildScopeClosure(ctx);
    return;
  }

  if (await pathWouldCreateCycle(ctx, parent, child)) {
    throw new Error(`linkScopes: would create cycle (${parent} → ${child})`);
  }

  const edgeDoc = documentValidator(memoriesPersistenceDocumentSchema, "scope_edges");
  const edgeId = stableId("sce", parent, child);
  edgeDoc.parse({
    _id: edgeId,
    _ts_created: ctx.now,
    parent_scope_id: parent,
    child_scope_id: child,
  });
  await ctxExec(
    ctx,
    `INSERT OR REPLACE INTO scope_edges (_id, _ts_created, parent_scope_id, child_scope_id)
     VALUES (?, ?, ?, ?)`,
    [edgeId, ctx.now, parent, child],
  );
  await rebuildScopeClosure(ctx);
}

export async function unlinkScopeEdge(
  ctx: DbCtx,
  input: { parentScopeId: string; childScopeId: string },
): Promise<void> {
  const parent = namespacePathFromStored(input.parentScopeId);
  const child = namespacePathFromStored(input.childScopeId);
  await ctxExec(ctx, `DELETE FROM scope_edges WHERE parent_scope_id = ? AND child_scope_id = ?`, [
    parent,
    child,
  ]);
  await rebuildScopeClosure(ctx);
}

export async function replaceMemoryScopes(
  ctx: DbCtx,
  input: { memoryId: string; scopeIds: readonly string[] },
): Promise<void> {
  const { memoryId } = input;
  await ctxExec(ctx, `DELETE FROM memory_scopes WHERE memory_id = ?`, [memoryId]);

  const msDoc = documentValidator(memoriesPersistenceDocumentSchema, "memory_scopes");
  for (const raw of input.scopeIds) {
    const scopeId = namespacePathFromStored(raw);
    await upsertScope(ctx, { scopeId });
    const rowId = stableId("ms", memoryId, scopeId);
    msDoc.parse({
      _id: rowId,
      _ts_created: ctx.now,
      memory_id: memoryId,
      scope_id: scopeId,
    });
    await ctxExec(
      ctx,
      `INSERT OR REPLACE INTO memory_scopes (_id, _ts_created, memory_id, scope_id)
       VALUES (?, ?, ?, ?)`,
      [rowId, ctx.now, memoryId, scopeId],
    );
  }
}

export async function listScopesForMemory(ctx: DbCtx, memoryId: string): Promise<string[]> {
  const rows = await ctxQueryAll<{ scope_id: string }>(
    ctx,
    `SELECT scope_id FROM memory_scopes WHERE memory_id = ? ORDER BY scope_id ASC`,
    [memoryId],
  );
  return rows.map((r) => r.scope_id);
}
