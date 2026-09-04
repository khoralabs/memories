import { z } from "zod";
import { MEMORIES_HTTP_PATH } from "./routes";

/** Protocol version for `GET /.well-known/memories` (additive fields stay on v1). */
export const MEMORIES_SERVICE_PROTOCOL_VERSION = 1 as const;

export const zMemoriesServiceAuthScheme = z.enum([
  "none",
  "server-admin",
  "app-policy",
  "did-principal",
]);

export const zMemoriesServiceDiscovery = z.object({
  version: z.literal(MEMORIES_SERVICE_PROTOCOL_VERSION),
  endpoints: z.object({
    health: z.string(),
    wellKnown: z.string(),
  }),
  authScheme: zMemoriesServiceAuthScheme.optional(),
});

export type MemoriesServiceDiscovery = z.infer<typeof zMemoriesServiceDiscovery>;

export function buildMemoriesServiceDiscovery(opts?: {
  authScheme?: z.infer<typeof zMemoriesServiceAuthScheme>;
}): MemoriesServiceDiscovery {
  const doc: MemoriesServiceDiscovery = {
    version: MEMORIES_SERVICE_PROTOCOL_VERSION,
    endpoints: {
      health: MEMORIES_HTTP_PATH.health,
      wellKnown: MEMORIES_HTTP_PATH.wellKnown,
    },
  };
  if (opts?.authScheme !== undefined) {
    doc.authScheme = opts.authScheme;
  }
  return zMemoriesServiceDiscovery.parse(doc);
}
