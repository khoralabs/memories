# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Package tags on each entry (`**@khoralabs/memories-***`) name which published package the change affects.

## [Unreleased]

### Added

- **@khoralabs/memories-node** — Content-addressed `memory_content_blobs` with thin `memory_content_outbox` tips (`content_sha256`); hot-window evacuation and optional Bun S3 cold store (sqlite / libsql / turso-serverless).
- **@khoralabs/memories-node** — `replaceMemoryFeature` / `replaceMemoryFeatureAsync` to upsert one content arm (text and/or vector) without clearing other arms or graph topology.
- **@khoralabs/memories-node** — Configurable `NamespacePathPolicy` (`maxDepth` / `maxLength`) for namespace path validation beyond the fixed grammar.
- **@khoralabs/memories-node** — `countGraphForNamespace` / `statsGraphForNamespace` graph catalog metrics (exact and subtree scopes).
- **@khoralabs/memories-node** — `listProvenanceEvents` and `listProvenanceChain` for tip history and event listing with keyset cursors.
- **@khoralabs/memories-node** — `getMemoryContentAtRootHex` (and async cold-aware variants) for per-arm LWW reconstruct at a provenance tip.
- **@khoralabs/memories-service** — HTTP: `POST /databases/provenance/events`, `/databases/provenance/chain`, `/databases/provenance/content`, `/databases/provenance/timestamp`.
- **@khoralabs/memories-service** — HTTP: `POST /databases/source-map/text`, `/databases/source-map/replace`, `/databases/graph-counts`, `/databases/graph-stats`.
- **@khoralabs/memories-service** — Stack/HTTP options `maxNamespaceDepth` / `maxNamespacePathLength`; advertised on capabilities as `namespaceLimits`.
- **@khoralabs/memories-service** — Remote client methods for provenance events/chain/content/timestamp, source-map text/replace, and graph counts/stats.
- **@khoralabs/memories-service** — Memory preview responses include freeform `properties` and richer source-map inventory (`hasText` / `hasVector`, truncated text).
- **@khoralabs/memories-react-graph** — `NodeBillboard` / `EdgeBillboard` freeform properties, ontology/metadata compounds, and preview dock composition hooks.
- **@khoralabs/memories-react-graph** — `MemoryDetailOntology`, `MemoryMetadata`, relation hover cards (`MemoryNodeHoverCard` / `MemoryEdgeHoverCard`), and `relation-chain` helpers.
- **@khoralabs/memories-react-graph** — Client APIs: `replaceFeature`, `getGraphCounts`, `getGraphStats`, provenance events/chain/content helpers.
- **@khoralabs/memories-spec** — Smithy shapes/docs for provenance listing, content-at-tip, graph counts/stats, and related persistence capabilities.

### Changed

- **@khoralabs/memories-node** — Search time travel is `asOf: { gt|gte|lt|lte }` only (capability flag remains `asOfTimestampMsSearch`).
- **@khoralabs/memories-node** — Namespace metadata upsert accepts `alias` only (DB column remains `display_name`).
- **@khoralabs/memories-node** — LWW reconstruct reads hot blobs (and cold store when configured); inline pre-blob `outbox.text` is no longer consulted. Ensure DBs have run the content-blob migration so tips carry `content_sha256`.
- **@khoralabs/memories-service** — `AuthorizeInput` uses typed `scope` only (no top-level `namespace` mirror). Host strategies must authorize from `input.scope`.
- **@khoralabs/memories-service** — Storage contracts live under `storage/core`; import from package root / `storage/core` rather than `service/*` shims.
- **@khoralabs/memories-react-graph** — `MemoriesClientProvider` requires `createClient` + `database` (fixed injected `client` mode removed).
- **@khoralabs/memories-react-graph** — Namespace catalog input is metadata rows only (path `string[]` coercion removed).
- **@khoralabs/memories-react-graph** — Graph search chrome defaults to composition (`GraphSearch.Input` / `GraphNamespaceSearch.Input`); root `inputProps` removed.

### Removed

- **@khoralabs/memories-node** — Package export `./projections/umap-input` and all `*Umap*` projection-input aliases (`collectNamespaceUmapInput`, `UMAP_INPUT_CONTENT_TYPE`, sqlite/libsql `collect*UmapInput`, etc.). Use `./projections/projection-input` / `PROJECTION_INPUT_*`.
- **@khoralabs/memories-node** — `canonicalOntology` bag export; compose from `./ontology/families/*`.
- **@khoralabs/memories-node** — `integrateNewMemoryIntoGraph` wrapper; use `runAutolinkIntegrate` / durable autolink workflow.
- **@khoralabs/memories-node** — Search param `asOfTimestampMs`; use `asOf: { lte }`.
- **@khoralabs/memories-service** — HTTP alias `POST /databases/projections/umap-input`; client `fetchUmapInput` / `DatabaseUmapInputRequest` / `handleDatabaseUmapInput`.
- **@khoralabs/memories-service** — Wire field `displayName` on namespace upsert and `asOfTimestampMs` on search wire.
- **@khoralabs/memories-service** — Re-export shim modules under `service/{backend,validate,owner-key-encoder,placement,ontology-registry}.ts`.
- **@khoralabs/memories-react-graph** — Aliases `MemoriesMemoryProvider`, `NodePreviewCard`, `EdgePreviewCard`, `GraphRefreshButton`.
- **@khoralabs/memories-agents** — `createMemoryIntegratorAgent`; use `createMemoryIntegratorSearchAgent` + plan phase.
- **@khoralabs/memories-agents** — Re-exports of `HybridMemorySearchInput` / `HybridMemorySearchOptions` / `MemorySearchHit` / `embeddingCacheKey` from `./tools`; import from `@khoralabs/memories-node/helpers`.
- **@khoralabs/memories-spec** — `asOfTimestampMs` member on `SearchParams`.

## [0.7.6] - 2026-08-09

Changelog tracking begins after this release. See git tag `v0.7.6` for the prior tree.

[Unreleased]: https://github.com/khoralabs/memories/compare/v0.7.6...HEAD
[0.7.6]: https://github.com/khoralabs/memories/releases/tag/v0.7.6
