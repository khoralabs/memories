import type { Transaction } from "@libsql/client";
import type { LibsqlDatabase } from "./client";

/** Passed through the data layer for writes (single `now` per operation / transaction). */
export type DbCtx = {
  db: LibsqlDatabase;
  now: number;
  /** Set during `withTransaction` so reads/writes share one interactive transaction. */
  tx?: Transaction;
};

export function readCtx(db: LibsqlDatabase): DbCtx {
  return { db, now: 0 };
}

export function writeCtx(db: LibsqlDatabase, now: number, tx?: Transaction): DbCtx {
  return { db, now, tx };
}
