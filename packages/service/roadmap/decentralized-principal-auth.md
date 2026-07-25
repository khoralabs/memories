# Decentralized principal auth

DID-based authorization for the HTTP adapter: clients prove control of a principal, optionally present delegation from the database owner, and verify revocation without server-local grant state.

**Status:** Phase 1 shipped. Attestation formats (`@khoralabs/memories-node/attestation`) and server-side HTTP attribution (`MemoriesServiceHttpOptions.attribution` on `@khoralabs/memories-service/http`) are live. The `did-principal` auth scheme, DID proof verification, nonce handling, and delegation grants are not yet implemented.

Shipped auth schemes today (`@khoralabs/memories-service/auth`): `none`, `server-admin`, `app-policy`. See [README.md](./README.md) for related planned work (placement admin).

## What is shipped

### `@khoralabs/memories-node/attestation`

Formats for cryptographically signed contributor envelopes stored in provenance events:

- **`khora.direct-principal-v1`** — caller-signed attestation binding a principal to a merge/delete scope. Used for in-process attribution where the caller controls the signing key.
- **`khora.http-request-v1`** — server-signed attestation binding a principal to an HTTP request (method, path, `SHA-256(body)`, `issuedAt`). Built server-side; never trusted from clients.

Both formats share the same `ContributorAttestation` envelope (`v`, `format`, `principal`, `payload`, `signature`, `alg?`, `keyId?`) and the same build/decode/verify pattern with caller-supplied sign and verify callbacks. Canonicalization helpers: `canonicalPayloadBytes` / `canonicalJson`.

### HTTP-safe attribution (`@khoralabs/memories-service/http`)

`MemoriesServiceHttpOptions.attribution` lets operators configure server-side contributor signing:

```ts
import { createMemoriesServiceHttpServer } from "@khoralabs/memories-service/http";
import { createServerAdminAuthStrategy } from "@khoralabs/memories-service/auth";

createMemoriesServiceHttpServer({
  service,
  auth: createServerAdminAuthStrategy(token),
  attribution: {
    sign: myServerSigningKey.sign,
    principalForActor: (actor) => `${actor.scheme}:${actor.subject}`,
    alg: "EdDSA",
    keyId: "did:key:z-server#key",
  },
});
```

On every merge or delete request:

1. `auth.authenticate` and `auth.authorize` run first
2. A `khora.http-request-v1` attestation is built from the returned `AuthenticatedActor` and request metadata (method, path, body SHA-256, issuedAt)
3. The attestation is injected as `attribution.contributor` before persistence; any client-supplied `contributor` is stripped
4. Clients may send `intentSnapshotId` at the top level of merge/delete request bodies; this is preserved and written to `intent_snapshot_id`

Client-side (`RemoteMemoriesClientAsync`): `attribution.contributor` is stripped before wire serialization; `attribution.intentSnapshotId` is promoted to top-level `intentSnapshotId`.

## Goal

With `MEMORIES_SERVICE_AUTH=did-principal`, a client can access a database when it:

1. Proves control of the DID named by `database.ownerKey`, or
2. Presents a valid grant from that DID (or an authorized delegate)

The core service lifecycle stays unchanged. DID verification, nonce handling, credential parsing, and revocation checks live in `@khoralabs/memories-service/auth`.

## Auth scheme (not yet implemented)

Add to `MemoriesServiceAuthScheme`:

```text
MEMORIES_SERVICE_AUTH=did-principal
```

One scheme per service instance, consistent with existing env-based selection.

### Request proof

Reuse the Khora/Relay request signature format:

- Headers: `X-Agent-Did`, `X-Agent-Timestamp`, `X-Agent-Nonce`, `X-Agent-Signature`
- Signed message: `METHOD\nPATH\ntimestamp\nnonce\nsha256(body)`
- `@khoralabs/relay-crypto` resolves `did:key` Ed25519 public keys from the DID

Constraints:

- Bind proof to method, path, and body hash
- Reject stale timestamps and nonce reuse (nonce store)
- Do not treat the URL or body owner key as authoritative when the signed payload says otherwise

Verifier interface (not hardcoded to one DID method):

```ts
type PrincipalProofVerifier = {
  verify(input: {
    expectedDid: string;
    method: string;
    request: Request;
  }): Promise<{ did: string; keyId?: string }>;
};
```

### Authorization rules

For `MemoriesDatabaseId { kind, ownerKey }`:

- Direct access: request signer controls `ownerKey` as a DID
- Delegated access: signer controls `subjectDid` and presents a grant where `issuerDid` is authorized for `database.ownerKey`

Actions map to existing `DatabaseAction` values: `read`, `write`, `manage`.

Namespace scoping (optional grant field) applies at the auth layer before any HTTP memory APIs call into persistence.

## Delegation grants

Delegation is only required in the DID strategy. One DID authorizes another principal or service to access its database.

Initial in-memory grant shape:

```ts
type DidDatabaseGrant = {
  issuerDid: string;
  subjectDid: string;
  database: MemoriesDatabaseId;
  actions: Array<"read" | "write" | "manage">;
  namespaces?: string[];
  expiresAt?: string;
};
```

The grant issuer must match `database.ownerKey` or be an already-authorized administrator of that DID. The subject proves control of its own DID on each request, then presents the grant.

### Grant storage (open choice)

| Approach | Storage | Pros | Cons |
|----------|---------|------|------|
| Embedded in principal database | Travels with data | Bootstrap problem: need access to read grants |
| Service-level registry | Simple, fast | Server state outside the database file |
| Portable signed credentials | No server storage; works across nodes | Stronger format and revocation story required |

**Preferred long-term:** portable signed credentials (below).

## Portable signed credentials

The database owner signs a credential naming subject, database, actions, optional namespaces, and expiry. The server verifies the issuer signature and checks revocation; it does not need to store the grant.

```ts
type DidDatabaseGrantCredential = {
  credentialId: string;
  issuerDid: string;
  subjectDid: string;
  database: MemoriesDatabaseId;
  actions: Array<"read" | "write" | "manage">;
  namespaces?: string[];
  issuedAt: string;
  expiresAt?: string;
};
```

Per-request verification:

- Request signer controls `subjectDid`
- Credential signature verifies under `issuerDid`
- `issuerDid` is authorized for `database.ownerKey`
- Requested action and namespace are included
- Credential is within validity window
- Credential is not revoked

Credentials must be canonicalized before signing (canonical JSON or typed binary) so all nodes verify the same bytes. Reuse `canonicalPayloadBytes` / `canonicalJson` from `@khoralabs/memories-node/attestation`.

## Issuer-signed revocation log

For portable credentials, revocation is an append-only log signed by the issuer:

```ts
type DidGrantRevocationEvent = {
  issuerDid: string;
  sequence: number;
  revokedCredentialId: string;
  revokedAt: string;
  reason?: string;
  previousEventHash?: string;
};
```

Verification:

- Every event signature verifies under the issuer DID
- `sequence` increases without gaps per issuer
- `previousEventHash` chains to the prior canonical event hash
- Credential id is absent from the verified revoked set

**Availability:** nodes need a way to fetch the issuer's latest log, a cache freshness policy, and fail-closed behavior when the log is unavailable.

## Integration with HTTP attribution

When `did-principal` auth ships, `MemoriesServiceHttpOptions.attribution` gains a natural `principalForActor` that maps the verified DID to the `khora.http-request-v1` principal:

```ts
attribution: {
  sign: serverKey.sign,
  principalForActor: (actor) => actor.subject, // actor.subject is the verified DID
  keyId: serverKey.id,
  alg: "EdDSA",
}
```

Provenance events will carry server-attested HTTP attribution from day one without any change to persistence. The `contributor` in `event_json` will reflect the request signer's DID once DID auth is active — no migration required.

## Dependencies

- `@khoralabs/relay-contracts` — header names and message format
- `@khoralabs/relay-crypto` — DID key resolution and signature verification
- Nonce store (same pattern as Relay/Khora)
- `@khoralabs/memories-node/attestation` — already shipped; `canonicalPayloadBytes` reusable for credential signing

## Implementation order

1. `did-principal` strategy with direct owner proof only (no grants)
2. Service-level or embedded grant registry for delegation
3. Portable signed credentials + canonicalization
4. Issuer-signed revocation log + fetch/cache policy

## Open questions

- Default grant storage before portable credentials ship?
- Credential wire format: header, body field, or separate `/credentials` exchange?
- How should organization databases authorize members vs the org DID directly?
