import type { Connection } from "@tursodatabase/serverless";
import type { InStatement } from "@tursodatabase/serverless/compat";
import type { DbCtx } from "./context";

export class NestedTransactionError extends Error {
  constructor() {
    super("Nested transactions are not supported for Turso serverless persistence");
    this.name = "NestedTransactionError";
  }
}

/** Run `fn` inside a write connection transaction (parameterized execute, read-your-writes for relational rows). */
export async function withWriteTransaction<T>(
  writeConn: Connection,
  inTransaction: { current: boolean },
  fn: (tx: Connection) => Promise<T>,
): Promise<T> {
  if (inTransaction.current) {
    throw new NestedTransactionError();
  }
  const wrapped = writeConn.transaction(async () => {
    inTransaction.current = true;
    try {
      return await fn(writeConn);
    } finally {
      inTransaction.current = false;
    }
  });
  return wrapped();
}

/** Submit parameterless DDL/DML strings as one atomic compat batch (migrations). */
export async function batchWriteStatements(
  batchClient: { batch(stmts: InStatement[], mode?: "write"): Promise<unknown> },
  statements: string[],
): Promise<void> {
  if (statements.length === 0) return;
  await batchClient.batch(statements, "write");
}

export function txCtx(base: DbCtx, tx: Connection): DbCtx {
  return { ...base, tx };
}
