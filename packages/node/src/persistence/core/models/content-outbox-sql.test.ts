import { describe, expect, test } from "bun:test";
import { buildLwwArmsQuery, hitsFromHot, sqlEvacuateCandidates } from "./content-outbox-sql";

describe("content-outbox-sql", () => {
  test("buildLwwArmsQuery scoped binds namespace and key twice", () => {
    const { sql, params } = buildLwwArmsQuery("root", { namespace: "ns", memoryKey: "k" });
    expect(sql).toContain("AND o.namespace = ? AND o.memory_key = ?");
    expect(params).toEqual(["root", "ns", "k", "ns", "k"]);
  });

  test("buildLwwArmsQuery unscoped only binds root", () => {
    const { sql, params } = buildLwwArmsQuery("root", null);
    expect(sql).not.toContain("AND o.namespace = ?");
    expect(params).toEqual(["root"]);
  });

  test("hitsFromHot skips null blob text", () => {
    expect(
      hitsFromHot([
        {
          namespace: "ns",
          memoryKey: "k",
          sourceKey: "a",
          contentSha256: "x",
          blobText: "hi",
          location: "hot",
          coldUri: null,
        },
        {
          namespace: "ns",
          memoryKey: "k",
          sourceKey: "b",
          contentSha256: "y",
          blobText: null,
          location: "cold",
          coldUri: "u",
        },
      ]),
    ).toEqual([{ namespace: "ns", memoryKey: "k", sourceKey: "a", text: "hi" }]);
  });

  test("sqlEvacuateCandidates uses N placeholders", () => {
    expect(sqlEvacuateCandidates(3)).toContain("IN (?,?,?)");
  });
});
