import type {
  MemoriesDatabaseLifecycleEvent,
  MemoriesOpEvent,
  MemoriesTelemetry,
  MemoriesTelemetryAttributes,
} from "@khoralabs/memories-node/telemetry";
import {
  MEMORIES_DATABASE_KIND_ATTR,
  MEMORIES_DATABASE_OWNER_KEY_ATTR,
  MEMORIES_PROVENANCE_ROOT_HEX_ATTR,
} from "@khoralabs/memories-node/telemetry";
import {
  type Counter,
  type Histogram,
  type Meter,
  SpanStatusCode,
  type Tracer,
  trace,
  type UpDownCounter,
} from "@opentelemetry/api";
import type { Logger } from "pino";

const TRACER_NAME = "@khoralabs/memories-otel";

export type MemoriesOtelTelemetryOptions = {
  tracer?: Tracer;
  meter?: Meter;
  logger?: Logger;
  /** Static attrs merged into every emit (e.g. service instance id). */
  attributes?: MemoriesTelemetryAttributes;
};

function toSpanAttrs(
  event: MemoriesOpEvent | MemoriesDatabaseLifecycleEvent,
  bound: MemoriesTelemetryAttributes | undefined,
): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {
    ...bound,
    ...event.attributes,
  };
  if ("op" in event) {
    attrs["memories.op"] = event.op;
    attrs["memories.ok"] = event.ok;
    attrs["memories.duration_ms"] = event.durationMs;
    attrs[MEMORIES_PROVENANCE_ROOT_HEX_ATTR] = event.provenanceRootHex;
    if (event.namespace !== undefined) attrs["memories.namespace"] = event.namespace;
    if (event.memoryKind !== undefined) attrs["memories.memory_kind"] = event.memoryKind;
    if (event.memoryKey !== undefined) attrs["memories.memory_key"] = event.memoryKey;
    if (event.hitCount !== undefined) attrs["memories.hit_count"] = event.hitCount;
    if (event.mergedMemoryCount !== undefined) {
      attrs["memories.merged_memory_count"] = event.mergedMemoryCount;
    }
    if (event.error !== undefined) attrs["memories.error"] = event.error;
  } else {
    attrs["memories.database.operation"] = event.operation;
    attrs["memories.ok"] = event.ok;
    attrs["memories.duration_ms"] = event.durationMs;
    attrs[MEMORIES_DATABASE_KIND_ATTR] = event.databaseKind;
    attrs[MEMORIES_DATABASE_OWNER_KEY_ATTR] = event.databaseOwnerKey;
    if (event.error !== undefined) attrs["memories.error"] = event.error;
  }
  return attrs;
}

type Instruments = {
  opCompletions?: Counter;
  opDurationMs?: Histogram;
  dbLifecycle?: Counter;
  dbOpenDurationMs?: Histogram;
  openHandles?: UpDownCounter;
};

function buildTelemetry(
  tracer: Tracer,
  logger: Logger | undefined,
  instruments: Instruments,
  boundAttrs: MemoriesTelemetryAttributes | undefined,
): MemoriesTelemetry {
  return {
    emitOp(event: MemoriesOpEvent) {
      const spanName = `memories.op.${event.op}`;
      const span = tracer.startSpan(spanName);
      const attrs = toSpanAttrs(event, boundAttrs);
      span.setAttributes(attrs);
      if (!event.ok) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: event.error ?? "op failed" });
        if (event.error !== undefined) {
          span.recordException(new Error(event.error));
        }
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      span.end();

      instruments.opCompletions?.add(1, { "memories.op": event.op, "memories.ok": event.ok });
      instruments.opDurationMs?.record(event.durationMs, { "memories.op": event.op });

      const level = event.ok ? "info" : "error";
      logger?.[level](
        {
          phase: spanName,
          ...attrs,
          durationMs: event.durationMs,
          memoriesProvenanceRootHex: event.provenanceRootHex,
        },
        spanName,
      );
    },

    emitDatabaseLifecycle(event: MemoriesDatabaseLifecycleEvent) {
      const spanName = `memories.database.${event.operation}`;
      const span = tracer.startSpan(spanName);
      const attrs = toSpanAttrs(event, boundAttrs);
      span.setAttributes(attrs);
      if (!event.ok) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: event.error ?? "lifecycle failed",
        });
        if (event.error !== undefined) {
          span.recordException(new Error(event.error));
        }
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      span.end();

      instruments.dbLifecycle?.add(1, {
        "memories.database.operation": event.operation,
        "memories.ok": event.ok,
      });
      if (event.operation === "open") {
        instruments.dbOpenDurationMs?.record(event.durationMs);
        if (event.ok) instruments.openHandles?.add(1);
      } else if (
        event.ok &&
        (event.operation === "close" || event.operation === "delete" || event.operation === "evict")
      ) {
        instruments.openHandles?.add(-1);
      }

      const level = event.ok ? "info" : "error";
      logger?.[level](
        {
          phase: spanName,
          ...attrs,
          durationMs: event.durationMs,
        },
        spanName,
      );
    },

    child(attrs) {
      return buildTelemetry(tracer, logger, instruments, { ...boundAttrs, ...attrs });
    },
  };
}

/**
 * Maps {@link MemoriesTelemetry} events to OTel spans/metrics and optional Pino logs.
 * Bring your own configured Tracer / Meter / Logger — this package does not start an SDK.
 */
export function createMemoriesOtelTelemetry(
  options: MemoriesOtelTelemetryOptions = {},
): MemoriesTelemetry {
  const tracer = options.tracer ?? trace.getTracer(TRACER_NAME);
  const instruments: Instruments = {
    opCompletions: options.meter?.createCounter("memories.op.completions", {
      description: "Memory node op completions",
    }),
    opDurationMs: options.meter?.createHistogram("memories.op.duration_ms", {
      description: "Memory node op duration in milliseconds",
      unit: "ms",
    }),
    dbLifecycle: options.meter?.createCounter("memories.database.lifecycle", {
      description: "Database lifecycle events",
    }),
    dbOpenDurationMs: options.meter?.createHistogram("memories.database.open.duration_ms", {
      description: "Database open duration in milliseconds",
      unit: "ms",
    }),
    openHandles: options.meter?.createUpDownCounter("memories.database.open_handles", {
      description: "Approximate open database handles (open − close/delete/evict)",
    }),
  };
  return buildTelemetry(tracer, options.logger, instruments, options.attributes);
}

export type { MemoriesTelemetry } from "@khoralabs/memories-node/telemetry";
