import type { Flags } from "../lib/argv.ts";
import { handleGet } from "./get.ts";
import { handleHelp } from "./help.ts";
import { handleIntegratePlan } from "./integrate-plan.ts";
import { handleNamespaces } from "./namespaces.ts";
import { handleProvenance } from "./provenance.ts";
import { handleSearch } from "./search.ts";
import { handleSkillsInstall } from "./skills.ts";
import { handleWrite } from "./write.ts";

const COMMANDS: Record<string, (flags: Flags) => Promise<void> | void> = {
  help: handleHelp,
  search: handleSearch,
  get: handleGet,
  namespaces: handleNamespaces,
  provenance: handleProvenance,
  write: handleWrite,
  "integrate-plan": handleIntegratePlan,
  "skills install": handleSkillsInstall,
};

export async function dispatch(positional: string[], flags: Flags): Promise<void> {
  const name = positional.slice(0, positional[0] === "skills" ? 2 : 1).join(" ");
  const handler = COMMANDS[name];
  if (handler === undefined)
    throw new Error(`Unknown command: ${positional.join(" ") || "(none)"}`);
  await handler(flags);
}
