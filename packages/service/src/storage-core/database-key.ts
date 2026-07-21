import type { MemoriesDatabaseId } from "./database-id";
import { validateMemoriesDatabaseId } from "./validate";

export function databaseKey(id: MemoriesDatabaseId): string {
  const validated = validateMemoriesDatabaseId(id);
  return `${validated.kind}\0${validated.ownerKey}`;
}

export function parseDatabaseKey(key: string): MemoriesDatabaseId | undefined {
  const [kind, ownerKey] = key.split("\0");
  if (kind === undefined || ownerKey === undefined) return undefined;
  return { kind, ownerKey };
}
