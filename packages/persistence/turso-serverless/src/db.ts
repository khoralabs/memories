import type { Connection } from "@tursodatabase/serverless";
import type { Client } from "@tursodatabase/serverless/compat";
import type { TursoClients } from "./client";
import { execSql, queryAll, queryOne } from "./client";
import type { DbCtx } from "./context";

export type TursoDatabase = TursoClients;

function connForRead(ctx: DbCtx): Connection {
  return ctx.tx ?? ctx.db.read;
}

function connForWrite(ctx: DbCtx): Connection {
  return ctx.tx ?? ctx.db.write;
}

export async function ctxQueryAll<T extends Record<string, unknown>>(
  ctx: DbCtx,
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  return queryAll<T>(connForRead(ctx), sql, args);
}

export async function ctxQueryOne<T extends Record<string, unknown>>(
  ctx: DbCtx,
  sql: string,
  args: unknown[] = [],
): Promise<T | undefined> {
  return queryOne<T>(connForRead(ctx), sql, args);
}

export async function ctxExec(ctx: DbCtx, sql: string, args: unknown[] = []): Promise<void> {
  await execSql(connForWrite(ctx), sql, args);
}

export async function readQueryAll<T extends Record<string, unknown>>(
  db: TursoDatabase,
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  return queryAll<T>(db.read, sql, args);
}

export async function readQueryOne<T extends Record<string, unknown>>(
  db: TursoDatabase,
  sql: string,
  args: unknown[] = [],
): Promise<T | undefined> {
  return queryOne<T>(db.read, sql, args);
}

export type { Client, Connection };
