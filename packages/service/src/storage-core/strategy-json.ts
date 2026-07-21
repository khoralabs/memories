import type { MemoriesDatabaseBackendStrategy } from "./backend";

export type SerializedBackendStrategy = {
  kind: string;
  json: string;
};

export function parseStrategy(json: string): MemoriesDatabaseBackendStrategy {
  return JSON.parse(json) as MemoriesDatabaseBackendStrategy;
}

export function serializeStrategy(
  strategy: MemoriesDatabaseBackendStrategy,
): SerializedBackendStrategy {
  return { kind: strategy.kind, json: JSON.stringify(strategy) };
}
