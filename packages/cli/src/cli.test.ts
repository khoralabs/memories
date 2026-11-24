import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const CLI = path.join(import.meta.dir, "cli.ts");
const run = (...args: string[]) =>
  Bun.spawnSync(["bun", CLI, ...args], { stdout: "pipe", stderr: "pipe" });

test("help and --version", () => {
  expect(run("help").stdout.toString()).toContain("integrate-plan");
  expect(run("--version").stdout.toString().trim()).toMatch(/^\d+\.\d+\.\d+/);
});

test("write → search → get → provenance round trip", () => {
  const db = path.join(mkdtempSync(path.join(tmpdir(), "memories-cli-")), "m.db");
  const base = ["--db", db, "--namespace", "ns"];
  expect(run("write", ...base, "--key", "k1", "--text", "zebra crossing").exitCode).toBe(0);
  const hits = JSON.parse(run("search", ...base, "--query", "zebra", "--json").stdout.toString());
  expect(hits[0].memory_key).toBe("k1");
  expect(run("get", ...base, "--key", "k1").stdout.toString()).toContain("zebra crossing");
  const plan = path.join(path.dirname(db), "plan.json");
  writeFileSync(
    plan,
    JSON.stringify({
      nodeLabels: { Memory: {} },
      edges: [{ References: {}, memory: "k1", direction: "out" }],
    }),
  );
  const ip = run("integrate-plan", ...base, "--key", "k2", "--plan", plan, "--text", "zebra herd");
  expect(ip.exitCode, ip.stderr.toString()).toBe(0);
  const prov = JSON.parse(run("provenance", "--db", db, "--json").stdout.toString());
  expect(prov).toHaveProperty("rootHex");
});
