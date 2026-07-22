/**
 * Publish packages in dependency order.
 * Usage: bun run scripts/publish-packages.ts [--dry-run]
 *
 * Builds JS + .d.ts first, then rewrites package.json exports to dist/ for the publish.
 * Auth: bun publish uses NPM_CONFIG_TOKEN (set from NPM_TOKEN if needed).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { applyPublishedPackageJson, buildPackage } from "./build-package";
import { PUBLISH_ORDER } from "./publishable-packages";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

const root = join(import.meta.dir, "..");

const token = process.env.NPM_CONFIG_TOKEN ?? process.env.NPM_TOKEN ?? process.env.NODE_AUTH_TOKEN;

if (!token && !dryRun) {
  console.warn(
    "Warning: NPM_CONFIG_TOKEN (or NPM_TOKEN) is not set; bun publish may fail without auth.",
  );
}

const skipBuild = new Set(["@khoralabs/memories-spec"]);

for (const pkg of PUBLISH_ORDER) {
  const cwd = join(root, pkg.dir);
  console.log(`\n→ preparing ${pkg.name} from ${pkg.dir}`);

  let restore: (() => void) | undefined;
  try {
    if (!skipBuild.has(pkg.name)) {
      console.log("  building…");
      await buildPackage(cwd);
      restore = applyPublishedPackageJson(cwd);
    }

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
  } finally {
    restore?.();
  }
}

console.log(`\nPublished ${PUBLISH_ORDER.length} package(s)${dryRun ? " (dry-run)" : ""}.`);
