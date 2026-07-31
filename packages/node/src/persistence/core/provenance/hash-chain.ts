import { sha256Digest } from "../models/sha256";
import { canonicalJson } from "./canonical-json";

const enc = new TextEncoder();

/** ASCII + NUL prefix for provenance event leaves (distinct from OBP session hashes). */
export const MEMORIES_EVENT_LEAF_V1_PREFIX = "MEMORIES_EVENT_LEAF_v1\0";

/** 32 zero bytes: conceptual genesis parent for the first chain link. */
export const GENESIS_PARENT_ROOT_BYTES = new Uint8Array(32);

/** Lowercase hex string for the all-zero genesis parent (stored + hashed explicitly). */
export const GENESIS_PARENT_HEX = "00".repeat(32);

export function hexToBytes32(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new RangeError("hexToBytes32: expected 64 lowercase hex chars");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHexLower(digest: Uint8Array): string {
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** `SHA-256(MEMORIES_EVENT_LEAF_v1 || NUL || canonical_json(event))` as raw digest bytes. */
export function provenanceEventLeaf(event: unknown): Uint8Array {
  const payload = enc.encode(`${MEMORIES_EVENT_LEAF_V1_PREFIX}${canonicalJson(event)}`);
  return sha256Digest(payload);
}

/** `SHA-256(parent_32 || leaf_32)` where parent is genesis zeros or previous root bytes. */
export function provenanceChainLink(parentRootHex: string, leafDigest: Uint8Array): Uint8Array {
  const parent =
    parentRootHex === GENESIS_PARENT_HEX ? GENESIS_PARENT_ROOT_BYTES : hexToBytes32(parentRootHex);
  const combined = new Uint8Array(64);
  combined.set(parent, 0);
  combined.set(leafDigest, 32);
  return sha256Digest(combined);
}

export type ContributorAttestation = {
  v: 1;
  format: string;
  principal: string;
  payload: string;
  signature: string;
  alg?: string;
  keyId?: string;
};

export type MemoryMutationAttribution = {
  contributor?: ContributorAttestation;
  intentSnapshotId?: string;
};

export type MergeMemoryProvenanceEvent = {
  v: 1;
  kind: "MERGE_MEMORY";
  namespace: string;
  memory_key: string;
  memory_id: string;
  source_keys: string[];
  content_hashes?: Record<string, string>;
  contributor?: ContributorAttestation;
  intent_snapshot_id?: string;
};

export type DeleteMemoryProvenanceEvent = {
  v: 1;
  kind: "DELETE_MEMORY";
  namespace: string;
  memory_key: string;
  memory_id: string;
  contributor?: ContributorAttestation;
  intent_snapshot_id?: string;
};

export type RenameNamespaceProvenanceEvent = {
  v: 1;
  kind: "RENAME_NAMESPACE";
  from_namespace: string;
  to_namespace: string;
  recursive: boolean;
  contributor?: ContributorAttestation;
  intent_snapshot_id?: string;
};

export type MemoryProvenanceEvent =
  | MergeMemoryProvenanceEvent
  | DeleteMemoryProvenanceEvent
  | RenameNamespaceProvenanceEvent;

/** Next root hex given optional current head (`undefined` at genesis). */
export function nextProvenanceRoot(
  headRootHex: string | undefined,
  event: MemoryProvenanceEvent,
): { parent_root_hex: string; root_hex: string; leaf_digest: Uint8Array } {
  const parentHex = headRootHex ?? GENESIS_PARENT_HEX;
  const leafDigest = provenanceEventLeaf(event);
  const rootDigest = provenanceChainLink(parentHex, leafDigest);
  return {
    parent_root_hex: parentHex,
    root_hex: bytesToHexLower(rootDigest),
    leaf_digest: leafDigest,
  };
}
