# `@khoralabs/memories-service-storage-libsql`

Local multi-tenant **libSQL file** node backend for the Memories database service. Maps a placement strategy to per-principal `file:` databases under `dataDir` (same encoded path layout as SQLite).

## Strategy

```ts
type LibsqlBackendStrategy = {
  kind: "libsql";
  dataDir: string;
  /** Optional at-rest encryption (passed through to `@libsql/client`). */
  encryptionKey?: string;
  capabilities?: Partial<MemoriesBackendCapabilities>;
};
```

Path layout matches sqlite: `{dataDir}/v1/{base64url([kind,ownerKey])}/database.db`.

## Usage

```ts
import { createLocalLibsqlBackendFactory } from "@khoralabs/memories-service-storage-libsql";
import { createCompositeBackendFactory, createBackendResolver } from "@khoralabs/memories-service";

const factory = createCompositeBackendFactory({
  libsql: createLocalLibsqlBackendFactory(),
  // …sqlite, turso-serverless
});

await placement.setStrategy(id, {
  kind: "libsql",
  dataDir: "/var/lib/memories-libsql",
  encryptionKey: process.env.MEMORIES_LIBSQL_KEY,
});
```

## Contrast

| Backend | Layout | Persistence |
|--------|--------|-------------|
| `sqlite` | Encoded paths under `dataDir` | `@khoralabs/memories-sqlite` (SQLCipher) |
| `libsql` | Same encoded paths | `@khoralabs/memories-libsql` (`encryptionKey`) |
| `turso-serverless` | Remote URL templates | `@khoralabs/memories-turso-serverless` |

Control-plane registries (placement / ontology) stay on SQLite; this package is data plane only.

Shared adapter rules: [`../IMPLEMENTORS.md`](../IMPLEMENTORS.md).
