/** Canonical graph state at a provenance tip (facet `graph`). */
export type TipGraphSnapshotV1 = {
  v: 1;
  kind: "node" | "edge";
  namespace: string;
  memoryKey: string;
  edgeId?: string;
  suppressed: boolean;
  labels: Array<{ kind: string; props?: Record<string, unknown> }>;
  properties: Record<string, unknown> | null;
  endpoints?: {
    fromKey: string;
    toKey: string;
  };
};

export function encodeTipGraphSnapshot(snapshot: TipGraphSnapshotV1): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(snapshot));
}

export function decodeTipGraphSnapshot(bytes: Uint8Array): TipGraphSnapshotV1 {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== "object") throw new Error("invalid graph snapshot");
  const s = parsed as TipGraphSnapshotV1;
  if (s.v !== 1 || (s.kind !== "node" && s.kind !== "edge")) {
    throw new Error("unsupported graph snapshot version");
  }
  return s;
}
