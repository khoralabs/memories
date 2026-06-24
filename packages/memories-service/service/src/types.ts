import type { MemoriesPersistenceAsync } from "@khoralabs/memories-core/persistence";

export type DatabaseKind = "organization" | "account" | string;

export type MemoriesDatabaseId = {
  kind: DatabaseKind;
  ownerKey: string;
};

export type DatabaseListFilter = {
  kind?: DatabaseKind;
};

export type MemoriesDatabaseService = {
  open(id: MemoriesDatabaseId): Promise<MemoriesPersistenceAsync>;
  exists(id: MemoriesDatabaseId): Promise<boolean>;
  list(filter?: DatabaseListFilter): Promise<MemoriesDatabaseId[]>;
  delete(id: MemoriesDatabaseId): Promise<void>;
  checkpoint(id: MemoriesDatabaseId): Promise<void>;
  close(id: MemoriesDatabaseId): Promise<void>;
};
