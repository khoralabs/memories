export const QUALIFIED_MEMORY_KEY_SEP = "::";

export function qualifyMemoryKey(namespace: string, memoryKey: string): string {
  return `${namespace}${QUALIFIED_MEMORY_KEY_SEP}${memoryKey}`;
}
