# State roots vs audit commits

This is an **explanation** of how memories will separate snapshot identity from
mutation history. For the decision record, see
[ADR 0002](../adr/0002-prolly-state-root-and-audit.md). For operation shapes, see
`@khoralabs/memories-spec`.

## Two questions, two identifiers

| Question | Identifier | Properties |
|----------|------------|------------|
| Do these stores hold the same memories? | `stateRootHex` | Order-independent; cheap structural diff |
| Who changed what, with what intent? | Audit commit id / tip | Append-only; may fork; carries attribution |

Today’s shipped `root_hex` answers both by hashing a **linear mutation log**.
That couples snapshot equality to write order and forces a global append on
every successful mutation.

## State tree (Prolly)

Memories already compute per–source-map `content_hash` digests. A Prolly (Merkle
search) tree rolls those digests — plus canonical graph state — into a single
`stateRootHex`. Applying A then B yields the same root as B then A when the
final key→digest map matches. Reconstructing at a state root reads the tree
(and content-addressed blobs), not a full tip-outbox LWW replay. Diffing two
roots skips equal subtrees.

## Audit without a global linear head

Provenance event kinds (merge, delete, suppress, rename, …) remain. Instead of
`H_n = hash(H_{n-1} ‖ leaf)`, each mutation records a **commit** with zero or
more parents and a `stateRootHex`. Concurrent writers can fork; callers that
need a single “latest” resolve HEAD explicitly. The audit log stays
tamper-evident without serializing every write on one parent pointer.

## Derived search indexes

`__mem_search_meta__`, label-props chunks, FTS, and vectors are **projections**.
They are not part of provenance `content_hashes`. The commit path should enqueue
index work; a drain updates search. Search may lag merge unless a host opts into
a synchronous drain.

## What this does not change

- Contributor / intent attestation on events
- Namespace path grammar and public merge/search/delete shapes (aside from
  optional state-root fields as capabilities land)
- SQLite’s single-writer nature (less work per transaction still matters)
