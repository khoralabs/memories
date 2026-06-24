import type { Database } from "bun:sqlite";
import type { SqliteDatabaseContext } from "@khoralabs/memories-service";
import { listMemoryNamespaces } from "@khoralabs/memories-sqlite";
import {
  buildNamespaceGraphLayout,
  buildNamespaceSubtreeGraphLayout,
  loadEdgePreview,
  loadSourceMapTextPreview,
} from "@khoralabs/sqlite-graph-projections";

export type GraphScope = "exact" | "subtree";

export function listDatabaseNamespaces(ctx: SqliteDatabaseContext): string[] {
  return listMemoryNamespaces(ctx.db);
}

export function loadDatabaseGraphLayout(
  ctx: SqliteDatabaseContext,
  namespace: string,
  scope: GraphScope = "exact",
): Record<string, unknown> {
  if (scope === "subtree") {
    return buildNamespaceSubtreeGraphLayout(
      ctx.db,
      ctx.syncPersistence,
      namespace,
    ) as unknown as Record<string, unknown>;
  }
  return buildNamespaceGraphLayout(ctx.db, ctx.syncPersistence, namespace) as unknown as Record<
    string,
    unknown
  >;
}

export function loadDatabaseEdgePreview(
  ctx: SqliteDatabaseContext,
  namespace: string,
  edgeId: string,
): Record<string, unknown> | undefined {
  const detail = loadEdgePreview(ctx.syncPersistence, namespace, edgeId);
  return detail as Record<string, unknown> | undefined;
}

export function loadDatabaseSourceMapTextPreview(
  ctx: SqliteDatabaseContext,
  sourceMapId: string,
  maxChars: number,
): string | null {
  return loadSourceMapTextPreview(ctx.db, sourceMapId, maxChars);
}

export function listDatabaseVectorDimensions(ctx: SqliteDatabaseContext): number[] {
  return ctx.syncPersistence.listVectorEmbeddingIndexDimensions();
}

export type { Database };
