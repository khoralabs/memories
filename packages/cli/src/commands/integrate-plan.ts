import { applyIntegratorPlanToMerge } from "@khoralabs/memories-agents/integrator";
import { boolFlag, type Flags, strFlag } from "../lib/argv.ts";
import { requireFlag, resolveDb, resolveNamespace } from "../lib/config.ts";
import { out } from "../lib/out.ts";
import { openStore } from "../lib/store.ts";
import { memorySourceTexts } from "./get.ts";

export async function handleIntegratePlan(flags: Flags): Promise<void> {
  const { client, close } = openStore(resolveDb(flags));
  try {
    const namespace = resolveNamespace(flags);
    const key = requireFlag(flags, "key");
    const plan: unknown = await Bun.file(requireFlag(flags, "plan")).json();
    const content =
      strFlag(flags, "text") ??
      (await memorySourceTexts(client, namespace, key))?.[0]?.text ??
      undefined;
    if (content === undefined) throw new Error("--text is required for a new memory");
    await applyIntegratorPlanToMerge({ client, namespace, key, content, plan });
    out(boolFlag(flags, "json"), { namespace, key }, `integrated ${namespace}/${key}`);
  } finally {
    close();
  }
}
