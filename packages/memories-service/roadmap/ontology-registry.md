# Ontology registry

Cross-database ontology catalog and per-database link history. **Core registry is implemented** in `@khoralabs/memories-service` and `@khoralabs/memories-service-storage-sqlite`.

## Shipped

- `StoredOntologyJsonSchema` — valid JSON Schema document with `nodeLabels` / `edgeLabels` maps
- Content-addressed storage: SHA-256 over canonical JSON (includes field descriptions)
- Append-only `ontologies` table (`INSERT OR IGNORE` by hash)
- Append-only `database_ontology_links` table (FK `ontology_hash`)
- `MemoriesDatabaseOntologyStore` with register, link, history, and shape queries
- Wired into `createLocalSqliteServiceStack` at `{dataDir}/registry/ontologies.db`
- **HTTP routes:** `/ontologies/*`, `/databases/ontology/*`
- **Client helpers:** `MemoriesOntologyClient`, `ensureDatabaseOntologyLink`, `storedOntologyFromDefinition`
- **Exedra phase 1:** registers and links `exedraMemoriesOntology` on database open; warns on hash mismatch

## Registry vs per-database catalog

| Layer | Location | Purpose |
|-------|----------|---------|
| Service ontology registry | `ontologies.db` | Record which ontology shape a database uses; query by hash or label kinds |
| Per-database label catalog | `node_labels` / `edge_labels` inside each `.db` | Materialized at merge time from `MemoriesClient` ontology |
| Runtime ontology | Host TypeScript (`defineOntology`) | Validates merges; registry is audit/discovery in phase 1 |

Changing a database's registered ontology does **not** migrate existing graph rows. Node and edge values are semantic; hosts treat ontology changes as forward-only vocabulary updates.

## Deferred (phase 2+)

- Enforcing that merge-time ontology matches `getCurrentLink(id)` (block or reject mismatched merges)
- Requiring ontology hash on merge HTTP requests
- Rehydrating `OntologyDefinition` from stored JSON Schema back to Standard Schema
- Namespace policy registry

See [../spec.md](../spec.md) for the current API.
