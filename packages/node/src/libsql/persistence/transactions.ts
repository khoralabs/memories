import type { Client, InStatement, Transaction } from "@libsql/client";
import type { DbCtx } from "./context";

export class NestedTransactionError extends Error {
  constructor() {
    super("Nested transactions are not supported for LibSQL persistence");
    this.name = "NestedTransactionError";
  }
}

/** Run `fn` inside an interactive write transaction (nested calls rejected). */
export async function withWriteTransaction<T>(
  client: Client,
  inTransaction: { current: boolean },
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (inTransaction.current) {
    throw new NestedTransactionError();
  }
  inTransaction.current = true;
  const tx = await client.transaction("write");
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* ignore rollback errors */
    }
    throw err;
  } finally {
    try {
      tx.close();
    } catch {
      /* already closed after commit/rollback on some drivers */
    }
    inTransaction.current = false;
  }
}

/** Submit parameterless DDL/DML strings as one atomic batch (migrations). */
export async function batchWriteStatements(
  client: { batch(stmts: InStatement[], mode?: "write"): Promise<unknown> },
  statements: string[],
): Promise<void> {
  if (statements.length === 0) return;
  await client.batch(
    statements.map((sql) => ({ sql })),
    "write",
  );
}

export function txCtx(base: DbCtx, tx: Transaction): DbCtx {
  return { ...base, tx };
}
