# Exedra integration

Migrate Exedra from inline database management to `@khoralabs/memories-service` packages.

**Status:** Packages exist; Exedra still uses its own store and path helpers.

## Current Exedra layout

```text
{EXEDRA_DATA_DIR}/memories/organizations/{orgDid}/{orgDid}.db
{EXEDRA_DATA_DIR}/memories/accounts/{accountDid}/{accountDid}.db
```

Relevant Exedra files:

- `app/src/server/memories/store.ts` — lazy open/cache
- `app/src/server/storage/paths.ts` — principal → path
- `app/src/server/memories/paths.ts` — org/account specialization
- `app/src/server/memories/access.ts` — authorization outside Memories repo

## Target wiring

```ts
const { service } = createLocalSqliteServiceStack({
  dataDir: exedraDataDir,
  sqlCipherKey: process.env.MEMORIES_SQLCIPHER_KEY!,
});
```

Replace `store.ts` open/cache with `service.open()`. Keep namespace builders and access policy in Exedra; use `app-policy` auth when that strategy ships.

## Path compatibility

Default service layout uses opaque encoded owner keys:

```text
{dataDir}/v1/{kind}/{base64url(ownerKey)}/{base64url(ownerKey)}.db
```

Exedra today uses readable DID paths. Migration options:

1. **Compatibility encoder** — reproduce `{kind}/{did}/{did}.db` under `v1` or a dedicated preset
2. **One-time migration** — copy databases from old paths to encoded layout
3. **Placement override** — point existing principals at a custom `dataDir` preset during rollout

The core package exports `createReversibleOwnerKeyEncoder()` and `resolveEncodedDatabasePath()`. A compatibility preset can live in Exedra or a small adapter package.

## Routing layers (preserve distinction)

| Layer | Owner | Concern |
|-------|-------|---------|
| Database routing | Memories service | Which principal database |
| Namespace routing | Exedra app | Org, team, session scope inside a database |

## Suggested migration steps

1. Wire `createLocalSqliteServiceStack` in Exedra behind a feature flag
2. Map org/account DIDs to `{ kind: "organization" | "account", ownerKey: did }`
3. Choose path compatibility strategy and migrate data if needed
4. Remove duplicate open/cache logic from `store.ts`
5. Adopt `app-policy` auth in the HTTP adapter if Exedra exposes management routes
6. Defer DID principal auth until a decentralized client exists

## Non-goals for Exedra migration

- Moving team/session namespace design into memories-service
- Changing Exedra's ontology or graph projections
