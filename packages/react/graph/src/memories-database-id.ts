/**
 * Database address used by graph providers (mirrors memories-service wire id).
 * Defined locally so the browser UI entry never imports `@khoralabs/memories-service`.
 */
export type MemoriesDatabaseId = {
  kind: string;
  ownerKey: string;
};

export function memoriesDatabaseKey(id: MemoriesDatabaseId): string {
  return `${id.kind}:${id.ownerKey}`;
}
