import { namespacePathFromStored, stableId } from "../../../../persistence/core";
import { memoriesPersistenceDocumentSchema } from "../../../../persistence/core/persistence";
import { documentValidator } from "../_lib";
import type { DbCtx } from "./context";

function parseAdjacency(db: DbCtx["db"]): Map<string, string[]> {
  const rows = db
    .query<{ parent_scope_id: string; child_scope_id: string }, []>(
      `SELECT parent_scope_id, child_scope_id FROM scope_edges`,
    )
    .all();
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

/** Full rebuild of transitive scope closure (including self pairs). */
export function rebuildScopeClosure(ctx: DbCtx): void {
  const { db, now, stmts } = ctx;
  stmts.deleteAllScopeClosure.run();

  const scopeRows = db.query<{ _id: string }, []>(`SELECT _id FROM scopes`).all();
  if (scopeRows.length === 0) return;

  const adj = parseAdjacency(db);
  const doc = documentValidator(memoriesPersistenceDocumentSchema, "scope_closure");

  for (const { _id: ancestor } of scopeRows) {
    const descendants = dfsReachable(ancestor, adj);
    for (const descendant of descendants) {
      const rowId = stableId("sclo", ancestor, descendant);
      doc.parse({
        _id: rowId,
        _ts_created: now,
        ancestor_scope_id: ancestor,
        descendant_scope_id: descendant,
      });
      stmts.insertScopeClosure.run(rowId, now, ancestor, descendant);
    }
  }
}

export function upsertScope(ctx: DbCtx, input: { scopeId: string }): void {
  const { now, stmts } = ctx;
  const scopeId = namespacePathFromStored(input.scopeId);
  const doc = documentValidator(memoriesPersistenceDocumentSchema, "scopes");
  doc.parse({
    _id: scopeId,
    _ts_created: now,
  });
  stmts.insertIgnoreScope.run(scopeId, now);
}

/** True if adding directed edge parent→child would close a cycle in the existing DAG. */
function pathWouldCreateCycle(db: DbCtx["db"], parent: string, child: string): boolean {
  if (parent === child) return true;
  const adj = parseAdjacency(db);
  return dfsReachable(child, adj).has(parent);
}

export function linkScopes(
  ctx: DbCtx,
  input: { parentScopeId: string; childScopeId: string },
): void {
  const { db, now, stmts } = ctx;
  const parent = namespacePathFromStored(input.parentScopeId);
  const child = namespacePathFromStored(input.childScopeId);
  upsertScope(ctx, { scopeId: parent });
  upsertScope(ctx, { scopeId: child });

  const exists = db
    .query<{ _id: string }, [string, string]>(
      `SELECT _id FROM scope_edges WHERE parent_scope_id = ? AND child_scope_id = ?`,
    )
    .get(parent, child);
  if (exists) {
    rebuildScopeClosure(ctx);
    return;
  }

  if (pathWouldCreateCycle(db, parent, child)) {
    throw new Error(`linkScopes: would create cycle (${parent} → ${child})`);
  }

  const edgeDoc = documentValidator(memoriesPersistenceDocumentSchema, "scope_edges");
  const edgeId = stableId("sce", parent, child);
  edgeDoc.parse({
    _id: edgeId,
    _ts_created: now,
    parent_scope_id: parent,
    child_scope_id: child,
  });
  stmts.insertOrReplaceScopeEdge.run(edgeId, now, parent, child);
  rebuildScopeClosure(ctx);
}

export function unlinkScopeEdge(
  ctx: DbCtx,
  input: { parentScopeId: string; childScopeId: string },
): void {
  const { stmts } = ctx;
  const parent = namespacePathFromStored(input.parentScopeId);
  const child = namespacePathFromStored(input.childScopeId);
  stmts.deleteScopeEdge.run(parent, child);
  rebuildScopeClosure(ctx);
}

export function replaceMemoryScopes(
  ctx: DbCtx,
  input: { memoryId: string; scopeIds: readonly string[] },
): void {
  const { now, stmts } = ctx;
  const { memoryId } = input;
  stmts.deleteMemoryScopes.run(memoryId);

  const msDoc = documentValidator(memoriesPersistenceDocumentSchema, "memory_scopes");
  for (const raw of input.scopeIds) {
    const scopeId = namespacePathFromStored(raw);
    upsertScope(ctx, { scopeId });
    const rowId = stableId("ms", memoryId, scopeId);
    msDoc.parse({
      _id: rowId,
      _ts_created: now,
      memory_id: memoryId,
      scope_id: scopeId,
    });
    stmts.insertOrReplaceMemoryScope.run(rowId, now, memoryId, scopeId);
  }
}

export function listScopesForMemory(ctx: DbCtx, memoryId: string): string[] {
  const rows = ctx.db
    .query<{ scope_id: string }, [string]>(
      `SELECT scope_id FROM memory_scopes WHERE memory_id = ? ORDER BY scope_id ASC`,
    )
    .all(memoryId);
  return rows.map((r) => r.scope_id);
}
