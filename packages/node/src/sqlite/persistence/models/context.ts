import type { Database } from "bun:sqlite";
import type { MemoriesSqliteStmts } from "./prepared-stmts";

/** Passed through the data layer for writes (single `now` per operation / transaction). */
export type DbCtx = {
  db: Database;
  now: number;
  stmts: MemoriesSqliteStmts;
};
