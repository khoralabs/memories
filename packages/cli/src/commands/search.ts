import { runStandardHybridMemorySearch } from "@khoralabs/memories-node/helpers/agent";
import { boolFlag, type Flags, strFlag } from "../lib/argv.ts";
import { requireFlag, resolveDb, resolveNamespace } from "../lib/config.ts";
import { out } from "../lib/out.ts";
import { openStore } from "../lib/store.ts";

export async function handleSearch(flags: Flags): Promise<void> {
  const { client, close } = openStore(resolveDb(flags));
  try {
    const topK = strFlag(flags, "top-k");
    const hits = await runStandardHybridMemorySearch(client, {
      namespace: resolveNamespace(flags),
      query: requireFlag(flags, "query"),
      ...(topK !== undefined ? { topK: Number(topK) } : {}),
    });
    out(
      boolFlag(flags, "json"),
      hits,
      hits.map((h) => `${h.score.toFixed(3)}\t${h.namespace}\t${h.memory_key}`).join("\n"),
    );
  } finally {
    close();
  }
}
