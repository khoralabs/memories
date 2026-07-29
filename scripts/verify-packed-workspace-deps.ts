/**
 * Assert bun pm pack rewrites workspace:* deps to the live package.json versions.
 * Catches stale bun.lock metadata before publish.
 *
 * Usage: bun run scripts/verify-packed-workspace-deps.ts
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PUBLISH_ORDER } from "./publishable-packages";

const root = join(import.meta.dir, "..");

type PackageJson = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const DEP_SECTIONS = ["dependencies", "optionalDependencies", "peerDependencies"] as const;

function readPackageJson(dir: string): PackageJson {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PackageJson;
}

const workspaceVersions = new Map<string, string>();
for (const pkg of PUBLISH_ORDER) {
  const json = readPackageJson(join(root, pkg.dir));
  if (json.name !== pkg.name) {
    throw new Error(`${pkg.dir}: expected name ${pkg.name}, got ${json.name}`);
  }
  workspaceVersions.set(json.name, json.version);
}

let failures = 0;

for (const pkg of PUBLISH_ORDER) {
  const cwd = join(root, pkg.dir);
  const live = readPackageJson(cwd);
  const dest = mkdtempSync(join(tmpdir(), "memories-pack-"));

  try {
    const pack = Bun.spawnSync(["bun", "pm", "pack", "--destination", dest, "--quiet"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (pack.exitCode !== 0) {
      console.error(`pack failed for ${pkg.name}:\n${pack.stderr.toString()}`);
      failures += 1;
      continue;
    }

    const tarball = readdirSync(dest).find((name) => name.endsWith(".tgz"));
    if (!tarball) {
      console.error(`no tarball found for ${pkg.name} in ${dest}`);
      failures += 1;
      continue;
    }

    const untar = Bun.spawnSync(["tar", "-xzf", join(dest, tarball), "-C", dest], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (untar.exitCode !== 0) {
      console.error(`untar failed for ${pkg.name}:\n${untar.stderr.toString()}`);
      failures += 1;
      continue;
    }

    const packed = readPackageJson(join(dest, "package"));
    for (const key of DEP_SECTIONS) {
      const liveSection = live[key];
      const packedSection = packed[key];
      if (!liveSection || !packedSection) continue;
      for (const [dep, liveRange] of Object.entries(liveSection)) {
        if (!liveRange.includes("workspace:")) continue;
        const expected = workspaceVersions.get(dep);
        if (expected === undefined) continue;
        const range = packedSection[dep];
        if (range === undefined) {
          console.error(`${pkg.name}: packed ${key} missing ${dep}`);
          failures += 1;
          continue;
        }
        if (range.includes("workspace:")) {
          console.error(`${pkg.name}: packed ${dep} still has workspace protocol (${range})`);
          failures += 1;
          continue;
        }
        if (range !== expected) {
          console.error(
            `${pkg.name}: packed ${dep} is "${range}", expected "${expected}" (stale bun.lock?)`,
          );
          failures += 1;
        } else {
          console.log(`ok ${pkg.name} → ${dep}@${range}`);
        }
      }
    }
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
}

if (failures > 0) {
  console.error(`\n${failures} packed workspace dependency mismatch(es)`);
  process.exit(1);
}

console.log("packed workspace dependencies match local package.json versions");
