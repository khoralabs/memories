export type DatabaseKind = "organization" | "account" | string;

export type MemoriesDatabaseId = {
  kind: DatabaseKind;
  ownerKey: string;
};

export type DatabaseListFilter = {
  kind?: DatabaseKind;
};
