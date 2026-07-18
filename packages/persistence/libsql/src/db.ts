import type { Client, Transaction } from "@libsql/client";
import type { LibsqlDatabase } from "./client";
import { execSql, queryAll, queryOne } from "./client";
import type { DbCtx } from "./context";

export type { LibsqlDatabase };

type SqlExecutor = Client | Transaction;

function executorForRead(ctx: DbCtx): SqlExecutor {
  return ctx.tx ?? ctx.db.client;
}

function executorForWrite(ctx: DbCtx): SqlExecutor {
  return ctx.tx ?? ctx.db.client;
}

export async function ctxQueryAll<T extends Record<string, unknown>>(
  ctx: DbCtx,
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  return queryAll<T>(executorForRead(ctx), sql, args);
}

export async function ctxQueryOne<T extends Record<string, unknown>>(
  ctx: DbCtx,
  sql: string,
  args: unknown[] = [],
): Promise<T | undefined> {
  return queryOne<T>(executorForRead(ctx), sql, args);
}

export async function ctxExec(ctx: DbCtx, sql: string, args: unknown[] = []): Promise<void> {
  await execSql(executorForWrite(ctx), sql, args);
}

export async function readQueryAll<T extends Record<string, unknown>>(
  db: LibsqlDatabase,
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  return queryAll<T>(db.client, sql, args);
}

export async function readQueryOne<T extends Record<string, unknown>>(
  db: LibsqlDatabase,
  sql: string,
  args: unknown[] = [],
): Promise<T | undefined> {
  return queryOne<T>(db.client, sql, args);
}

export type { Client, Transaction };
