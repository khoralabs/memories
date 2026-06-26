export function s(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

export function nl(parts: string[]): string {
  return parts.filter((p) => p.length > 0).join("\n");
}
