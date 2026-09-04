import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const contractsDir = path.join(import.meta.dir);
const packageRoot = path.resolve(contractsDir, "../../..");
const srcRoot = path.join(packageRoot, "src");

const PACKAGE_SUBPATHS: Record<string, string> = {
  "@khoralabs/memories-service/http/contracts": path.join(srcRoot, "http/contracts/index.ts"),
};

function resolveImport(fromFile: string, spec: string): string | null {
  if (spec === "@khoralabs/memories-service") {
    throw new Error(
      `unapproved package import ${JSON.stringify(spec)} from ${path.relative(packageRoot, fromFile)}`,
    );
  }
  if (spec.startsWith("@khoralabs/memories-service/")) {
    const mapped = PACKAGE_SUBPATHS[spec];
    if (mapped === undefined) {
      throw new Error(
        `unapproved package import ${JSON.stringify(spec)} from ${path.relative(packageRoot, fromFile)}`,
      );
    }
    return mapped;
  }
  if (spec.startsWith("@khoralabs/")) {
    // External workspace packages: do not traverse (type-only memories-node is skipped below).
    return null;
  }
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, path.join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* try next */
    }
  }
  throw new Error(
    `unresolved relative import ${JSON.stringify(spec)} from ${path.relative(packageRoot, fromFile)}`,
  );
}

function collectValueImportSpecs(text: string): string[] {
  const specs: string[] = [];
  const re = /(?:^|\n)[ \t]*(?:export|import)(?!\s+type\b)[\s\S]*?\bfrom\s+["']([^"']+)["']/g;
  for (const match of text.matchAll(re)) {
    const spec = match[1];
    if (spec !== undefined) specs.push(spec);
  }
  return specs;
}

function reachableFiles(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const spec of collectValueImportSpecs(text)) {
      const resolved = resolveImport(file, spec);
      if (resolved !== null && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

describe("http/contracts client/server boundary", () => {
  test("./http/contracts value graph excludes handlers and bun:sqlite", () => {
    const entry = path.join(contractsDir, "index.ts");
    const files = reachableFiles(entry);
    const rel = [...files].map((f) => path.relative(packageRoot, f));
    expect(rel.some((f) => f.includes("handlers"))).toBe(false);
    expect(rel.some((f) => f.includes("storage/sqlite"))).toBe(false);

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text.includes("bun:sqlite")).toBe(false);
      expect(text.includes('from "node:fs')).toBe(false);
      expect(text.includes('from "node:crypto"')).toBe(false);
    }
  });
});
