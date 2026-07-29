/**
 * Regenerate bun.lock so cached workspace package versions match package.json.
 * Required after release:bump — bun publish rewrites workspace:* from the lockfile.
 *
 * Usage: bun run scripts/refresh-workspace-lockfile.ts
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const lockPath = join(root, "bun.lock");

if (existsSync(lockPath)) {
  rmSync(lockPath);
  console.log("removed bun.lock");
}

const result = Bun.spawnSync(["bun", "install"], {
  cwd: root,
  stdio: ["inherit", "inherit", "inherit"],
});

if (result.exitCode !== 0) {
  console.error("bun install failed while refreshing workspace lockfile");
  process.exit(result.exitCode ?? 1);
}

console.log("refreshed bun.lock workspace versions");
