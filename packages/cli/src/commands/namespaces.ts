import { boolFlag, type Flags } from "../lib/argv.ts";
import { resolveDb } from "../lib/config.ts";
import { out } from "../lib/out.ts";
import { openStore } from "../lib/store.ts";

export async function handleNamespaces(flags: Flags): Promise<void> {
  const { client, close } = openStore(resolveDb(flags));
  try {
    const rows = await client.persistence.listNamespacesWithMetadata();
    out(
      boolFlag(flags, "json"),
      rows,
      rows.map((r) => `${r.namespace}${r.description ? `\t${r.description}` : ""}`).join("\n"),
    );
  } finally {
    close();
  }
}
