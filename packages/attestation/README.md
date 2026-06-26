# @khoralabs/memories-attestation

Tree-shakeable contributor attestation helpers for Memories provenance.

This package builds and verifies signed attribution envelopes. It does not mutate stores and does not define auth policy; persistence/core store the envelope in provenance events, while hosts and auth layers decide when an attestation is required.

## Exports

- `@khoralabs/memories-attestation/attestation` — envelope validation and canonical payload helpers.
- `@khoralabs/memories-attestation/registry` — format-keyed verifier registry.
- `@khoralabs/memories-attestation/formats/direct-principal-v1` — embedded/local signed principal format.
- `@khoralabs/memories-attestation/formats/http-request-v1` — request-bound format constants and payload shape; full HTTP verification is deferred to service auth integration.
