import type { ContentBlobColdStore } from "../../../../persistence/core/persistence/content-blob-cold-store";
import type {
  MemoryGraphAtRoot,
  MemoryVectorAtRootItem,
} from "../../../../persistence/core/persistence/types";
import {
  replayGraphSnapshotAtRootHex,
  replayProvenanceEventJsonAtRootHex,
  replayVectorArmsAtRootHex,
} from "../../../../persistence/core/tip-outbox/replay";
import { execSql } from "../client";
import { readQueryAll, type TursoDatabase } from "../db";

function tursoTipDeps(db: TursoDatabase, coldStore?: ContentBlobColdStore) {
  return {
    queryAll: async <T extends Record<string, unknown>>(sql: string, params: unknown[]) =>
      readQueryAll<T>(db, sql, params),
    exec: async (sql: string, params: unknown[]) => {
      await execSql(db.write, sql, params);
    },
    coldStore,
  };
}

export async function getMemoryGraphAtRootHexAsync(
  db: TursoDatabase,
  rootHex: string,
  namespace: string,
  memoryKey: string,
  coldStore?: ContentBlobColdStore,
): Promise<MemoryGraphAtRoot | null> {
  return replayGraphSnapshotAtRootHex(tursoTipDeps(db, coldStore), rootHex, namespace, memoryKey);
}

export async function getMemoryVectorAtRootHexAsync(
  db: TursoDatabase,
  rootHex: string,
  namespace: string,
  memoryKey: string,
  coldStore?: ContentBlobColdStore,
): Promise<MemoryVectorAtRootItem[]> {
  return replayVectorArmsAtRootHex(tursoTipDeps(db, coldStore), rootHex, namespace, memoryKey);
}

export async function getProvenanceEventJsonAtRootHexAsync(
  db: TursoDatabase,
  rootHex: string,
  coldStore?: ContentBlobColdStore,
): Promise<string | null> {
  return replayProvenanceEventJsonAtRootHex(tursoTipDeps(db, coldStore), rootHex);
}
