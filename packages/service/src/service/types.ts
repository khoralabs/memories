import type { MemoriesPersistenceAsync } from "@khoralabs/memories-node/persistence";
import type {
  DatabaseKind,
  DatabaseListFilter,
  MemoriesDatabaseHandle,
  MemoriesDatabaseId,
  MemoriesDatabaseSnapshot,
} from "../storage-core/index";

export type { DatabaseKind, DatabaseListFilter, MemoriesDatabaseId };

export type MemoriesDatabaseService = {
  open(id: MemoriesDatabaseId): Promise<MemoriesPersistenceAsync>;
  getHandle(id: MemoriesDatabaseId): Promise<MemoriesDatabaseHandle>;
  exists(id: MemoriesDatabaseId): Promise<boolean>;
  list(filter?: DatabaseListFilter): Promise<MemoriesDatabaseId[]>;
  delete(id: MemoriesDatabaseId): Promise<void>;
  checkpoint(id: MemoriesDatabaseId): Promise<void>;
  snapshot(id: MemoriesDatabaseId): Promise<MemoriesDatabaseSnapshot>;
  close(id: MemoriesDatabaseId): Promise<void>;
};
