import type { MemoriesPersistenceAsync } from "@khoralabs/memories-core/persistence";
import { createMemoriesTursoServerlessPersistence } from "./persistence";

export function hasTursoIntegrationEnv(): boolean {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const token = process.env.TURSO_AUTH_TOKEN?.trim();
  return Boolean(url && token);
}

export function requireTursoIntegrationEnv(): { url: string; authToken: string } {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const token = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url || !token) {
    throw new Error(
      "Turso integration tests require TURSO_DATABASE_URL and TURSO_AUTH_TOKEN environment variables",
    );
  }
  return { url, authToken: token };
}

/** Open a persistence handle against the env-configured Turso database (runs migrations). */
export async function openTursoTestPersistence(): Promise<MemoriesPersistenceAsync> {
  const { url, authToken } = requireTursoIntegrationEnv();
  return createMemoriesTursoServerlessPersistence({ url, authToken, autoMigrate: true });
}
