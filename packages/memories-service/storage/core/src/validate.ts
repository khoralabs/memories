import type { DatabaseKind, MemoriesDatabaseId } from "./database-id";

function sanitizePathPart(part: string, label: string): string {
  const trimmed = part.trim();
  if (trimmed.length === 0) throw new Error(`${label} is required`);
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error(`${label} must not contain path separators`);
  }
  return trimmed;
}

export function validateDatabaseKind(kind: string): DatabaseKind {
  return sanitizePathPart(kind, "Database kind");
}

export function validateOwnerKey(ownerKey: string): string {
  return sanitizePathPart(ownerKey, "Owner key");
}

export function validateMemoriesDatabaseId(id: MemoriesDatabaseId): MemoriesDatabaseId {
  return {
    kind: validateDatabaseKind(id.kind),
    ownerKey: validateOwnerKey(id.ownerKey),
  };
}

export function cacheKeyForId(id: MemoriesDatabaseId): string {
  return `${id.kind}\0${id.ownerKey}`;
}
