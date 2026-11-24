import { boolFlag, type Flags } from "../lib/argv.ts";
import { requireFlag, resolveDb, resolveNamespace } from "../lib/config.ts";
import { out } from "../lib/out.ts";
import { openStore } from "../lib/store.ts";

type Store = ReturnType<typeof openStore>["client"];

/** Source-map texts for a memory, newest first; `undefined` when the memory is unknown. */
export async function memorySourceTexts(client: Store, namespace: string, key: string) {
  const p = client.persistence;
  const id = await p.findMemoryIdByKey(namespace, key);
  if (id === undefined) return undefined;
  const inventory = await p.listSourceMapInventoryForMemory(id, 50);
  return Promise.all(
    inventory.map(async ({ sourceKey, sourceMapId }) => ({
      sourceKey,
      sourceMapId,
      text: await p.getSourceMapText(sourceMapId),
    })),
  );
}

export async function handleGet(flags: Flags): Promise<void> {
  const { client, close } = openStore(resolveDb(flags));
  try {
    const namespace = resolveNamespace(flags);
    const key = requireFlag(flags, "key");
    const sources = await memorySourceTexts(client, namespace, key);
    if (sources === undefined) throw new Error(`memory not found: ${namespace}/${key}`);
    out(
      boolFlag(flags, "json"),
      { namespace, key, sources },
      sources.map((s) => s.text ?? "").join("\n\n"),
    );
  } finally {
    close();
  }
}
