/**
 * Release pipeline for the publishable packages.
 * Usage:
 *   bun run scripts/release.ts bump <semver>   set version on every publishable package
 *   bun run scripts/release.ts verify          refresh bun.lock, assert packed workspace deps
 *   bun run scripts/release.ts publish [--dry-run]   verify, build, bun publish in order
 *
 * Auth: bun publish uses NPM_CONFIG_TOKEN (falls back to NPM_TOKEN / NODE_AUTH_TOKEN).
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPublishedPackageJson, buildPackage, PUBLISH_ORDER } from "./build";

const ROOT = join(import.meta.dir, "..");

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

/** Read a package.json and fail loudly if it is not the package we expect. */
function readExpected(pkg: { name: string; dir: string }): PackageJson {
  const json = readPackageJson(join(ROOT, pkg.dir));
  if (json.name !== pkg.name) {
    throw new Error(`${pkg.dir}: expected name ${pkg.name}, got ${json.name}`);
  }
  return json;
}

function bump(version: string | undefined): void {
  const semver = version?.replace(/^v/, "");
  if (!semver || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(semver)) {
    console.error("Usage: bun run scripts/release.ts bump <semver>");
    process.exit(1);
  }
  for (const pkg of PUBLISH_ORDER) {
    const path = join(ROOT, pkg.dir, "package.json");
    const json = { ...readExpected(pkg), version: semver };
    writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`${pkg.name} → ${semver}`);
  }
  console.log(`bumped ${PUBLISH_ORDER.length} packages to ${semver}`);
}

/**
 * bun publish rewrites workspace:* from the lockfile, so a stale bun.lock ships
 * wrong dependency ranges. Regenerate it before checking packed output.
 */
function refreshLockfile(): void {
  const lockPath = join(ROOT, "bun.lock");
  if (existsSync(lockPath)) {
    rmSync(lockPath);
    console.log("removed bun.lock");
  }
  const result = Bun.spawnSync(["bun", "install"], {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (result.exitCode !== 0) {
    console.error("bun install failed while refreshing workspace lockfile");
    process.exit(result.exitCode ?? 1);
  }
  console.log("refreshed bun.lock workspace versions");
}

/** Assert `bun pm pack` rewrites workspace:* deps to the live package.json versions. */
function verifyPackedDeps(): void {
  const workspaceVersions = new Map(
    PUBLISH_ORDER.map((pkg) => [pkg.name, readExpected(pkg).version]),
  );
  let failures = 0;

  for (const pkg of PUBLISH_ORDER) {
    const cwd = join(ROOT, pkg.dir);
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
          } else if (range.includes("workspace:")) {
            console.error(`${pkg.name}: packed ${dep} still has workspace protocol (${range})`);
            failures += 1;
          } else if (range !== expected) {
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
}

async function publish(dryRun: boolean): Promise<void> {
  refreshLockfile();
  verifyPackedDeps();

  const token =
    process.env.NPM_CONFIG_TOKEN ?? process.env.NPM_TOKEN ?? process.env.NODE_AUTH_TOKEN;
  if (!token && !dryRun) {
    console.warn(
      "Warning: NPM_CONFIG_TOKEN (or NPM_TOKEN) is not set; bun publish may fail without auth.",
    );
  }

  for (const pkg of PUBLISH_ORDER) {
    const cwd = join(ROOT, pkg.dir);
    console.log(`\n→ preparing ${pkg.name} from ${pkg.dir}`);

    let restore: (() => void) | undefined;
    try {
      if (!pkg.noBuild) {
        console.log("  building…");
        await buildPackage(cwd);
        restore = applyPublishedPackageJson(cwd);
      }

      if (dryRun) {
        console.log("  (dry-run) bun publish --access public");
        continue;
      }

      const result = Bun.spawnSync(["bun", "publish", "--access", "public"], {
        cwd,
        stdio: ["inherit", "inherit", "inherit"],
        env: { ...process.env, ...(token ? { NPM_CONFIG_TOKEN: token } : {}) },
      });
      if (result.exitCode !== 0) {
        console.error(`Failed to publish ${pkg.name}`);
        process.exit(result.exitCode ?? 1);
      }
    } finally {
      restore?.();
    }
  }

  console.log(`\nPublished ${PUBLISH_ORDER.length} package(s)${dryRun ? " (dry-run)" : ""}.`);
}

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "bump":
    bump(rest[0]);
    break;
  case "verify":
    refreshLockfile();
    verifyPackedDeps();
    break;
  case "publish":
    await publish(rest.includes("--dry-run"));
    break;
  default:
    console.error(
      "Usage: bun run scripts/release.ts <bump <semver> | verify | publish [--dry-run]>",
    );
    process.exit(1);
}
