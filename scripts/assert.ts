/**
 * Entrypoint isolation assertions.
 * Usage: bun run scripts/assert.ts [name…]   (default: all)
 *   no-bun-sqlite-leak      bun:sqlite stays inside Bun-only entrypoint trees
 *   storage-entry-isolation ./storage/sqlite never pulls sibling backends
 *   react-graph-browser     the react-graph main entry stays browser-safe
 *
 * Run again after `bun run build` to cover emitted dist/ files.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mts|cts)$/;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (SOURCE_EXT.test(name)) out.push(p);
  }
  return out;
}

function rel(file: string): string {
  return relative(ROOT, file).replaceAll("\\", "/");
}

/** Report every pattern hit in `files`, skipping paths that do not exist. */
function scan(files: string[], patterns: RegExp[], first = false): string[] {
  const hits: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const re of patterns) {
      if (!re.test(text)) continue;
      hits.push(`${rel(file)} matches ${re}`);
      if (first) break;
    }
  }
  return hits;
}

type Assertion = {
  name: string;
  run: () => string[];
  hint: string;
};

const ASSERTIONS: Assertion[] = [
  {
    name: "no-bun-sqlite-leak",
    hint:
      "bun:sqlite is allowed only under packages/node/src/persistence/sqlite/ and\n" +
      "packages/service/src/storage/sqlite/. Use @khoralabs/memories-node/sqlite or\n" +
      "./storage/sqlite for Bun SQLite APIs.",
    run: () => {
      const allowed = [
        "packages/node/src/persistence/sqlite/",
        "packages/service/src/storage/sqlite/",
      ];
      const files = [
        "packages/node/src",
        "packages/service/src",
        "packages/agents",
        "packages/react/graph",
      ]
        .flatMap((root) => walk(join(ROOT, root)))
        .filter((file) => !allowed.some((prefix) => rel(file).startsWith(prefix)));
      return scan(files, [/(?:from|require\()\s*["']bun:sqlite["']/], true);
    },
  },
  {
    name: "storage-entry-isolation",
    hint:
      "./storage/sqlite must not statically import libsql/turso backends.\n" +
      "Compose multi-backend via createCompositeBackendFactory at the host.",
    run: () => {
      const files = [
        ...walk(join(ROOT, "packages/service/src/storage/sqlite")).filter(
          (file) => !file.endsWith(".test.ts"),
        ),
        join(ROOT, "packages/service/dist/storage/sqlite/index.js"),
      ];
      return scan(
        files,
        [
          /@khoralabs\/memories-node\/libsql/,
          /@khoralabs\/memories-node\/turso-serverless/,
          /["']\.\.\/libsql(?:\/|["'])/,
          /["']\.\.\/turso-serverless(?:\/|["'])/,
          /from\s+["']@libsql\//,
        ],
        true,
      );
    },
  },
  {
    name: "react-graph-browser",
    hint:
      "Main `@khoralabs/memories-react-graph` must stay browser-safe.\n" +
      "Put createServiceReactMemoriesClient on `@khoralabs/memories-react-graph/service`.",
    run: () =>
      scan(
        [
          join(ROOT, "packages/react/graph/src/index.ts"),
          join(ROOT, "packages/react/graph/src/memories-client-provider.tsx"),
          join(ROOT, "packages/react/graph/src/memories-client.ts"),
          join(ROOT, "packages/react/graph/dist/index.js"),
        ],
        [
          /(?:from|import\()\s*["']@khoralabs\/memories-service(?:\/[^"']*)?["']/,
          /(?:from|import\()\s*["']node:crypto["']/,
          /(?:from|import\()\s*["']node:path["']/,
          /(?:^|\n)\s*export\s*\{[^}]*\bcreateServiceReactMemoriesClient\b/,
        ],
      ),
  },
];

const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !ASSERTIONS.some((a) => a.name === name));
if (unknown.length > 0) {
  console.error(`unknown assertion(s): ${unknown.join(", ")}`);
  console.error(`available: ${ASSERTIONS.map((a) => a.name).join(", ")}`);
  process.exit(1);
}

let failed = false;

for (const assertion of ASSERTIONS) {
  if (requested.length > 0 && !requested.includes(assertion.name)) continue;
  const hits = assertion.run();
  if (hits.length === 0) {
    console.log(`${assertion.name}: ok`);
    continue;
  }
  failed = true;
  console.error(`${assertion.name}: violation(s)`);
  for (const hit of hits) console.error(`  ${hit}`);
  console.error(`\n${assertion.hint}\n`);
}

if (failed) process.exit(1);
