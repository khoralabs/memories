export type PropertyEntry = { id: string; key: string; value: string };

function newEntryId(): string {
  return crypto.randomUUID();
}

export function propertiesToEntries(
  properties: Record<string, unknown> | null | undefined,
): PropertyEntry[] {
  if (properties == null) return [];
  return Object.entries(properties).map(([key, value]) => ({
    id: newEntryId(),
    key,
    value: typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value),
  }));
}

export function entriesToProperties(entries: PropertyEntry[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of entries) {
    const key = entry.key.trim();
    if (key.length === 0) continue;
    const raw = entry.value.trim();
    if (raw.length === 0) {
      out[key] = "";
      continue;
    }
    if (
      (raw.startsWith("{") && raw.endsWith("}")) ||
      (raw.startsWith("[") && raw.endsWith("]")) ||
      raw === "true" ||
      raw === "false" ||
      raw === "null" ||
      /^-?\d+(\.\d+)?$/.test(raw)
    ) {
      try {
        out[key] = JSON.parse(raw) as unknown;
        continue;
      } catch {
        // keep as string
      }
    }
    out[key] = entry.value;
  }
  return out;
}
