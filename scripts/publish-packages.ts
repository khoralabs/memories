/**
 * Publish packages in dependency order.
 * Usage: bun run scripts/publish-packages.ts [--dry-run] [--primary-only]
 *
 * Auth: bun publish uses NPM_CONFIG_TOKEN (set from NPM_TOKEN if needed).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { PUBLISH_ORDER } from "./publishable-packages";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const primaryOnly = args.has("--primary-only");

const root = join(import.meta.dir, "..");
const list = primaryOnly ? PUBLISH_ORDER.filter((p) => p.kind === "primary") : PUBLISH_ORDER;

const token = process.env.NPM_CONFIG_TOKEN ?? process.env.NPM_TOKEN ?? process.env.NODE_AUTH_TOKEN;

if (!token && !dryRun) {
  console.warn(
    "Warning: NPM_CONFIG_TOKEN (or NPM_TOKEN) is not set; bun publish may fail without auth.",
  );
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
      ...(token ? { NPM_CONFIG_TOKEN: token } : {}),
    },
  });
  if (result.status !== 0) {
    console.error(`Failed to publish ${pkg.name}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nPublished ${list.length} package(s)${dryRun ? " (dry-run)" : ""}.`);
