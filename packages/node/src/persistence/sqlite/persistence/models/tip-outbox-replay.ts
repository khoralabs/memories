import type { Database } from "bun:sqlite";
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

function sqliteTipDeps(db: Database, coldStore?: ContentBlobColdStore) {
  return {
    queryAll: async <T extends Record<string, unknown>>(sql: string, params: unknown[]) =>
      db.query(sql).all(...(params as never[])) as T[],
    exec: async (sql: string, params: unknown[]) => {
      db.run(sql, params as never[]);
    },
    coldStore,
  };
}

export async function getMemoryGraphAtRootHexAsync(
  db: Database,
  rootHex: string,
  namespace: string,
  memoryKey: string,
  coldStore?: ContentBlobColdStore,
): Promise<MemoryGraphAtRoot | null> {
  return replayGraphSnapshotAtRootHex(sqliteTipDeps(db, coldStore), rootHex, namespace, memoryKey);
}

export async function getMemoryVectorAtRootHexAsync(
  db: Database,
  rootHex: string,
  namespace: string,
  memoryKey: string,
  coldStore?: ContentBlobColdStore,
): Promise<MemoryVectorAtRootItem[]> {
  return replayVectorArmsAtRootHex(sqliteTipDeps(db, coldStore), rootHex, namespace, memoryKey);
}

export async function getProvenanceEventJsonAtRootHexAsync(
  db: Database,
  rootHex: string,
  coldStore?: ContentBlobColdStore,
): Promise<string | null> {
  return replayProvenanceEventJsonAtRootHex(sqliteTipDeps(db, coldStore), rootHex);
}
