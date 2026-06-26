import type {
  MemoriesDatabaseBackendFactory,
  MemoriesDatabaseBackendStrategy,
} from "@khoralabs/memories-service-storage-core";

export type CompositeBackendFactoryMap = Record<string, MemoriesDatabaseBackendFactory>;

export class UnknownBackendStrategyError extends Error {
  constructor(readonly strategy: MemoriesDatabaseBackendStrategy) {
    super(`No backend factory registered for strategy kind: ${strategy.kind}`);
    this.name = "UnknownBackendStrategyError";
  }
}

/**
 * Dispatches backend creation by `strategy.kind`, allowing one placement registry
 * to route different memory nodes to different storage implementations.
 */
export function createCompositeBackendFactory(
  factories: CompositeBackendFactoryMap,
): MemoriesDatabaseBackendFactory {
  return {
    create(strategy) {
      const factory = factories[strategy.kind];
      if (factory === undefined) {
        throw new UnknownBackendStrategyError(strategy);
      }
      return factory.create(strategy);
    },
  };
}
