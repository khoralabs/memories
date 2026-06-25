import { describe, expect, test } from "bun:test";
import { connect } from "@tursodatabase/serverless";
import { NestedTransactionError, withWriteTransaction } from "./transactions";

describe("withWriteTransaction", () => {
  test("rejects nested transactions before opening a transaction", async () => {
    const writeConn = connect({ url: "https://example.invalid", authToken: "test" });
    const inTransaction = { current: true };

    await expect(
      withWriteTransaction(writeConn, inTransaction, async () => "ok"),
    ).rejects.toBeInstanceOf(NestedTransactionError);
  });
});
