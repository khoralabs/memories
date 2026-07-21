/**
 * Set version on all publishable package.json files.
 * Usage: bun run scripts/bump-versions.ts 0.2.0
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isSemver, PUBLISH_ORDER } from "./publishable-packages";

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !isSemver(version)) {
  console.error("Usage: bun run scripts/bump-versions.ts <semver>");
  process.exit(1);
}

const root = join(import.meta.dir, "..");

for (const pkg of PUBLISH_ORDER) {
  const path = join(root, pkg.dir, "package.json");
  const json = JSON.parse(readFileSync(path, "utf8")) as {
    name: string;
    version: string;
  };
  if (json.name !== pkg.name) {
    throw new Error(`${path}: expected name ${pkg.name}, got ${json.name}`);
  }
  json.version = version;
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`${pkg.name} → ${version}`);
}

console.log(`bumped ${PUBLISH_ORDER.length} packages to ${version}`);
