import { type Config, type Connection, connect } from "@tursodatabase/serverless";
import { type Client, createClient } from "@tursodatabase/serverless/compat";

export type TursoCredentials = {
  url: string;
  authToken?: string;
  remoteEncryptionKey?: string;
};

export type TursoClients = {
  config: Config;
  read: Connection;
  write: Connection;
  batch: Client;
};

export type CreateTursoClientsOptions = TursoCredentials & {
  read?: Connection;
  write?: Connection;
  batch?: Client;
};

/** Build read/write connections and a compat batch client (injectable for tests). */
export function createTursoClients(options: CreateTursoClientsOptions): TursoClients {
  const config: Config = {
    url: options.url,
    authToken: options.authToken,
    remoteEncryptionKey: options.remoteEncryptionKey,
  };
  return {
    config,
    read: options.read ?? connect(config),
    write: options.write ?? connect(config),
    batch: options.batch ?? createClient(config),
  };
}

export type SqlRow = Record<string, unknown>;

/** Normalize Turso/libSQL row objects to plain records with camelCase aliases preserved. */
export function normalizeRows<T extends SqlRow>(result: { rows?: readonly SqlRow[] }): T[] {
  if (!result.rows) return [];
  return result.rows.map((row) => {
    const out: SqlRow = {};
    for (const [key, value] of Object.entries(row)) {
      if (/^\d+$/.test(key)) continue;
      out[key] = value;
    }
    return out as T;
  });
}

export async function queryAll<T extends SqlRow>(
  conn: Connection,
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  const result = await conn.execute(sql, args);
  return normalizeRows<T>(result);
}

export async function queryOne<T extends SqlRow>(
  conn: Connection,
  sql: string,
  args: unknown[] = [],
): Promise<T | undefined> {
  const rows = await queryAll<T>(conn, sql, args);
  return rows[0];
}

export async function execSql(conn: Connection, sql: string, args: unknown[] = []): Promise<void> {
  await conn.execute(sql, args);
}

export async function execMultiple(conn: Connection, sql: string): Promise<void> {
  await conn.exec(sql);
}
