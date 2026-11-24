import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  AGENTS_SKILLS_CANONICAL,
  installMemoriesCliSkill,
  resolveSkillsCatalogRoot,
  type SkillsCliRunner,
} from "./install-agent-skill";

describe("resolveSkillsCatalogRoot", () => {
  test("accepts leaf path …/skills/memories", () => {
    const root = resolveSkillsCatalogRoot("/tmp/assets/skills/memories");
    expect(root).toBe(path.resolve("/tmp/assets"));
  });

  test("rejects lookalike suffix without skills/ parent", () => {
    expect(() => resolveSkillsCatalogRoot("/tmp/custom-skills/memories")).toThrow(
      /skills\/memories/,
    );
  });
});

describe("installMemoriesCliSkill", () => {
  let workspace: string;
  let home: string;
  let cwd: string;
  let skillAssets: string;
  let catalogRoot: string;
  let calls: string[][];

  const mockRunner: SkillsCliRunner = (args, opts) => {
    calls.push([...args]);
    const skillDir = path.join(
      args.includes("--global") ? home : (opts.cwd ?? cwd),
      AGENTS_SKILLS_CANONICAL,
      "memories",
    );
    if (args[0] === "remove") {
      rmSync(skillDir, { recursive: true, force: true });
      return { exitCode: 0, stdout: "removed", stderr: "" };
    }
    if (args[0] === "add") {
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        path.join(skillDir, "SKILL.md"),
        readFileSync(path.join(skillAssets, "SKILL.md")),
      );
      return { exitCode: 0, stdout: "installed", stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: `unknown ${args[0]}` };
  };

  beforeEach(() => {
    calls = [];
    workspace = mkdtempSync(path.join(tmpdir(), "memories-skill-"));
    home = path.join(workspace, "home");
    cwd = path.join(workspace, "project");
    catalogRoot = path.join(workspace, "assets");
    skillAssets = path.join(catalogRoot, "skills", "memories");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(skillAssets, { recursive: true });
    writeFileSync(path.join(skillAssets, "SKILL.md"), "# memories\n");
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  test("installs under cwd/.agents/skills by default via bunx skills", () => {
    const result = installMemoriesCliSkill({
      skillAssetsDir: skillAssets,
      home,
      cwd,
      runSkillsCli: mockRunner,
    });
    expect(result.global).toBe(false);
    expect(result.status).toBe("copied");
    expect(result.skillDir).toBe(path.join(cwd, AGENTS_SKILLS_CANONICAL, "memories"));
    expect(readFileSync(path.join(result.skillDir, "SKILL.md"), "utf8")).toContain("memories");
    expect(calls).toEqual([["add", catalogRoot, "--skill", "memories", "-y"]]);
    expect(result.symlinks).toEqual([]);
  });

  test("global install passes --global", () => {
    const result = installMemoriesCliSkill({
      skillAssetsDir: skillAssets,
      home,
      cwd,
      global: true,
      runSkillsCli: mockRunner,
    });
    expect(result.global).toBe(true);
    expect(result.skillDir).toBe(path.join(home, AGENTS_SKILLS_CANONICAL, "memories"));
    expect(calls[0]).toContain("--global");
  });

  test("skips when skill dir exists unless force", () => {
    installMemoriesCliSkill({
      skillAssetsDir: skillAssets,
      home,
      cwd,
      runSkillsCli: mockRunner,
    });
    writeFileSync(path.join(cwd, AGENTS_SKILLS_CANONICAL, "memories", "SKILL.md"), "# kept\n");
    calls = [];
    const skipped = installMemoriesCliSkill({
      skillAssetsDir: skillAssets,
      home,
      cwd,
      runSkillsCli: mockRunner,
    });
    expect(skipped.status).toBe("skipped_exists");
    expect(calls).toEqual([]);
    expect(readFileSync(path.join(skipped.skillDir, "SKILL.md"), "utf8")).toBe("# kept\n");

    writeFileSync(path.join(skillAssets, "SKILL.md"), "# memories fresh\n");
    const forced = installMemoriesCliSkill({
      skillAssetsDir: skillAssets,
      home,
      cwd,
      force: true,
      runSkillsCli: mockRunner,
    });
    expect(forced.status).toBe("overwritten");
    expect(calls[0]?.[0]).toBe("remove");
    expect(calls[1]?.[0]).toBe("add");
    expect(readFileSync(path.join(forced.skillDir, "SKILL.md"), "utf8")).toContain("fresh");
  });

  test("throws when skill assets missing", () => {
    expect(() =>
      installMemoriesCliSkill({
        skillAssetsDir: path.join(workspace, "missing"),
        cwd,
        runSkillsCli: mockRunner,
      }),
    ).toThrow(/skills\/memories|not found/);
  });
});
