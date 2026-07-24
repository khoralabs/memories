# @khoralabs/memories-otel

OpenTelemetry and optional Pino adapter for `@khoralabs/memories-node/telemetry`.

Maps structured memory **ops** and **database lifecycle** events to OTel spans/metrics and Pino logs. Bring your own configured `Tracer`, optional `Meter`, and `Logger` — this package does **not** start an OTel SDK or configure exporters.

## Install

```bash
bun add @khoralabs/memories-otel @opentelemetry/api
# optional structured logs:
bun add pino
```

## Host wiring

```ts
import { createMemoriesOtelTelemetry } from "@khoralabs/memories-otel";
import { createMemoriesDatabaseService } from "@khoralabs/memories-service";
import { trace, metrics } from "@opentelemetry/api";
import pino from "pino";

const telemetry = createMemoriesOtelTelemetry({
  tracer: trace.getTracer("my-app"),
  meter: metrics.getMeter("my-app"),
  logger: pino(),
});

const service = createMemoriesDatabaseService({
  resolver,
  telemetry,
});
```

In-process node clients can pass the same sink:

```ts
import { MemoriesClient } from "@khoralabs/memories-node";

const client = new MemoriesClient(persistence, ontology, { telemetry });
```

HTTP handlers use `handle.telemetry` (bound with `memories.database.kind` / `owner_key`) automatically when the service is constructed with `telemetry`.

## Attribute catalog

| Attribute | Where |
|-----------|--------|
| `memories.op` | Op spans (`merge` / `delete` / `search`) |
| `memories.ok` | Ops + lifecycle |
| `memories.duration_ms` | Ops + lifecycle |
| `memories.namespace` | Ops |
| `memories.memory_kind` | Merge |
| `memories.memory_key` | Merge / delete |
| `memories.hit_count` | Search |
| `memories.merged_memory_count` | Merge |
| `memories.provenance_root_hex` | Ops (chain head at emit time) |
| `memories.database.kind` | Lifecycle + bound op attrs |
| `memories.database.owner_key` | Lifecycle + bound op attrs |
| `memories.database.operation` | Lifecycle (`open` / `close` / `delete` / `evict`) |
| `memories.error` | Failures |

### Span names

- `memories.op.merge` | `memories.op.delete` | `memories.op.search`
- `memories.database.open` | `.close` | `.delete` | `.evict`

### Metrics (optional `meter`)

| Instrument | Type |
|------------|------|
| `memories.op.completions` | Counter (`memories.op`, `memories.ok`) |
| `memories.op.duration_ms` | Histogram |
| `memories.database.lifecycle` | Counter |
| `memories.database.open.duration_ms` | Histogram |
| `memories.database.open_handles` | UpDownCounter (approximate) |

## Aggregation model

The memories **service** is an app-level aggregator/enricher: it emits lifecycle events and binds database id attrs onto the sink used for in-process node ops. It is **not** an OpenTelemetry Collector (`otelcol`). Hosts should still run a real collector or vendor exporter for batching, sampling, and multi-backend export.

### Networked nodes (phase 2)

Planned (not shipped): authenticated `POST /telemetry/events` accepting the same typed JSON event catalog. The service would validate auth, stamp `memories.database.*`, and feed `MemoriesTelemetry` (typically this OTEL adapter). A full OTLP receiver is explicitly out of scope for v1.

Until then, remote nodes should either:

1. Export directly to the same host OTel backend with shared resource attributes, or
2. Rely on service-side op spans when the service proxies merge/search/delete (once `{ kind: "remote" }` placement lands).

## Related

- Sink types: `@khoralabs/memories-node/telemetry`
- Agent session OTel: `@khoralabs/agent-capabilities-otel` via `@khoralabs/memories-agents/tools`
