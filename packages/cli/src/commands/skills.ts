import path from "node:path";
import {
  type AgentSkillInstallResult,
  installMemoriesCliSkill,
} from "../../scripts/install-agent-skill.ts";
import { boolFlag, type Flags } from "../lib/argv.ts";

export const ASSETS_DIR_ENV = "MEMORIES_CLI_ASSETS_DIR";

function skillAssetsDir(env = process.env): string {
  const root = env[ASSETS_DIR_ENV]?.trim() || path.resolve(import.meta.dir, "../../assets");
  return path.join(root, "skills", "memories");
}

export function printSkillInstallResult(r: AgentSkillInstallResult): void {
  if (r.status === "skipped_exists") {
    console.log(`skipped agent skill memories (exists at ${r.skillDir}; use --force to overwrite)`);
    return;
  }
  const verb = r.status === "overwritten" ? "overwrote" : "wrote";
  console.log(`${verb} agent skill memories at ${r.skillDir}${r.global ? " (global)" : ""}`);
}

export async function handleSkillsInstall(flags: Flags): Promise<void> {
  if (!boolFlag(flags, "yes", "y")) {
    throw new Error("Usage: memories skills install -y [-g] [--force] [--json]");
  }
  const global = boolFlag(flags, "global", "g");
  const home = process.env.HOME ?? process.env.USERPROFILE;
  const result = installMemoriesCliSkill({
    skillAssetsDir: skillAssetsDir(),
    home,
    cwd: process.cwd(),
    global,
    force: boolFlag(flags, "force", "f"),
  });
  if (boolFlag(flags, "json")) console.log(JSON.stringify(result, null, 2));
  else printSkillInstallResult(result);
}
