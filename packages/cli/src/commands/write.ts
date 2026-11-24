import { boolFlag, type Flags } from "../lib/argv.ts";
import { requireFlag, resolveDb, resolveNamespace } from "../lib/config.ts";
import { out } from "../lib/out.ts";
import { openStore } from "../lib/store.ts";

export async function handleWrite(flags: Flags): Promise<void> {
  const { client, close } = openStore(resolveDb(flags));
  try {
    const namespace = resolveNamespace(flags);
    const key = requireFlag(flags, "key");
    await client.mergeMemory({
      key,
      namespace,
      content: [{ key: "text", text: requireFlag(flags, "text") }],
      labels: [{ kind: "Memory", props: {} }],
      edges: [],
    });
    out(boolFlag(flags, "json"), { namespace, key }, `wrote ${namespace}/${key}`);
  } finally {
    close();
  }
}
