import { describe, expect, test } from "bun:test";
import {
  createTursoGraphProjectionSource,
  loadMeanEmbeddingsForNamespace,
  loadMemoryTextPreview,
  type TursoProjectionQueryClient,
} from "./source";

describe("Turso graph projection source", () => {
  test("loads vector_extract JSON and text previews", async () => {
    const calls: string[] = [];
    const queryClient: TursoProjectionQueryClient = {
      async execute(statement, args) {
        const sql = typeof statement === "string" ? statement : statement.sql;
        const bindings = typeof statement === "string" ? args : statement.args;
        calls.push(sql);
        if (sql.includes("vector_extract")) {
          expect(bindings).toEqual(["app/user"]);
          return {
            rows: [
              { memory_id: "m1", key: "note", vector_json: "[1,3]" },
              { memory_id: "m1", key: "note", vector_json: "[3,5]" },
              { memory_id: "m2", key: "other", vector_json: [10, 12] },
            ],
          };
        }
        if (sql.includes("SELECT DISTINCT namespace")) {
          return { rows: [{ namespace: "app/user" }, { namespace: "app/user/child" }] };
        }
        return { rows: [{ text: "hello" }, { text: "world" }] };
      },
    };

    expect(await loadMeanEmbeddingsForNamespace(queryClient, "app/user")).toEqual([
      { memoryKey: "note", memoryId: "m1", embedding: [2, 4] },
      { memoryKey: "other", memoryId: "m2", embedding: [10, 12] },
    ]);
    expect(await loadMemoryTextPreview(queryClient, "app/user", "note")).toBe("hello\n\nworld");

    const source = createTursoGraphProjectionSource(queryClient);
    expect(await source.listNamespacesUnderPrefix("app/user")).toEqual([
      "app/user",
      "app/user/child",
    ]);
    expect(calls.some((sql) => sql.includes("sm.source_key NOT LIKE '__%'"))).toBe(true);
  });
});
