import { AuthStrategyError, type MemoriesDatabaseAccessStrategy } from "./types";

export type ServerAdminAuthStrategyOptions = {
  adminToken: string;
};

function readBearerToken(req: Request): string | undefined {
  const header = req.headers.get("authorization")?.trim();
  if (header === undefined || header.length === 0) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim();
}

export function createServerAdminAuthStrategy(
  opts: ServerAdminAuthStrategyOptions,
): MemoriesDatabaseAccessStrategy {
  const expected = opts.adminToken.trim();
  if (expected.length === 0) {
    throw new Error("Server admin token is required");
  }

  return {
    async authenticate(req: Request) {
      const token = readBearerToken(req);
      if (token === undefined || token.length === 0) {
        throw new AuthStrategyError("Authorization bearer token required", 401);
      }
      if (token !== expected) {
        throw new AuthStrategyError("Invalid admin token", 401);
      }
      return { scheme: "server-admin", subject: "server-admin" };
    },
    async authorize() {
      return;
    },
  };
}
