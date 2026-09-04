import { z } from "zod";
import {
  MEMORIES_SERVICE_PROTOCOL_VERSION,
  type MemoriesServiceDiscovery,
  zMemoriesServiceAuthScheme,
  zMemoriesServiceDiscovery,
} from "../http/contracts/discovery";
import { MEMORIES_HTTP_PATH } from "../http/contracts/routes";
import { MemoriesServiceClientError, type MemoriesServiceFetch } from "./client";

const zDiscoveryVersionProbe = z.object({ version: z.number().int() });

export type DiscoverMemoriesServiceOptions = {
  baseUrl: string;
  fetch?: MemoriesServiceFetch;
  /** Expected protocol version; defaults to 1 (only version this client understands). */
  expectedVersion?: typeof MEMORIES_SERVICE_PROTOCOL_VERSION;
  /** When set, require the discovery document's authScheme to match. */
  requireAuthScheme?: MemoriesServiceDiscovery["authScheme"];
};

/**
 * Fetch and validate `GET /.well-known/memories` for a service base URL.
 */
export async function discoverMemoriesService(
  opts: DiscoverMemoriesServiceOptions,
): Promise<MemoriesServiceDiscovery> {
  const base = opts.baseUrl.trim().replace(/\/$/, "");
  if (base.length === 0) {
    throw new MemoriesServiceClientError("discoverMemoriesService: baseUrl is required", 400);
  }
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const res = await fetchFn(`${base}${MEMORIES_HTTP_PATH.wellKnown}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new MemoriesServiceClientError(
      `discoverMemoriesService: ${res.status} ${res.statusText}`,
      res.status,
      await res.text().catch(() => undefined),
    );
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new MemoriesServiceClientError("discoverMemoriesService: invalid JSON", 502);
  }
  const versionProbe = zDiscoveryVersionProbe.safeParse(json);
  if (!versionProbe.success) {
    throw new MemoriesServiceClientError(
      `discoverMemoriesService: response shape mismatch: ${versionProbe.error.message}`,
      502,
    );
  }
  const expected = opts.expectedVersion ?? MEMORIES_SERVICE_PROTOCOL_VERSION;
  if (versionProbe.data.version !== expected) {
    throw new MemoriesServiceClientError(
      `discoverMemoriesService: service protocol v${versionProbe.data.version}, client expects v${expected}`,
      409,
    );
  }
  const parsed = zMemoriesServiceDiscovery.safeParse(json);
  if (!parsed.success) {
    throw new MemoriesServiceClientError(
      `discoverMemoriesService: response shape mismatch: ${parsed.error.message}`,
      502,
    );
  }
  const doc = parsed.data;
  if (opts.requireAuthScheme !== undefined) {
    if (doc.authScheme === undefined) {
      throw new MemoriesServiceClientError(
        "discoverMemoriesService: service did not publish authScheme; cannot enforce requireAuthScheme",
        409,
      );
    }
    const want = zMemoriesServiceAuthScheme.parse(opts.requireAuthScheme);
    if (doc.authScheme !== want) {
      throw new MemoriesServiceClientError(
        `discoverMemoriesService: authScheme is '${doc.authScheme}', required '${want}'`,
        409,
      );
    }
  }
  return doc;
}
