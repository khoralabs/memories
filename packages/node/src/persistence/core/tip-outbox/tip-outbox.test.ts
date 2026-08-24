import { describe, expect, test } from "bun:test";
import { buildTipOutboxAppend } from "./append";
import { validateKeysForFacet } from "./facets";
import { float32Bytes, float32FromBytes, payloadSha256, utf8Bytes } from "./payload";
import {
  buildTipOutboxLwwQuery,
  LEGACY_CONTENT_TABLES,
  SQL_SELECT_TIP_BLOB,
  UNIFIED_TIP_TABLES,
} from "./replay-sql";
import { resolveTipPayloadRows } from "./resolve-payload";
import type { TipOutboxLwwRow, TipOutboxSqlDeps } from "./types";

describe("TipOutbox core", () => {
  test("payloadSha256 is stable", () => {
    const a = payloadSha256(utf8Bytes("hello"));
    const b = payloadSha256(utf8Bytes("hello"));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  test("float32 roundtrip", () => {
    const vec = [0.1, 0.2, 0.3, ...Array(509).fill(0)];
    const bytes = float32Bytes(vec);
    const back = float32FromBytes(bytes);
    expect(back.length).toBe(512);
    expect(back[0]).toBeCloseTo(0.1);
  });

  test("validateKeysForFacet content requires sourceKey", () => {
    expect(() => validateKeysForFacet("content", { namespace: "ns", memoryKey: "k" })).toThrow(
      /sourceKey/,
    );
  });

  test("buildTipOutboxAppend produces blob for payload", () => {
    const built = buildTipOutboxAppend({
      rootHex: "aa".repeat(32),
      facet: "content",
      eventType: "MERGE_MEMORY",
      keys: { namespace: "ns", memoryKey: "k", sourceKey: "text" },
      payload: utf8Bytes("body"),
      now: 1,
      rowId: "id1",
    });
    expect(built.outbox.payloadSha256).not.toBeNull();
    expect(built.hotBlob?.payload).toBeDefined();
  });

  test("graph facet accepts edgeId", () => {
    expect(() => validateKeysForFacet("graph", { namespace: "ns", edgeId: "e1" })).not.toThrow();
  });

  test("buildTipOutboxLwwQuery binds scope params twice for delete and merge CTEs", () => {
    const { sql, params } = buildTipOutboxLwwQuery(
      "aa".repeat(32),
      { facet: "content", namespace: "ns", memoryKey: "k" },
      UNIFIED_TIP_TABLES,
    );
    const placeholders = sql.match(/\?/g)?.length ?? 0;
    expect(params).toEqual(["aa".repeat(32), "ns", "k", "ns", "k"]);
    expect(placeholders).toBe(params.length);
    expect(sql).toContain("o.namespace = lm.namespace");
    expect(sql).toContain("o.source_key = lm.source_key");
  });

  test("buildTipOutboxLwwQuery groups graph by edge_id", () => {
    const { sql } = buildTipOutboxLwwQuery("bb".repeat(32), { facet: "graph" }, UNIFIED_TIP_TABLES);
    expect(sql).toContain("o.namespace, o.memory_key, o.edge_id");
    expect(sql).toContain("o.edge_id = lm.edge_id");
  });

  test("buildTipOutboxLwwQuery provenance delete uses root_hex", () => {
    const { sql } = buildTipOutboxLwwQuery(
      "cc".repeat(32),
      { facet: "provenance" },
      UNIFIED_TIP_TABLES,
    );
    expect(sql).toContain("ld.root_hex = lm.root_hex");
    expect(sql).not.toContain("ld.namespace");
  });

  test("buildTipOutboxLwwQuery legacy tables use content_sha256", () => {
    const { sql } = buildTipOutboxLwwQuery(
      "dd".repeat(32),
      { facet: "content", namespace: "ns", memoryKey: "k" },
      LEGACY_CONTENT_TABLES,
    );
    expect(sql).toContain("o.content_sha256 AS payloadSha256");
    expect(sql).not.toContain("o.payload_sha256");
    expect(sql).not.toContain("o.facet");
    expect(sql).not.toContain("o.edge_id");
  });

  test("resolveTipPayloadRows reads hot payload from DB", async () => {
    const sha = payloadSha256(utf8Bytes("stored"));
    const deps: TipOutboxSqlDeps = {
      queryAll: async <T extends Record<string, unknown>>(sql: string, params: unknown[]) => {
        expect(sql).toBe(SQL_SELECT_TIP_BLOB);
        expect(params).toEqual([sha]);
        return [{ location: "hot", payload: utf8Bytes("stored") }] as unknown as T[];
      },
      exec: async () => {},
    };
    const rows: TipOutboxLwwRow[] = [
      {
        facet: "content",
        namespace: "ns",
        memoryKey: "k",
        sourceKey: "text",
        edgeId: null,
        payloadSha256: sha,
        blobBytes: null,
        blobText: null,
        location: null,
        coldUri: null,
      },
    ];
    const resolved = await resolveTipPayloadRows(deps, rows);
    expect(resolved).toEqual([{ payloadSha256: sha, bytes: utf8Bytes("stored") }]);
  });
});
