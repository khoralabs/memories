/**
 * Fails if the browser UI entry statically imports memories-service (or Node builtins
 * only needed by the service client). Run after build:
 *   bun run scripts/assert-react-graph-browser-entry.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SRC_INDEX = join(ROOT, "packages/react/graph/src/index.ts");
const DIST_INDEX = join(ROOT, "packages/react/graph/dist/index.js");
const SRC_PROVIDER = join(ROOT, "packages/react/graph/src/memories-client-provider.tsx");
const SRC_CLIENT = join(ROOT, "packages/react/graph/src/memories-client.ts");

/** Runtime import / require patterns only (JSDoc mentions are allowed). */
const FORBIDDEN = [
  /(?:from|import\()\s*["']@khoralabs\/memories-service(?:\/[^"']*)?["']/,
  /(?:from|import\()\s*["']node:crypto["']/,
  /(?:from|import\()\s*["']node:path["']/,
  /(?:^|\n)\s*export\s*\{[^}]*\bcreateServiceReactMemoriesClient\b/,
];

const hits: string[] = [];

for (const file of [SRC_INDEX, SRC_PROVIDER, SRC_CLIENT, DIST_INDEX]) {
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  const rel = file.replace(`${ROOT}/`, "");
  for (const re of FORBIDDEN) {
    if (re.test(text)) {
      hits.push(`${rel} matches ${re}`);
    }
  }
}

if (hits.length > 0) {
  console.error("react-graph browser entry isolation violation(s):");
  for (const h of hits) console.error(`  ${h}`);
  console.error(
    "\nMain `@khoralabs/memories-react-graph` must stay browser-safe.\n" +
      "Put createServiceReactMemoriesClient on `@khoralabs/memories-react-graph/service`.",
  );
  process.exit(1);
}

console.log("assert-react-graph-browser-entry: ok");
