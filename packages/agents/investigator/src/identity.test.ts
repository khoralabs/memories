import { describe, expect, test } from "bun:test";
import { buildMemoryInvestigatorAgentId, defineMemoryInvestigatorIdentity } from "./identity.js";

describe("buildMemoryInvestigatorAgentId", () => {
  test("stable for same inputs", async () => {
    const a = await buildMemoryInvestigatorAgentId({ primaryNamespace: "ns/a" });
    const b = await buildMemoryInvestigatorAgentId({ primaryNamespace: "ns/a" });
    expect(a).toBe(b);
  });

  test("differs when additional namespaces change", async () => {
    const a = await buildMemoryInvestigatorAgentId({ primaryNamespace: "ns" });
    const b = await buildMemoryInvestigatorAgentId({
      primaryNamespace: "ns",
      additionalNamespaces: ["ns/b"],
    });
    expect(a).not.toBe(b);
  });
});

describe("defineMemoryInvestigatorIdentity", () => {
  test("staticHash changes when instructions change", async () => {
    const x = await defineMemoryInvestigatorIdentity("demo", { instructions: ["alpha"] });
    const y = await defineMemoryInvestigatorIdentity("demo", { instructions: ["beta"] });
    expect(x.staticHash).not.toBe(y.staticHash);
  });
});
