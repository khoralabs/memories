/** Primitive attribute values for structured memories telemetry. */
export type MemoriesTelemetryAttributeValue = string | number | boolean;

/** Extra attrs merged into emits (e.g. database id bound by the service). */
export type MemoriesTelemetryAttributes = Record<string, MemoriesTelemetryAttributeValue>;

/** OTel / log attribute for the store provenance chain head (`memory_provenance.root_hex`). */
export const MEMORIES_PROVENANCE_ROOT_HEX_ATTR = "memories.provenance_root_hex" as const;

/** Database id `kind` when emitted from the service. */
export const MEMORIES_DATABASE_KIND_ATTR = "memories.database.kind" as const;

/** Database id `ownerKey` when emitted from the service. */
export const MEMORIES_DATABASE_OWNER_KEY_ATTR = "memories.database.owner_key" as const;

export type MemoriesOpName =
  | "merge"
  | "delete"
  | "suppress"
  | "unsuppress"
  | "suppress_namespace"
  | "unsuppress_namespace"
  | "search";

export type MemoriesDatabaseLifecycleOperation = "open" | "close" | "delete" | "evict";

export type MemoriesOpEvent = {
  op: MemoriesOpName;
  ok: boolean;
  durationMs: number;
  /** Provenance chain head at emit time, or `""` when empty. */
  provenanceRootHex: string;
  namespace?: string;
  memoryKind?: "node" | "edge";
  memoryKey?: string;
  hitCount?: number;
  mergedMemoryCount?: number;
  error?: string;
  attributes?: MemoriesTelemetryAttributes;
};

export type MemoriesDatabaseLifecycleEvent = {
  operation: MemoriesDatabaseLifecycleOperation;
  ok: boolean;
  durationMs: number;
  databaseKind: string;
  databaseOwnerKey: string;
  error?: string;
  attributes?: MemoriesTelemetryAttributes;
};

/**
 * Host- or adapter-supplied sink for structured node ops and database lifecycle.
 * Implementations must not throw; adapters should swallow mapping failures.
 */
export type MemoriesTelemetry = {
  emitOp(event: MemoriesOpEvent): void;
  emitDatabaseLifecycle(event: MemoriesDatabaseLifecycleEvent): void;
  /**
   * Return a sink that merges `attrs` into every subsequent emit.
   * Optional — {@link bindMemoriesTelemetry} polyfills when absent.
   */
  child?(attrs: MemoriesTelemetryAttributes): MemoriesTelemetry;
};
