import type {
  MemoriesDatabaseLifecycleEvent,
  MemoriesOpEvent,
  MemoriesTelemetry,
  MemoriesTelemetryAttributes,
} from "./types.js";

function mergeAttrs(
  base: MemoriesTelemetryAttributes | undefined,
  extra: MemoriesTelemetryAttributes | undefined,
): MemoriesTelemetryAttributes | undefined {
  if (base === undefined && extra === undefined) return undefined;
  return { ...base, ...extra };
}

/** No-op sink used when telemetry is unset. */
export const noopMemoriesTelemetry: MemoriesTelemetry = {
  emitOp() {},
  emitDatabaseLifecycle() {},
  child() {
    return noopMemoriesTelemetry;
  },
};

/**
 * Bind static attributes (e.g. `memories.database.*`) onto every emit from `base`.
 * Uses `base.child` when available; otherwise wraps emit methods.
 */
export function bindMemoriesTelemetry(
  base: MemoriesTelemetry,
  attrs: MemoriesTelemetryAttributes,
): MemoriesTelemetry {
  if (base.child !== undefined) {
    return base.child(attrs);
  }
  return {
    emitOp(event: MemoriesOpEvent) {
      base.emitOp({
        ...event,
        attributes: mergeAttrs(attrs, event.attributes),
      });
    },
    emitDatabaseLifecycle(event: MemoriesDatabaseLifecycleEvent) {
      base.emitDatabaseLifecycle({
        ...event,
        attributes: mergeAttrs(attrs, event.attributes),
      });
    },
    child(more) {
      return bindMemoriesTelemetry(base, { ...attrs, ...more });
    },
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export type RunWithOpTelemetryArgsSync<T> = {
  telemetry: MemoriesTelemetry | undefined;
  op: MemoriesOpEvent["op"];
  namespace?: string;
  memoryKind?: "node" | "edge";
  memoryKey?: string;
  getProvenanceRootHex: () => string;
  successFields?: (
    result: T,
  ) => Partial<Pick<MemoriesOpEvent, "hitCount" | "mergedMemoryCount" | "memoryKind">>;
  fn: () => T;
};

/** Time `fn`, emit a structured op event when `telemetry` is set. */
export function runWithOpTelemetrySync<T>(args: RunWithOpTelemetryArgsSync<T>): T {
  const tel = args.telemetry;
  if (tel === undefined) {
    return args.fn();
  }
  const start = performance.now();
  try {
    const result = args.fn();
    const extra = args.successFields?.(result);
    tel.emitOp({
      op: args.op,
      ok: true,
      durationMs: performance.now() - start,
      provenanceRootHex: args.getProvenanceRootHex(),
      ...(args.namespace !== undefined ? { namespace: args.namespace } : {}),
      ...(args.memoryKind !== undefined ? { memoryKind: args.memoryKind } : {}),
      ...(args.memoryKey !== undefined ? { memoryKey: args.memoryKey } : {}),
      ...extra,
    });
    return result;
  } catch (error) {
    tel.emitOp({
      op: args.op,
      ok: false,
      durationMs: performance.now() - start,
      provenanceRootHex: args.getProvenanceRootHex(),
      error: errorMessage(error),
      ...(args.namespace !== undefined ? { namespace: args.namespace } : {}),
      ...(args.memoryKind !== undefined ? { memoryKind: args.memoryKind } : {}),
      ...(args.memoryKey !== undefined ? { memoryKey: args.memoryKey } : {}),
    });
    throw error;
  }
}

export type RunWithOpTelemetryArgsAsync<T> = {
  telemetry: MemoriesTelemetry | undefined;
  op: MemoriesOpEvent["op"];
  namespace?: string;
  memoryKind?: "node" | "edge";
  memoryKey?: string;
  getProvenanceRootHex: () => string | Promise<string>;
  successFields?: (
    result: T,
  ) =>
    | Partial<Pick<MemoriesOpEvent, "hitCount" | "mergedMemoryCount" | "memoryKind">>
    | Promise<Partial<Pick<MemoriesOpEvent, "hitCount" | "mergedMemoryCount" | "memoryKind">>>;
  fn: () => Promise<T>;
};

/** Async variant of {@link runWithOpTelemetrySync}. */
export async function runWithOpTelemetryAsync<T>(args: RunWithOpTelemetryArgsAsync<T>): Promise<T> {
  const tel = args.telemetry;
  if (tel === undefined) {
    return args.fn();
  }
  const start = performance.now();
  try {
    const result = await args.fn();
    const extra = await args.successFields?.(result);
    tel.emitOp({
      op: args.op,
      ok: true,
      durationMs: performance.now() - start,
      provenanceRootHex: await args.getProvenanceRootHex(),
      ...(args.namespace !== undefined ? { namespace: args.namespace } : {}),
      ...(args.memoryKind !== undefined ? { memoryKind: args.memoryKind } : {}),
      ...(args.memoryKey !== undefined ? { memoryKey: args.memoryKey } : {}),
      ...extra,
    });
    return result;
  } catch (error) {
    let provenanceRootHex = "";
    try {
      provenanceRootHex = await args.getProvenanceRootHex();
    } catch {
      provenanceRootHex = "";
    }
    tel.emitOp({
      op: args.op,
      ok: false,
      durationMs: performance.now() - start,
      provenanceRootHex,
      error: errorMessage(error),
      ...(args.namespace !== undefined ? { namespace: args.namespace } : {}),
      ...(args.memoryKind !== undefined ? { memoryKind: args.memoryKind } : {}),
      ...(args.memoryKey !== undefined ? { memoryKey: args.memoryKey } : {}),
    });
    throw error;
  }
}

export type RunWithDatabaseLifecycleArgsAsync<T> = {
  telemetry: MemoriesTelemetry | undefined;
  operation: MemoriesDatabaseLifecycleEvent["operation"];
  databaseKind: string;
  databaseOwnerKey: string;
  fn: () => Promise<T>;
};

/** Time a database lifecycle op and emit when `telemetry` is set. */
export async function runWithDatabaseLifecycleAsync<T>(
  args: RunWithDatabaseLifecycleArgsAsync<T>,
): Promise<T> {
  const tel = args.telemetry;
  if (tel === undefined) {
    return args.fn();
  }
  const start = performance.now();
  try {
    const result = await args.fn();
    tel.emitDatabaseLifecycle({
      operation: args.operation,
      ok: true,
      durationMs: performance.now() - start,
      databaseKind: args.databaseKind,
      databaseOwnerKey: args.databaseOwnerKey,
    });
    return result;
  } catch (error) {
    tel.emitDatabaseLifecycle({
      operation: args.operation,
      ok: false,
      durationMs: performance.now() - start,
      databaseKind: args.databaseKind,
      databaseOwnerKey: args.databaseOwnerKey,
      error: errorMessage(error),
    });
    throw error;
  }
}
