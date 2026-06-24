# Decentralized principal auth

DID-based authorization for the HTTP adapter: clients prove control of a principal, optionally present delegation from the database owner, and verify revocation without server-local grant state.

**Status:** Not implemented. Shipped auth schemes are `none` and `server-admin` only.

## Goal

With `MEMORIES_SERVICE_AUTH=did-principal`, a client can access a database when it:

1. Proves control of the DID named by `database.ownerKey`, or
2. Presents a valid grant from that DID (or an authorized delegate)

The core `@khoralabs/memories-service` package stays unchanged. All DID verification, nonce handling, credential parsing, and revocation checks live in `@khoralabs/memories-service-auth`.

## Auth scheme

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

Namespace scoping (optional grant field) applies at the auth layer before any future HTTP memory APIs call into persistence.

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

| Approach | Pros | Cons |
|----------|------|------|
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

Credentials must be canonicalized before signing (canonical JSON or typed binary) so all nodes verify the same bytes.

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

**Availability:** nodes need a way to fetch the issuer's latest log, cache freshness policy, and fail-closed behavior when the log is unavailable (safer for database access than fail-open).

## Dependencies

- `@khoralabs/relay-contracts` — header names and message format
- `@khoralabs/relay-crypto` — DID key resolution and signature verification
- Nonce store (same pattern as Relay/Khora)

## Implementation order

1. `did-principal` strategy with direct owner proof only (no grants)
2. Service-level or embedded grant registry for delegation
3. Portable signed credentials + canonicalization
4. Issuer-signed revocation log + fetch/cache policy

## Open questions

- Default grant storage before portable credentials ship?
- Credential wire format: header, body field, or separate `/credentials` exchange?
- How should organization databases authorize members vs the org DID directly?
