import { boolFlag, type Flags, strFlag } from "../lib/argv.ts";
import { resolveDb } from "../lib/config.ts";
import { out } from "../lib/out.ts";
import { openStore } from "../lib/store.ts";

export async function handleProvenance(flags: Flags): Promise<void> {
  const { client, close } = openStore(resolveDb(flags));
  try {
    const p = client.persistence;
    const rootHex = (await p.getProvenanceHeadRootHex()) ?? null;
    const limit = Number(strFlag(flags, "limit") ?? 20);
    const chain = (await p.listProvenanceChain?.({ limit })) ?? [];
    out(
      boolFlag(flags, "json"),
      { rootHex, chain },
      [`root ${rootHex ?? "(none)"}`, ...chain.map((l) => `${l.rootHex}\t${l.eventType}`)].join(
        "\n",
      ),
    );
  } finally {
    close();
  }
}
