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
import { type LibsqlDatabase, readQueryAll } from "../db";

function libsqlTipDeps(db: LibsqlDatabase, coldStore?: ContentBlobColdStore) {
  return {
    queryAll: async <T extends Record<string, unknown>>(sql: string, params: unknown[]) =>
      readQueryAll<T>(db, sql, params),
    exec: async (sql: string, params: unknown[]) => {
      await execSql(db.client, sql, params);
    },
    coldStore,
  };
}

export async function getMemoryGraphAtRootHexAsync(
  db: LibsqlDatabase,
  rootHex: string,
  namespace: string,
  memoryKey: string,
  coldStore?: ContentBlobColdStore,
): Promise<MemoryGraphAtRoot | null> {
  return replayGraphSnapshotAtRootHex(libsqlTipDeps(db, coldStore), rootHex, namespace, memoryKey);
}

export async function getMemoryVectorAtRootHexAsync(
  db: LibsqlDatabase,
  rootHex: string,
  namespace: string,
  memoryKey: string,
  coldStore?: ContentBlobColdStore,
): Promise<MemoryVectorAtRootItem[]> {
  return replayVectorArmsAtRootHex(libsqlTipDeps(db, coldStore), rootHex, namespace, memoryKey);
}

export async function getProvenanceEventJsonAtRootHexAsync(
  db: LibsqlDatabase,
  rootHex: string,
  coldStore?: ContentBlobColdStore,
): Promise<string | null> {
  return replayProvenanceEventJsonAtRootHex(libsqlTipDeps(db, coldStore), rootHex);
}
