/**
 * Serializable integrate-memory event wire format for durable workflow enqueue.
 *
 * Canonical content is always `features` + `instructions`. Producers adapt into
 * this shape at the edge. Host-specific projection fields are opaque JSON.
 */

import { type IntegrateMemoryWriteScope, parseIntegrateMemoryWriteScope } from "./write-scope.ts";

export type { IntegrateMemoryWriteScope } from "./write-scope.ts";

export type IntegrateMemoryEventKind = "interaction" | "document" | "memory";

export type IntegrateMemoryFeatures = {
  lexical: string[];
  vector: number[][];
  embeddingModel?: string;
};

export type IntegrateMemoryEvent = {
  kind: IntegrateMemoryEventKind;
  ownerKey: string;
  namespace: string;
  writeScope?: IntegrateMemoryWriteScope;
  memoryKey?: string;
  correlationId: string;
  occurredAtMs: number;
  payload: Record<string, unknown>;
  features: IntegrateMemoryFeatures;
  instructions: string;
  memoriesContextRefs?: Record<string, unknown>;
  contextSourceWire?: Record<string, unknown>;
  stepContext?: Record<string, unknown>;
};

function parseOwnerKey(raw: Record<string, unknown>): string {
  if (typeof raw.ownerKey === "string" && raw.ownerKey.trim().length > 0) {
    return raw.ownerKey.trim();
  }
  return "";
}

function parseOptionalObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function parseFeatures(raw: unknown, legacyText?: string): IntegrateMemoryFeatures {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const f = raw as Record<string, unknown>;
    const lexical = Array.isArray(f.lexical)
      ? f.lexical
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];
    const vector: number[][] = [];
    if (Array.isArray(f.vector)) {
      for (const row of f.vector) {
        if (!Array.isArray(row)) {
          throw new Error("features.vector rows must be arrays");
        }
        const nums: number[] = [];
        for (const n of row) {
          if (typeof n !== "number" || !Number.isFinite(n)) {
            throw new Error("features.vector must contain finite numbers");
          }
          nums.push(n);
        }
        if (nums.length === 0) {
          throw new Error("features.vector rows must be non-empty");
        }
        vector.push(nums);
      }
    }
    if (lexical.length === 0 && vector.length === 0) {
      throw new Error("features must include at least one lexical or vector row");
    }
    const embeddingModel =
      typeof f.embeddingModel === "string" && f.embeddingModel.trim().length > 0
        ? f.embeddingModel.trim()
        : undefined;
    return {
      lexical,
      vector,
      ...(embeddingModel !== undefined ? { embeddingModel } : {}),
    };
  }

  if (legacyText !== undefined && legacyText.trim().length > 0) {
    return { lexical: [legacyText.trim()], vector: [] };
  }

  throw new Error("features is required");
}

export function joinIntegrateLexical(features: IntegrateMemoryFeatures): string {
  return features.lexical
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join("\n\n");
}

export function parseIntegrateMemoryEvent(body: unknown): IntegrateMemoryEvent {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("event body must be an object");
  }
  const raw = body as Record<string, unknown>;
  const kind = raw.kind;
  if (kind !== "interaction" && kind !== "document" && kind !== "memory") {
    throw new Error('kind must be "interaction", "document", or "memory"');
  }
  const ownerKey = parseOwnerKey(raw);
  const namespace = typeof raw.namespace === "string" ? raw.namespace.trim() : "";
  const correlationId = typeof raw.correlationId === "string" ? raw.correlationId.trim() : "";
  const occurredAtMs =
    typeof raw.occurredAtMs === "number" && Number.isFinite(raw.occurredAtMs)
      ? raw.occurredAtMs
      : Number.NaN;
  if (ownerKey.length === 0) throw new Error("ownerKey is required");
  if (namespace.length === 0) throw new Error("namespace is required");
  if (correlationId.length === 0) throw new Error("correlationId is required");
  if (!Number.isFinite(occurredAtMs)) {
    throw new Error("occurredAtMs is required");
  }
  if (raw.payload === null || typeof raw.payload !== "object" || Array.isArray(raw.payload)) {
    throw new Error("payload must be an object");
  }
  let writeScope: IntegrateMemoryWriteScope | undefined;
  if (raw.writeScope !== undefined) {
    writeScope = parseIntegrateMemoryWriteScope(raw.writeScope);
  }
  const memoryKeyRaw = typeof raw.memoryKey === "string" ? raw.memoryKey.trim() : "";
  if (kind === "memory" && memoryKeyRaw.length === 0) {
    throw new Error('memoryKey is required when kind is "memory"');
  }
  const legacyText =
    typeof raw.text === "string" && raw.text.trim().length > 0 ? raw.text.trim() : undefined;
  const features = parseFeatures(raw.features, legacyText);
  const instructions = typeof raw.instructions === "string" ? raw.instructions.trim() : "";
  const memoriesContextRefs = (parseOptionalObject(raw.memoriesContextRefs) ??
    parseOptionalObject(raw.contextRefs)) as Record<string, unknown> | undefined;
  const contextSourceWire = parseOptionalObject(raw.contextSourceWire);
  const stepContext = parseOptionalObject(raw.stepContext);
  return {
    kind,
    ownerKey,
    namespace,
    ...(writeScope !== undefined ? { writeScope } : {}),
    ...(memoryKeyRaw.length > 0 ? { memoryKey: memoryKeyRaw } : {}),
    correlationId,
    occurredAtMs,
    payload: raw.payload as Record<string, unknown>,
    features,
    instructions,
    ...(memoriesContextRefs !== undefined ? { memoriesContextRefs } : {}),
    ...(contextSourceWire !== undefined ? { contextSourceWire } : {}),
    ...(stepContext !== undefined ? { stepContext } : {}),
  };
}
