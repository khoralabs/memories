import { type Client, createClient, type InArgs, type InStatement } from "@libsql/client";

export type LibsqlCredentials = {
  url: string;
  authToken?: string;
  /** At-rest encryption for local `file:` databases. */
  encryptionKey?: string;
};

export type LibsqlDatabase = {
  client: Client;
};

export type CreateLibsqlClientOptions = LibsqlCredentials & {
  client?: Client;
};

/** Open a libSQL client (local `file:` / `:memory:` or remote `libsql:`). */
export function createLibsqlDatabase(options: CreateLibsqlClientOptions): LibsqlDatabase {
  const client =
    options.client ??
    createClient({
      url: options.url,
      authToken: options.authToken,
      encryptionKey: options.encryptionKey,
    });
  return { client };
}

export type SqlRow = Record<string, unknown>;

/** Normalize libSQL row objects to plain records (skip numeric index keys). */
export function normalizeRows<T extends SqlRow>(rows: readonly SqlRow[]): T[] {
  return rows.map((row) => {
    const out: SqlRow = {};
    for (const [key, value] of Object.entries(row)) {
      if (/^\d+$/.test(key)) continue;
      out[key] = value;
    }
    return out as T;
  });
}

function toArgs(args: unknown[]): InArgs {
  return args as InArgs;
}

export async function queryAll<T extends SqlRow>(
  executor: { execute(stmt: InStatement): Promise<{ rows: readonly SqlRow[] }> },
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  const result = await executor.execute({ sql, args: toArgs(args) });
  return normalizeRows<T>(result.rows);
}

export async function queryOne<T extends SqlRow>(
  executor: { execute(stmt: InStatement): Promise<{ rows: readonly SqlRow[] }> },
  sql: string,
  args: unknown[] = [],
): Promise<T | undefined> {
  const rows = await queryAll<T>(executor, sql, args);
  return rows[0];
}

export async function execSql(
  executor: { execute(stmt: InStatement): Promise<unknown> },
  sql: string,
  args: unknown[] = [],
): Promise<void> {
  await executor.execute({ sql, args: toArgs(args) });
}

export async function execMultiple(
  executor: { executeMultiple(sql: string): Promise<void> },
  sql: string,
): Promise<void> {
  await executor.executeMultiple(sql);
}

export type { Client, InStatement };
export { createClient };
