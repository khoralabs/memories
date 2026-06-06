# @khoralabs/memories-integrator

Thin **memory integrator** agent: `memory_search` + structured **MemoryIntegratorPlan** output:

- **nodeLabels**: one object, optional fields keyed by ontology node kind (value = that kind’s payload). No discriminated-union array.
- **edges**: array of rows `{ memory, direction, properties?, … }` with **exactly one** optional field per ontology **edge** kind (same keyed pattern as node labels). Merge maps that field to `{ kind, props }`.

Map the wire to `MemoriesClient.mergeMemory` via `integratorWireToMergeSlice`.

## Wire contract

This package’s JSON shape is **library-internal** until promoted to a stable interchange contract. If it becomes cross-service, add matching Smithy types under `@khoralabs/memories-spec` and keep them in sync with this implementation.

## Usage

- `declareMemoryIntegratorAgent` / `registerMemoryIntegratorAgent` — same registry pattern as `@khoralabs/memories-adapter`.
- `MemoryIntegratorClient.integrate()` — one-shot session: `content` → `{ plan, generation }`. Default `maxSteps` is conservative (`DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS` from `@khoralabs/memories-tools`); pass `maxSteps` or set `defaultMaxSteps` on the client for full-quality runs.
- `integratorWireToMergeSlice(ontology, plan)` — produce `labels` / `edges` / `properties` for `mergeMemory`.
