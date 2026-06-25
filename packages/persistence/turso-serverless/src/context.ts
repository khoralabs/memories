import type { Connection } from "@tursodatabase/serverless";
import type { TursoDatabase } from "./db";

/** Passed through the data layer for writes (single `now` per operation / transaction). */
export type DbCtx = {
  db: TursoDatabase;
  now: number;
  /** Set during `withTransaction` so reads/writes share one transactional connection. */
  tx?: Connection;
};

export function readCtx(db: TursoDatabase): DbCtx {
  return { db, now: 0 };
}

export function writeCtx(db: TursoDatabase, now: number, tx?: Connection): DbCtx {
  return { db, now, tx };
}
