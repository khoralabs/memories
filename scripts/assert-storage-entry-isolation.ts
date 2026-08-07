/**
 * Fails if `./storage/sqlite` (or its sources) statically import sibling backends.
 * Keeps bun --compile hosts from pulling `@libsql/*` natives via the sqlite entry.
 * Run: bun run scripts/assert-storage-entry-isolation.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SQLITE_SRC = join(ROOT, "packages/service/src/storage/sqlite");
const SQLITE_DIST = join(ROOT, "packages/service/dist/storage/sqlite/index.js");

const FORBIDDEN = [
  /@khoralabs\/memories-node\/libsql/,
  /@khoralabs\/memories-node\/turso-serverless/,
  /["']\.\.\/libsql(?:\/|["'])/,
  /["']\.\.\/turso-serverless(?:\/|["'])/,
  /from\s+["']@libsql\//,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(name) && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const hits: string[] = [];

for (const file of walk(SQLITE_SRC)) {
  const text = readFileSync(file, "utf8");
  for (const re of FORBIDDEN) {
    if (re.test(text)) {
      hits.push(`${relative(ROOT, file).replaceAll("\\", "/")} matches ${re}`);
      break;
    }
  }
}

if (existsSync(SQLITE_DIST)) {
  const text = readFileSync(SQLITE_DIST, "utf8");
  for (const re of FORBIDDEN) {
    if (re.test(text)) {
      hits.push(`packages/service/dist/storage/sqlite/index.js matches ${re}`);
      break;
    }
  }
}

if (hits.length > 0) {
  console.error("storage/sqlite entry isolation violation(s):");
  for (const h of hits) console.error(`  ${h}`);
  console.error(
    "\n./storage/sqlite must not statically import libsql/turso backends.\n" +
      "Compose multi-backend via createCompositeBackendFactory at the host.",
  );
  process.exit(1);
}

console.log("assert-storage-entry-isolation: ok");
