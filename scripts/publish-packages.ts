/**
 * Publish packages in dependency order.
 * Usage: bun run scripts/publish-packages.ts [--dry-run] [--primary-only]
 *
 * Requires NPM_TOKEN (or npm login). Uses `bun publish`.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { PUBLISH_ORDER } from "./publishable-packages";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const primaryOnly = args.has("--primary-only");

const root = join(import.meta.dir, "..");
const list = primaryOnly ? PUBLISH_ORDER.filter((p) => p.kind === "primary") : PUBLISH_ORDER;

if (!process.env.NPM_TOKEN && !dryRun) {
  console.warn("Warning: NPM_TOKEN is not set; bun publish may fail without npm auth.");
}

for (const pkg of list) {
  const cwd = join(root, pkg.dir);
  console.log(`\n→ publishing ${pkg.name} (${pkg.kind}) from ${pkg.dir}`);
  if (dryRun) {
    console.log("  (dry-run) bun publish --access public");
    continue;
  }
  const result = spawnSync("bun", ["publish", "--access", "public"], {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      // npm / bun honor this for registry auth
      NODE_AUTH_TOKEN: process.env.NODE_AUTH_TOKEN ?? process.env.NPM_TOKEN,
      NPM_TOKEN: process.env.NPM_TOKEN,
    },
  });
  if (result.status !== 0) {
    console.error(`Failed to publish ${pkg.name}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nPublished ${list.length} package(s)${dryRun ? " (dry-run)" : ""}.`);
