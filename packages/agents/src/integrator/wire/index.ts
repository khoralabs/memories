export {
  type IntegrateMemoryEvent,
  type IntegrateMemoryEventKind,
  type IntegrateMemoryFeatures,
  joinIntegrateLexical,
  parseIntegrateMemoryEvent,
} from "./memory-event.ts";
export {
  type IntegrateMemoryWriteScope,
  isIntegrateMemoryWriteScope,
  isUnderNamespace,
  parseIntegrateMemoryWriteScope,
  resolveWriteNamespaceChoice,
  type WriteScopeNeighborSearchOptions,
  writeScopeNamespaceCandidates,
  writeScopeNeedsNamespaceChoice,
  writeScopeNeighborSearchOptions,
} from "./write-scope.ts";
