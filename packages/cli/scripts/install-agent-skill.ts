#!/usr/bin/env bun
/**
 * Install the bundled memories skill via `bunx skills` (vercel-labs/skills).
 *
 * Expects a catalog-shaped tree: `<skillsSourceDir>/skills/memories/SKILL.md`.
 * For the CLI package that is `packages/cli/assets` (or `$MEMORIES_CLI_ASSETS_DIR`).
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

export const AGENTS_SKILLS_CANONICAL = path.join(".agents", "skills");
export const MEMORIES_CLI_SKILL_NAME = "memories";

export type AgentSkillInstallStatus = "copied" | "skipped_exists" | "overwritten";

export type AgentSkillInstallResult = {
  skillDir: string;
  status: AgentSkillInstallStatus;
  /** Always empty; retained for JSON compatibility with prior installer. */
  copied: string[];
  global: boolean;
  /** Always empty; `bunx skills` owns multi-agent placement. */
  symlinks: { path: string; status: string }[];
};

export type SkillsCliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type SkillsCliRunner = (
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv },
) => SkillsCliResult;

/** Default runner: `bunx skills …`. */
export function defaultSkillsCliRunner(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): SkillsCliResult {
  try {
    const result = Bun.spawnSync(["bunx", "skills", ...args], {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: "", stderr: `failed to spawn bunx skills: ${message}` };
  }
}

export type InstallMemoriesCliSkillOptions = {
  /**
   * Absolute path to the skill leaf (`…/skills/memories`), or to the catalog root
   * that contains `skills/memories`. Prefer the leaf path from resolveSkillAssetsDir.
   */
  skillAssetsDir: string;
  home?: string;
  cwd?: string;
  global?: boolean;
  force?: boolean;
  /** Injectable for tests. */
  runSkillsCli?: SkillsCliRunner;
};

/** Resolve catalog root that contains `skills/memories` from a leaf or root path. */
export function resolveSkillsCatalogRoot(skillAssetsDir: string): string {
  const normalized = path.resolve(skillAssetsDir);
  if (
    path.basename(normalized) === MEMORIES_CLI_SKILL_NAME &&
    path.basename(path.dirname(normalized)) === "skills"
  ) {
    return path.dirname(path.dirname(normalized));
  }
  const nested = path.join(normalized, "skills", MEMORIES_CLI_SKILL_NAME);
  if (existsSync(path.join(nested, "SKILL.md"))) {
    return normalized;
  }
  throw new Error(
    `skill assets must live at <catalog>/skills/${MEMORIES_CLI_SKILL_NAME} (got ${skillAssetsDir})`,
  );
}

function skillLeafDir(catalogRoot: string): string {
  return path.join(catalogRoot, "skills", MEMORIES_CLI_SKILL_NAME);
}

/**
 * Install the bundled memories skill tree via `bunx skills add`.
 * Default target is `<cwd>/.agents/skills/memories`. With `global: true`, uses `~/.agents/skills`.
 */
export function installMemoriesCliSkill(
  opts: InstallMemoriesCliSkillOptions,
): AgentSkillInstallResult {
  const catalogRoot = resolveSkillsCatalogRoot(opts.skillAssetsDir);
  const leaf = skillLeafDir(catalogRoot);
  if (!existsSync(path.join(leaf, "SKILL.md"))) {
    throw new Error(`agent skill assets not found at ${leaf}`);
  }

  const isGlobal = opts.global === true;
  const home = opts.home?.trim() ?? "";
  if (isGlobal && home.length === 0) {
    throw new Error("HOME / USERPROFILE not set; cannot install global skills");
  }
  const rootBase = isGlobal ? home : (opts.cwd ?? process.cwd());
  const skillDir = path.join(rootBase, AGENTS_SKILLS_CANONICAL, MEMORIES_CLI_SKILL_NAME);
  const force = opts.force === true;
  const run = opts.runSkillsCli ?? defaultSkillsCliRunner;

  if (existsSync(skillDir) && !force) {
    return {
      skillDir,
      status: "skipped_exists",
      copied: [],
      global: isGlobal,
      symlinks: [],
    };
  }

  const status: AgentSkillInstallStatus = existsSync(skillDir) ? "overwritten" : "copied";
  const scopeFlags = isGlobal ? (["--global"] as const) : ([] as const);
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (isGlobal) {
    env.HOME = home;
    env.USERPROFILE = home;
  }

  if (force && existsSync(skillDir)) {
    const remove = run(["remove", MEMORIES_CLI_SKILL_NAME, "-y", ...scopeFlags], {
      cwd: opts.cwd ?? process.cwd(),
      env,
    });
    if (remove.exitCode !== 0) {
      console.warn(
        `skills remove exited ${remove.exitCode}: ${remove.stderr.trim() || remove.stdout.trim()}`,
      );
      rmSync(skillDir, { recursive: true, force: true });
    }
  }

  const add = run(["add", catalogRoot, "--skill", MEMORIES_CLI_SKILL_NAME, "-y", ...scopeFlags], {
    cwd: opts.cwd ?? process.cwd(),
    env,
  });
  if (add.exitCode !== 0) {
    throw new Error(
      `bunx skills add failed (${add.exitCode}): ${add.stderr.trim() || add.stdout.trim()}`,
    );
  }
  if (!existsSync(path.join(skillDir, "SKILL.md"))) {
    throw new Error(
      `bunx skills add reported success but ${skillDir}/SKILL.md is missing:\n${add.stdout}\n${add.stderr}`,
    );
  }

  return { skillDir, status, copied: [], global: isGlobal, symlinks: [] };
}
