import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dir, "..");
const srcRoot = path.join(packageRoot, "src");

const PACKAGE_SUBPATHS: Record<string, string> = {
  "@khoralabs/memories-node": path.join(srcRoot, "index.ts"),
  "@khoralabs/memories-node/persistence": path.join(
    srcRoot,
    "persistence/core/persistence/index.ts",
  ),
  "@khoralabs/memories-node/client": path.join(srcRoot, "index.ts"),
};

function resolveImport(fromFile: string, spec: string): string | null {
  if (spec.startsWith("@khoralabs/memories-node/")) {
    const mapped = PACKAGE_SUBPATHS[spec];
    if (mapped === undefined) {
      // Other package subpaths: do not traverse for this root-boundary test.
      return null;
    }
    return mapped;
  }
  if (spec === "@khoralabs/memories-node") {
    return PACKAGE_SUBPATHS["@khoralabs/memories-node"] ?? null;
  }
  if (spec.startsWith("@khoralabs/")) return null;
  if (!spec.startsWith(".")) return null;
  const stripped = spec.replace(/\.js$/, "");
  const base = path.resolve(path.dirname(fromFile), stripped);
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
  const fromRe = /(?:^|\n)[ \t]*(?:export|import)(?!\s+type\b)[\s\S]*?\bfrom\s+["']([^"']+)["']/g;
  for (const match of text.matchAll(fromRe)) {
    const spec = match[1];
    if (spec !== undefined) specs.push(spec);
  }
  const sideEffectRe = /(?:^|\n)[ \t]*import\s+["']([^"']+)["']/g;
  for (const match of text.matchAll(sideEffectRe)) {
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

describe("package root opt-in sqlite boundary", () => {
  test("root value graph excludes bun:sqlite and sqlite-vec", () => {
    const entry = path.join(srcRoot, "index.ts");
    const files = reachableFiles(entry);
    const rel = [...files].map((f) => path.relative(packageRoot, f));
    expect(rel.some((f) => f.includes(`${path.sep}persistence${path.sep}sqlite${path.sep}`))).toBe(
      false,
    );

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text.includes("bun:sqlite")).toBe(false);
      expect(text.includes("sqlite-vec")).toBe(false);
    }
  });

  test("./persistence value graph excludes bun:sqlite and sqlite-vec", () => {
    const entry = path.join(srcRoot, "persistence/core/persistence/index.ts");
    const files = reachableFiles(entry);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text.includes("bun:sqlite")).toBe(false);
      expect(text.includes("sqlite-vec")).toBe(false);
    }
  });
});
