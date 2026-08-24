import type { MemoriesBackendCapabilities } from "@khoralabs/memories-node";
import type { TipAtRootWire, TipGraphSnapshotWire } from "../client/wire";
import type { getHandle } from "./persistence-handlers";

function tipReplayEnabled(caps: MemoriesBackendCapabilities | undefined): boolean {
  return caps?.tipReplayAtRootHex === true;
}

export async function buildAtTipWire(
  handle: Awaited<ReturnType<typeof getHandle>>["handle"],
  rootHex: string | undefined,
  namespace: string,
  key: string,
  includeVectors: boolean,
): Promise<TipAtRootWire> {
  const caps = handle.persistence.capabilities as MemoriesBackendCapabilities | undefined;
  const replay = tipReplayEnabled(caps);
  if (rootHex === undefined) {
    return { content: null, graph: null, vectors: null };
  }
  const persistence = handle.persistence as {
    getMemoryContentAtRootHex?: (
      rootHex: string,
      namespace: string,
      memoryKey: string,
    ) => Array<{ sourceKey: string; text: string }>;
    getMemoryContentAtRootHexAsync?: (
      rootHex: string,
      namespace: string,
      memoryKey: string,
    ) => Promise<Array<{ sourceKey: string; text: string }>>;
  };
  let arms: Array<{ sourceKey: string; text: string }> = [];
  if (typeof persistence.getMemoryContentAtRootHexAsync === "function") {
    arms = await persistence.getMemoryContentAtRootHexAsync(rootHex, namespace, key);
  } else if (typeof persistence.getMemoryContentAtRootHex === "function") {
    arms = await Promise.resolve(persistence.getMemoryContentAtRootHex(rootHex, namespace, key));
  }
  const content = { rootHex, content: arms };
  let graph: TipAtRootWire["graph"] = null;
  let vectors: TipAtRootWire["vectors"] = null;
  if (replay && handle.persistence.getMemoryGraphAtRootHexAsync !== undefined) {
    const snapshot = await handle.persistence.getMemoryGraphAtRootHexAsync(rootHex, namespace, key);
    graph = { rootHex, graph: snapshot as TipGraphSnapshotWire | null };
  }
  if (includeVectors && replay && handle.persistence.getMemoryVectorAtRootHexAsync !== undefined) {
    const vectorArms = await handle.persistence.getMemoryVectorAtRootHexAsync(
      rootHex,
      namespace,
      key,
    );
    vectors = {
      rootHex,
      vectors: vectorArms.map((arm) => ({
        sourceKey: arm.sourceKey,
        dimensions: arm.vector.length,
      })),
    };
  }
  return { content, graph, vectors };
}
