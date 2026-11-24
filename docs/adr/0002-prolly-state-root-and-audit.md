# ADR 0002: Prolly state roots, non-linear audit, async search

## Status

Proposed

## Context

Each store advances one global linear provenance chain (`root_hex`) inside the
same write transaction as merge/delete. That tip is both snapshot identity
(tip replay, agents, sync) and audit log (attribution, intent, suppress).
Writers serialize on the DB write lock; the linear head forces total order even
when mutations commute. Reconstruction is LWW over tip-outbox rows keyed by
that spine — order-sensitive and costly as history grows.

Separately, merge rebuilds `__mem_search_meta__` and related FTS for the primary
memory and 1-hop neighbors inside the write transaction. Those derived rows are
outside provenance `content_hashes` but inflate merge latency.

Leaf digests (`source_maps.content_hash`) and content-addressed blobs already
exist. Partitioned linear chains plus a Merkle rollup of heads would reduce
cross-component contention but deepen history-as-identity and make a later
state-tree migration a second breaking change to `rootHex`.

## Decision

We will split **what is** from **what happened**:

1. **State** — Prolly (or equivalent Merkle search tree) `stateRootHex` over
   content hashes and canonical graph digests. Equality, reconstruct, structural
   diff, and sync key off `stateRootHex` (order-independent).
2. **Audit** — Append-only commit objects `{ parents[], stateRootHex, event }`
   (git/Dolt-light). Do not advance a single sync global `H_n` in the write path.
   Event kinds and attribution stay; linking topology changes.
3. **Search** — Treat `__mem_search_meta__` / label-props / FTS / vectors as
   derived projections updated asynchronously from a search-index outbox.
4. **API** — Keep audit/commit tips distinct from `stateRootHex` so existing
   history pins do not silently change meaning.

We will not advertise a Merkle rollup of linear partition heads as the public
snapshot root. Verkle / ZK remain out of scope.

## Consequences

### Positive

- Snapshot/diff/sync scale with tree structure, not log length.
- Concurrent disjoint writes need not share one global audit parent CAS.
- Search fan-out leaves the commit critical path.
- Avoids a throwaway partition-rollup before Prolly.

### Negative

- Spec and persistence contracts grow (`stateRootHex`, commit DAG, capabilities).
- Stored `root_hex` pins need dual-read or invalidation during migration.
- Graph snapshots must be canonical before entering the state tree.
- Prolly adds \(O(\log N)\) node I/O per mutation.

### Neutral

- SQLite single-writer locking remains; less work per transaction still helps.
- Tip-outbox LWW may shrink once state-tree reconstruct lands.

## References

- Workstream: `.data/agent-review/workstreams/20261124T070726Z-15e124b/`
- Explanation: [`../explanation/state-root-and-audit.md`](../explanation/state-root-and-audit.md)
