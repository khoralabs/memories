import type { TursoCredentials } from "@khoralabs/memories-node/turso-serverless";
import type { MemoriesDatabaseId, TursoServerlessBackendStrategy } from "../../storage-core/index";
import { validateMemoriesDatabaseId } from "../../storage-core/index";

const OWNER_KEY_PLACEHOLDER = "{ownerKey}";
const KIND_PLACEHOLDER = "{kind}";

/** Substitute `{ownerKey}` and `{kind}` in a Turso URL template for one principal database. */
export function resolveTursoDatabaseUrl(
  strategy: TursoServerlessBackendStrategy,
  id: MemoriesDatabaseId,
): string {
  const validated = validateMemoriesDatabaseId(id);
  return strategy.url
    .replaceAll(OWNER_KEY_PLACEHOLDER, encodeURIComponent(validated.ownerKey))
    .replaceAll(KIND_PLACEHOLDER, encodeURIComponent(validated.kind));
}

/** Resolve remote credentials for one principal's Turso database. */
export function resolveTursoCredentials(
  strategy: TursoServerlessBackendStrategy,
  id: MemoriesDatabaseId,
): TursoCredentials {
  return {
    url: resolveTursoDatabaseUrl(strategy, id),
    authToken: strategy.authToken,
    remoteEncryptionKey: strategy.remoteEncryptionKey,
  };
}
