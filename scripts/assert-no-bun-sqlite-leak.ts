/**
 * Fails if `bun:sqlite` appears outside Bun-only entrypoint trees.
 * Run: bun run scripts/assert-no-bun-sqlite-leak.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** Paths (relative to repo root) where bun:sqlite is allowed. */
const ALLOWED_PREFIXES = [
  "packages/node/src/persistence/sqlite/",
  "packages/service/src/storage/sqlite/",
];

/** Roots to scan for leaks. */
const SCAN_ROOTS = [
  "packages/node/src",
  "packages/service/src",
  "packages/agents",
  "packages/react/graph",
];

const LEAK_RE = /(?:from|require\()\s*["']bun:sqlite["']/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mts|cts)$/.test(name)) out.push(p);
  }
  return out;
}

function isAllowed(rel: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

const leaks: string[] = [];

for (const root of SCAN_ROOTS) {
  const abs = join(ROOT, root);
  try {
    statSync(abs);
  } catch {
    continue;
  }
  for (const file of walk(abs)) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (isAllowed(rel)) continue;
    const text = readFileSync(file, "utf8");
    if (LEAK_RE.test(text)) {
      leaks.push(rel);
    }
  }
}

if (leaks.length > 0) {
  console.error("bun:sqlite leak(s) outside Bun-only entrypoints:");
  for (const f of leaks) console.error(`  ${f}`);
  console.error(
    "\nAllowed only under:\n" +
      ALLOWED_PREFIXES.map((p) => `  ${p}`).join("\n") +
      "\nUse @khoralabs/memories-node/sqlite or ./storage/sqlite for Bun SQLite APIs.",
  );
  process.exit(1);
}

console.log("assert-no-bun-sqlite-leak: ok");
