import type {
  MemoriesDatabaseId,
  TursoServerlessBackendStrategy,
} from "@khoralabs/memories-service";
import { validateMemoriesDatabaseId } from "@khoralabs/memories-service";
import type { TursoCredentials } from "@khoralabs/memories-turso-serverless";

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
