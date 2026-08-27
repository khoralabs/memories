import { describe, expect, test } from "bun:test";
import {
  deleteMemoryAsync,
  mergeMemoryAsync,
  searchAsync,
  suppressMemoryAsync,
  unsuppressMemoryAsync,
} from "../../../core/index";
import { ids, namespacePath } from "../../../persistence/core";
import type {
  MemoriesPersistenceAsync,
  MemoryOpContext,
} from "../../../persistence/core/persistence";
import { resolveMemoriesBackendCapabilities } from "../../../persistence/core/persistence";
import {
  computeSourceMapContentHash,
  nextProvenanceRoot,
} from "../../../persistence/core/provenance";

export type MemoriesPersistenceContractFactory = () =>
  | MemoriesPersistenceAsync
  | Promise<MemoriesPersistenceAsync>;

/** Unique path segment so remote shared DBs (Turso) do not collide across runs. */
function uniqueNs(prefix: string): string {
  return `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const makeVec = (fill: number): number[] => Array.from(new Float32Array(512).fill(fill));

export function runMemoriesPersistenceContractTests(
  name: string,
  create: MemoriesPersistenceContractFactory,
): void {
  describe(`${name} persistence contract`, () => {
    test("mergeMemoryAsync + lexical search returns the memory", async () => {
      const persistence = await create();
      const caps = resolveMemoriesBackendCapabilities(persistence);
      if (!caps.lexicalSearch) return;

      const namespace = uniqueNs("contract/lexical");
      const key = "doc-a";
      const token = `lex_token_${Math.random().toString(36).slice(2, 10)}`;

      await mergeMemoryAsync(
        { persistence },
        {
          namespace,
          key,
          content: [{ key: "body", text: `hello ${token} world` }],
          labels: [],
          edges: [],
        },
      );

      expect(await persistence.findMemoryIdByKey(namespace, key)).toBeDefined();

      const { hits } = await searchAsync(
        { persistence },
        {
          namespace,
          content: { text: token },
          options: { topK: 5 },
        },
      );
      expect(hits.some((h) => h.memory.key === key)).toBe(true);
    });

    test("pathSubtree lexical search finds memories under a prefix namespace", async () => {
      const persistence = await create();
      const caps = resolveMemoriesBackendCapabilities(persistence);
      if (!caps.lexicalSearch) return;

      const root = uniqueNs("contract/lex-subtree");
      const leafNs = namespacePath(`${root}/team/ns`);
      const token = `subtree_${Math.random().toString(36).slice(2, 10)}`;
      await mergeMemoryAsync(
        { persistence },
        {
          key: "leaf",
          namespace: leafNs,
          content: [{ key: "x", text: `doc ${token}` }],
          labels: [],
          edges: [],
        },
      );

      const { hits } = await searchAsync(
        { persistence },
        {
          namespace: namespacePath(`${root}/team`),
          content: { text: token },
          options: { topK: 10 },
        },
      );
      expect(hits.some((h) => h.memory.key === "leaf")).toBe(true);
    });

    test("listMemoryNamespaces returns namespaces that have memories", async () => {
      const persistence = await create();
      const namespace = uniqueNs("contract/namespaces");
      await mergeMemoryAsync(
        { persistence },
        {
          key: "a",
          namespace,
          content: [{ key: "b", text: "a" }],
          labels: [],
          edges: [],
        },
      );
      const namespaces = await persistence.listMemoryNamespaces();
      expect(namespaces).toContain(namespace);
    });

    describe("scopes", () => {
      test("scopeDag finds memories attached under descendant scopes", async () => {
        const persistence = await create();
        const caps = resolveMemoriesBackendCapabilities(persistence);
        if (!caps.lexicalSearch) return;

        const rootScope = namespacePath(uniqueNs("contract/scopes/root"));
        const childScope = namespacePath(`${rootScope}/child`);
        const op = { now: Date.now() };
        await persistence.withTransaction(async () => {
          await persistence.linkScopes(op, {
            parentScopeId: rootScope,
            childScopeId: childScope,
          });
        });

        const memNs = namespacePath(uniqueNs("contract/scopes/mem"));
        const token = `scopedag_${Math.random().toString(36).slice(2, 10)}`;
        await mergeMemoryAsync(
          { persistence },
          {
            key: "invoice",
            namespace: memNs,
            content: [{ key: "body", text: token }],
            labels: [],
            edges: [],
            attachScopes: [childScope],
          },
        );

        const { hits } = await searchAsync(
          { persistence },
          {
            namespace: rootScope,
            content: { text: token },
            options: { topK: 5 },
            searchScopeMode: "scopeDag",
          },
        );
        expect(hits.some((h) => h.memory.key === "invoice")).toBe(true);
      });

      test("exactScope matches only listed scopes (no DAG descent)", async () => {
        const persistence = await create();
        const caps = resolveMemoriesBackendCapabilities(persistence);
        if (!caps.lexicalSearch) return;

        const rootScope = namespacePath(uniqueNs("contract/exact/root"));
        const childScope = namespacePath(`${rootScope}/ledger`);
        const op = { now: Date.now() };
        await persistence.withTransaction(async () => {
          await persistence.linkScopes(op, {
            parentScopeId: rootScope,
            childScopeId: childScope,
          });
        });

        const token = `exactscope_${Math.random().toString(36).slice(2, 10)}`;
        await mergeMemoryAsync(
          { persistence },
          {
            key: "entry",
            namespace: namespacePath(uniqueNs("contract/exact/mem")),
            content: [{ key: "body", text: token }],
            labels: [],
            edges: [],
            attachScopes: [childScope],
          },
        );

        const { hits: dagHits } = await searchAsync(
          { persistence },
          {
            namespace: rootScope,
            content: { text: token },
            options: { topK: 5 },
            searchScopeMode: "scopeDag",
          },
        );
        expect(dagHits.some((h) => h.memory.key === "entry")).toBe(true);

        const { hits: exactParent } = await searchAsync(
          { persistence },
          {
            namespace: rootScope,
            content: { text: token },
            options: { topK: 5 },
            searchScopeMode: "exactScope",
          },
        );
        expect(exactParent.some((h) => h.memory.key === "entry")).toBe(false);

        const { hits: exactChild } = await searchAsync(
          { persistence },
          {
            namespace: childScope,
            content: { text: token },
            options: { topK: 5 },
            searchScopeMode: "exactScope",
          },
        );
        expect(exactChild.some((h) => h.memory.key === "entry")).toBe(true);
      });
    });

    describe("provenance", () => {
      test("merge advances provenance head from prior parent", async () => {
        const persistence = await create();
        const namespace = uniqueNs("contract/prov");
        const key = "mem";
        const memoryId = ids.memory(namespace, key);
        const parent = await persistence.getProvenanceHeadRootHex();

        await mergeMemoryAsync(
          { persistence },
          {
            key,
            namespace,
            content: [{ key: "alpha", text: "hello" }],
            labels: [],
            edges: [],
          },
        );

        const head = await persistence.getProvenanceHeadRootHex();
        const event = {
          v: 1 as const,
          kind: "MERGE_MEMORY" as const,
          namespace,
          memory_key: key,
          memory_id: memoryId,
          source_keys: ["alpha"],
          content_hashes: {
            alpha: computeSourceMapContentHash({ text: "hello" }),
          },
        };
        expect(head).toBe(nextProvenanceRoot(parent, event).root_hex);
      });

      test("delete advances chain; duplicate delete does not change head", async () => {
        const persistence = await create();
        const namespace = uniqueNs("contract/prov-del");
        const key = "x";

        await mergeMemoryAsync(
          { persistence },
          {
            key,
            namespace,
            content: [{ key: "s", text: "a" }],
            labels: [],
            edges: [],
          },
        );
        const afterMerge = await persistence.getProvenanceHeadRootHex();
        expect(afterMerge).toBeDefined();

        await deleteMemoryAsync({ persistence }, { namespace, key });
        const deleteEvent = {
          v: 1 as const,
          kind: "DELETE_MEMORY" as const,
          namespace,
          memory_key: key,
          memory_id: ids.memory(namespace, key),
        };
        const afterDelete = await persistence.getProvenanceHeadRootHex();
        expect(afterDelete).toBe(nextProvenanceRoot(afterMerge, deleteEvent).root_hex);

        await deleteMemoryAsync({ persistence }, { namespace, key });
        expect(await persistence.getProvenanceHeadRootHex()).toBe(afterDelete);
      });

      test("suppress advances chain; duplicate suppress does not; unsuppress restores search", async () => {
        const persistence = await create();
        const caps = resolveMemoriesBackendCapabilities(persistence);
        if (!caps.lexicalSearch) return;

        const namespace = uniqueNs("contract/prov-suppress");
        const key = "hidden";
        const token = `sup_token_${Math.random().toString(36).slice(2, 10)}`;

        await mergeMemoryAsync(
          { persistence },
          {
            key,
            namespace,
            content: [{ key: "s", text: `findme ${token}` }],
            labels: [],
            edges: [],
          },
        );
        const afterMerge = await persistence.getProvenanceHeadRootHex();
        expect(afterMerge).toBeDefined();

        const beforeHits = await searchAsync(
          { persistence },
          { namespace, content: { text: token }, options: { topK: 10 } },
        );
        expect(beforeHits.hits.some((h) => h.memory.key === key)).toBe(true);

        await suppressMemoryAsync({ persistence }, { namespace, key });
        const suppressEvent = {
          v: 1 as const,
          kind: "SUPPRESS_MEMORY" as const,
          namespace,
          memory_key: key,
          memory_id: ids.memory(namespace, key),
        };
        const afterSuppress = await persistence.getProvenanceHeadRootHex();
        expect(afterSuppress).toBe(nextProvenanceRoot(afterMerge, suppressEvent).root_hex);
        expect(await persistence.isMemorySuppressed(ids.memory(namespace, key))).toBe(true);
        expect(await persistence.findMemoryIdByKey(namespace, key)).toBeDefined();

        const suppressedHits = await searchAsync(
          { persistence },
          { namespace, content: { text: token }, options: { topK: 10 } },
        );
        expect(suppressedHits.hits.some((h) => h.memory.key === key)).toBe(false);

        await suppressMemoryAsync({ persistence }, { namespace, key });
        expect(await persistence.getProvenanceHeadRootHex()).toBe(afterSuppress);

        await unsuppressMemoryAsync({ persistence }, { namespace, key });
        const unsuppressEvent = {
          v: 1 as const,
          kind: "UNSUPPRESS_MEMORY" as const,
          namespace,
          memory_key: key,
          memory_id: ids.memory(namespace, key),
        };
        const afterUnsuppress = await persistence.getProvenanceHeadRootHex();
        expect(afterUnsuppress).toBe(nextProvenanceRoot(afterSuppress, unsuppressEvent).root_hex);
        expect(await persistence.isMemorySuppressed(ids.memory(namespace, key))).toBe(false);

        const restoredHits = await searchAsync(
          { persistence },
          { namespace, content: { text: token }, options: { topK: 10 } },
        );
        expect(restoredHits.hits.some((h) => h.memory.key === key)).toBe(true);
      });

      test("getProvenanceTimestampMsForRootHex returns a timestamp for the head", async () => {
        const persistence = await create();
        if (persistence.getProvenanceTimestampMsForRootHex === undefined) return;

        const namespace = uniqueNs("contract/prov-ts");
        await mergeMemoryAsync(
          { persistence },
          {
            key: "y",
            namespace,
            content: [{ key: "s", text: "z" }],
            labels: [],
            edges: [],
          },
        );
        const head = await persistence.getProvenanceHeadRootHex();
        expect(head).toBeDefined();
        if (head === undefined) throw new Error("expected provenance head");
        const ts = await persistence.getProvenanceTimestampMsForRootHex(head);
        expect(typeof ts).toBe("number");
        expect(ts).toBeGreaterThan(0);
      });

      test("appendProvenanceEvent rolls back with the transaction on throw", async () => {
        const persistence = await create();
        const op: MemoryOpContext = { now: Date.now() };
        const namespace = uniqueNs("contract/prov-rb");
        const before = await persistence.getProvenanceHeadRootHex();
        await expect(
          persistence.withTransaction(async () => {
            await persistence.appendProvenanceEvent(op, {
              v: 1,
              kind: "MERGE_MEMORY",
              namespace,
              memory_key: "ghost",
              memory_id: ids.memory(namespace, "ghost"),
              source_keys: ["only"],
            });
            throw new Error("abort txn");
          }),
        ).rejects.toThrow("abort txn");
        expect(await persistence.getProvenanceHeadRootHex()).toBe(before);
      });

      test("appendProvenanceEvent advances head for contributor + intent snapshot events", async () => {
        const persistence = await create();
        const op: MemoryOpContext = { now: Date.now() };
        const namespace = uniqueNs("contract/prov-contrib");
        const parent = await persistence.getProvenanceHeadRootHex();
        const event = {
          v: 1 as const,
          kind: "MERGE_MEMORY" as const,
          namespace,
          memory_key: "signed",
          memory_id: ids.memory(namespace, "signed"),
          source_keys: ["source"],
          contributor: {
            v: 1 as const,
            format: "khora.direct-principal-v1",
            principal: "did:key:z-test",
            payload: "eyJ2IjoxfQ",
            signature: "MEUCIQD",
            alg: "EdDSA",
            keyId: "did:key:z-test#z-test",
          },
          intent_snapshot_id: "agent-run-1",
        };

        await persistence.withTransaction(async () => {
          await persistence.appendProvenanceEvent(op, event);
        });

        expect(await persistence.getProvenanceHeadRootHex()).toBe(
          nextProvenanceRoot(parent, event).root_hex,
        );
      });

      test("listProvenanceEvents filters by memory; before cursor pages older", async () => {
        const persistence = await create();
        if (persistence.listProvenanceEvents === undefined) return;

        const namespace = uniqueNs("contract/prov-list");
        await mergeMemoryAsync(
          { persistence },
          {
            key: "a",
            namespace,
            content: [{ key: "s", text: "a1" }],
            labels: [],
            edges: [],
          },
        );
        await mergeMemoryAsync(
          { persistence },
          {
            key: "b",
            namespace,
            content: [{ key: "s", text: "b1" }],
            labels: [],
            edges: [],
          },
        );
        await mergeMemoryAsync(
          { persistence },
          {
            key: "a",
            namespace,
            content: [{ key: "s", text: "a2" }],
            labels: [],
            edges: [],
          },
        );

        const forA = await persistence.listProvenanceEvents({
          namespace,
          key: "a",
          limit: 10,
        });
        expect(forA.every((e) => (e.event as { memory_key?: string }).memory_key === "a")).toBe(
          true,
        );
        expect(forA.length).toBe(2);
        const first = forA[0];
        const second = forA[1];
        if (first === undefined || second === undefined) {
          throw new Error("expected two provenance events for memory a");
        }
        expect(first.createdAt).toBeGreaterThanOrEqual(second.createdAt);

        const eventsPage = await persistence.listProvenanceEvents({
          namespace,
          key: "a",
          limit: 1,
          before: { createdAt: first.createdAt, id: first.id },
        });
        expect(eventsPage).toHaveLength(1);
        const next = eventsPage[0];
        if (next === undefined) throw new Error("expected scoped cursor page");
        expect(next.id).toBe(second.id);
        expect((next.event as { memory_key?: string }).memory_key).toBe("a");
      });

      test("listProvenanceChain paginates newest-first", async () => {
        const persistence = await create();
        if (persistence.listProvenanceChain === undefined) return;

        const namespace = uniqueNs("contract/prov-chain");
        await mergeMemoryAsync(
          { persistence },
          {
            key: "a",
            namespace,
            content: [{ key: "s", text: "a1" }],
            labels: [],
            edges: [],
          },
        );
        await mergeMemoryAsync(
          { persistence },
          {
            key: "b",
            namespace,
            content: [{ key: "s", text: "b1" }],
            labels: [],
            edges: [],
          },
        );
        await mergeMemoryAsync(
          { persistence },
          {
            key: "a",
            namespace,
            content: [{ key: "s", text: "a2" }],
            labels: [],
            edges: [],
          },
        );

        const page1 = await persistence.listProvenanceChain({ limit: 2 });
        expect(page1).toHaveLength(2);
        const page1Tail = page1[1];
        if (page1Tail === undefined) throw new Error("expected page1 tail");
        const page2 = await persistence.listProvenanceChain({
          limit: 2,
          beforeRootHex: page1Tail.rootHex,
        });
        expect(page2.length).toBeGreaterThanOrEqual(1);
        expect(page2[0]?.rootHex).not.toBe(page1[0]?.rootHex);
        expect(page2[0]?.rootHex).not.toBe(page1Tail.rootHex);

        const unknown = await persistence.listProvenanceChain({
          limit: 5,
          beforeRootHex: "0".repeat(64),
        });
        expect(unknown).toEqual([]);
      });
    });

    describe("content at root", () => {
      test("getMemoryContentAtRootHex returns arms at tip; delete tip clears", async () => {
        const persistence = await create();
        if (persistence.getMemoryContentAtRootHex === undefined) return;

        const namespace = uniqueNs("contract/content-root");
        const key = "mem";

        await mergeMemoryAsync(
          { persistence },
          {
            key,
            namespace,
            content: [{ key: "s", text: "alive" }],
            labels: [],
            edges: [],
          },
        );
        const mergeRoot = await persistence.getProvenanceHeadRootHex();
        expect(mergeRoot).toBeDefined();
        if (mergeRoot === undefined) throw new Error("expected merge tip");

        const atMerge = await persistence.getMemoryContentAtRootHex(mergeRoot, namespace, key);
        expect(atMerge.some((h) => h.sourceKey === "s" && h.text === "alive")).toBe(true);

        await deleteMemoryAsync({ persistence }, { namespace, key });
        const deleteRoot = await persistence.getProvenanceHeadRootHex();
        expect(deleteRoot).toBeDefined();
        if (deleteRoot === undefined) throw new Error("expected delete tip");
        expect(deleteRoot).not.toBe(mergeRoot);

        const atDelete = await persistence.getMemoryContentAtRootHex(deleteRoot, namespace, key);
        expect(atDelete).toEqual([]);

        const prior = await persistence.getMemoryContentAtRootHex(mergeRoot, namespace, key);
        expect(prior.some((h) => h.sourceKey === "s" && h.text === "alive")).toBe(true);
      });

      test("graph at tip replay when tipReplayAtRootHex", async () => {
        const persistence = await create();
        const caps = resolveMemoriesBackendCapabilities(persistence);
        if (!caps.tipReplayAtRootHex) return;
        if (persistence.getMemoryGraphAtRootHexAsync === undefined) return;

        const namespace = uniqueNs("contract/graph-at-tip");
        const key = "node1";
        await mergeMemoryAsync(
          { persistence },
          {
            key,
            namespace,
            content: [{ key: "s", text: "body" }],
            labels: [{ kind: "topic", props: {} }],
            edges: [],
            properties: { p: 1 },
          },
        );
        const root = await persistence.getProvenanceHeadRootHex();
        expect(root).toBeDefined();
        if (root === undefined) throw new Error("expected tip");

        const graph = await persistence.getMemoryGraphAtRootHexAsync(root, namespace, key);
        expect(graph?.kind).toBe("node");
        expect(graph?.memoryKey).toBe(key);
        expect(graph?.labels.some((l) => l.kind === "topic")).toBe(true);

        if (persistence.getMemoryVectorAtRootHexAsync !== undefined) {
          const vectors = await persistence.getMemoryVectorAtRootHexAsync(root, namespace, key);
          expect(vectors).toEqual([]);
        }

        if (persistence.getProvenanceEventJsonAtRootHexAsync !== undefined) {
          const eventJson = await persistence.getProvenanceEventJsonAtRootHexAsync(root);
          expect(eventJson).toBeTruthy();
          expect(JSON.parse(eventJson as string).kind).toBe("MERGE_MEMORY");
        }

        await deleteMemoryAsync({ persistence }, { namespace, key });
        const deleteRoot = await persistence.getProvenanceHeadRootHex();
        expect(deleteRoot).toBeDefined();
        if (deleteRoot === undefined) throw new Error("expected delete tip");
        const afterDelete = await persistence.getMemoryGraphAtRootHexAsync(
          deleteRoot,
          namespace,
          key,
        );
        expect(afterDelete).toBeNull();
      });
    });

    describe("graph", () => {
      test("loadGraphNode matches split loaders; loadGraphEdge; listIncidentGraphEdges", async () => {
        const persistence = await create();
        const caps = resolveMemoriesBackendCapabilities(persistence);
        if (!caps.graphIndex) return;

        const namespace = uniqueNs("contract/graph");
        await mergeMemoryAsync(
          { persistence },
          {
            key: "a",
            namespace,
            content: [{ key: "b", text: "a" }],
            labels: [{ kind: "topic", props: { t: 1 } }],
            edges: [],
            properties: { nodeProp: true },
          },
        );
        await mergeMemoryAsync(
          { persistence },
          {
            key: "b",
            namespace,
            content: [{ key: "b", text: "b" }],
            labels: [],
            edges: [],
          },
        );
        await mergeMemoryAsync(
          { persistence },
          {
            kind: "edge",
            key: "em-b-a",
            namespace,
            content: [{ key: "body", text: "edge body" }],
            edge: {
              from_memory_id: ids.memory(namespace, "b"),
              to_memory_id: ids.memory(namespace, "a"),
              label: { kind: "rel", props: {} },
            },
          },
        );

        const labelsA = await persistence.loadNodeLabelsForMemory(namespace, "a");
        expect(labelsA.map((l) => l.kind)).toContain("topic");

        const propsA = await persistence.loadNodePropertiesForMemory(namespace, "a");
        expect(propsA).toEqual({ nodeProp: true });

        const gnA = await persistence.loadGraphNode(namespace, "a");
        expect(gnA).not.toBeNull();
        expect(gnA?.namespace).toBe(namespace);
        expect(gnA?.memoryKey).toBe("a");
        expect(gnA?.nodeId).toBe(ids.node(namespace, "a"));
        expect(gnA?.labels.map((l) => l.kind)).toContain("topic");
        expect(gnA?.properties).toEqual({ nodeProp: true });

        expect(await persistence.loadNodePropertiesForMemory(namespace, "unknown")).toBeNull();
        expect(await persistence.loadGraphNode(namespace, "unknown")).toBeNull();

        const edges = await persistence.loadGraphEdgesForNamespace(namespace);
        expect(edges).toHaveLength(1);
        const firstEdge = edges[0];
        if (!firstEdge) throw new Error("expected one edge");
        const edgeId = firstEdge.edgeId;
        expect(firstEdge.properties).toBeTruthy();
        expect((firstEdge.properties as { directed?: boolean }).directed).toBe(true);

        if (persistence.findMemoryKeyByEdgeId !== undefined) {
          const edgeKey = await Promise.resolve(
            persistence.findMemoryKeyByEdgeId(namespace, edgeId),
          );
          expect(edgeKey).toBe("em-b-a");
          expect(
            await Promise.resolve(persistence.findMemoryKeyByEdgeId(namespace, "missing-edge")),
          ).toBeUndefined();
        }

        const one = await persistence.loadGraphEdge(namespace, edgeId);
        expect(one?.edgeId).toBe(edgeId);
        expect(one?.fromKey).toBe("b");
        expect(one?.toKey).toBe("a");
        expect(one?.labels.some((l) => l.kind === "rel")).toBe(true);

        expect(await persistence.loadGraphEdge(namespace, "no_such_edge")).toBeNull();
        expect(await persistence.loadGraphEdge("other", edgeId)).toBeNull();

        const inc = await persistence.listIncidentGraphEdges(namespace, "a");
        expect(inc).toHaveLength(1);
        expect(inc[0]?.edgeId).toBe(edgeId);
      });
    });

    describe("asOf search", () => {
      test("asOf.lte=0 excludes all memories", async () => {
        const persistence = await create();
        const caps = resolveMemoriesBackendCapabilities(persistence);
        if (!caps.vectorSearch || caps.asOfTimestampMsSearch !== true) return;

        const namespace = uniqueNs("contract/vec/asof");
        await mergeMemoryAsync(
          { persistence },
          {
            key: "mem",
            namespace: namespacePath(namespace),
            content: [{ key: "body", vector: makeVec(1.0) }],
            labels: [],
            edges: [],
          },
        );

        const { hits } = await searchAsync(
          { persistence },
          {
            namespace: namespacePath(namespace),
            content: { vector: makeVec(1.0) },
            options: { topK: 10, arms: { vector: 1, lexical: 0 } },
            asOf: { lte: 0 },
          },
        );
        expect(hits).toHaveLength(0);
      });

      test("asOf.lte / gt / range filter by _ts_created", async () => {
        const persistence = await create();
        const caps = resolveMemoriesBackendCapabilities(persistence);
        if (!caps.lexicalSearch || caps.asOfTimestampMsSearch !== true) return;

        const namespace = uniqueNs("contract/lex/asof-ops");
        const marker = `asof_ops_${Math.random().toString(36).slice(2, 10)}`;

        await mergeMemoryAsync(
          { persistence },
          {
            key: "early",
            namespace: namespacePath(namespace),
            content: [{ key: "body", text: marker }],
            labels: [],
            edges: [],
          },
        );
        const earlyCutoff = Date.now();
        await Bun.sleep(25);
        await mergeMemoryAsync(
          { persistence },
          {
            key: "late",
            namespace: namespacePath(namespace),
            content: [{ key: "body", text: `${marker} late` }],
            labels: [],
            edges: [],
          },
        );
        const lateCutoff = Date.now();

        const lex = { arms: { lexical: 1, vector: 0 } as const, topK: 10 };

        const { hits: full } = await searchAsync(
          { persistence },
          {
            namespace: namespacePath(namespace),
            content: { text: marker },
            options: lex,
          },
        );
        expect(full.map((h) => h.memory.key).sort()).toEqual(["early", "late"]);

        const { hits: lteHits } = await searchAsync(
          { persistence },
          {
            namespace: namespacePath(namespace),
            content: { text: marker },
            options: lex,
            asOf: { lte: earlyCutoff },
          },
        );
        expect(lteHits.map((h) => h.memory.key)).toEqual(["early"]);

        const { hits: gtHits } = await searchAsync(
          { persistence },
          {
            namespace: namespacePath(namespace),
            content: { text: marker },
            options: lex,
            asOf: { gt: earlyCutoff },
          },
        );
        expect(gtHits.map((h) => h.memory.key)).toEqual(["late"]);

        const { hits: rangeBoth } = await searchAsync(
          { persistence },
          {
            namespace: namespacePath(namespace),
            content: { text: marker },
            options: lex,
            asOf: { gte: 0, lte: lateCutoff },
          },
        );
        expect(rangeBoth.map((h) => h.memory.key).sort()).toEqual(["early", "late"]);

        const { hits: rangeEarly } = await searchAsync(
          { persistence },
          {
            namespace: namespacePath(namespace),
            content: { text: marker },
            options: lex,
            asOf: { gte: 0, lt: earlyCutoff + 1 },
          },
        );
        expect(rangeEarly.map((h) => h.memory.key)).toEqual(["early"]);
      });
    });

    describe("vector search", () => {
      test("pathSubtree returns only in-namespace vectors", async () => {
        const persistence = await create();
        const caps = resolveMemoriesBackendCapabilities(persistence);
        if (!caps.vectorSearch) return;

        const targetNs = uniqueNs("contract/vec/target");
        const otherNs = uniqueNs("contract/vec/other");
        await mergeMemoryAsync(
          { persistence },
          {
            key: "target",
            namespace: namespacePath(targetNs),
            content: [{ key: "body", vector: makeVec(1.0) }],
            labels: [],
            edges: [],
          },
        );
        await mergeMemoryAsync(
          { persistence },
          {
            key: "noise",
            namespace: namespacePath(otherNs),
            content: [{ key: "body", vector: makeVec(1.0) }],
            labels: [],
            edges: [],
          },
        );

        const { hits } = await searchAsync(
          { persistence },
          {
            namespace: namespacePath(targetNs),
            content: { vector: makeVec(1.0) },
            options: { topK: 10, arms: { vector: 1, lexical: 0 } },
          },
        );
        expect(hits.some((h) => h.memory.key === "target")).toBe(true);
        expect(hits.some((h) => h.memory.key === "noise")).toBe(false);
      });

      test("maxVectorDistance filters far vectors", async () => {
        const persistence = await create();
        const caps = resolveMemoriesBackendCapabilities(persistence);
        if (!caps.vectorSearch) return;

        const namespace = uniqueNs("contract/vec/dist");
        await mergeMemoryAsync(
          { persistence },
          {
            key: "close",
            namespace: namespacePath(namespace),
            content: [{ key: "body", vector: makeVec(1.0) }],
            labels: [],
            edges: [],
          },
        );
        await mergeMemoryAsync(
          { persistence },
          {
            key: "far",
            namespace: namespacePath(namespace),
            content: [{ key: "body", vector: makeVec(-1.0) }],
            labels: [],
            edges: [],
          },
        );

        const { hits } = await searchAsync(
          { persistence },
          {
            namespace: namespacePath(namespace),
            content: { vector: makeVec(1.0) },
            options: {
              topK: 10,
              arms: { vector: 1, lexical: 0 },
              maxVectorDistance: 0.1,
              // Exact distance cutoff requires KNN (ANN distances are approximate).
              vectorSearchMethod: "knn",
            },
          },
        );
        expect(hits.some((h) => h.memory.key === "close")).toBe(true);
        expect(hits.some((h) => h.memory.key === "far")).toBe(false);
      });

      test("searchEntireDatabase finds vectors across namespaces", async () => {
        const persistence = await create();
        const caps = resolveMemoriesBackendCapabilities(persistence);
        if (!caps.vectorSearch || !caps.unscopedSearch) return;

        const nsA = uniqueNs("contract/vec/unscoped-a");
        const nsB = uniqueNs("contract/vec/unscoped-b");
        await mergeMemoryAsync(
          { persistence },
          {
            key: "mem-a",
            namespace: namespacePath(nsA),
            content: [{ key: "body", vector: makeVec(1.0) }],
            labels: [],
            edges: [],
          },
        );
        await mergeMemoryAsync(
          { persistence },
          {
            key: "mem-b",
            namespace: namespacePath(nsB),
            content: [{ key: "body", vector: makeVec(0.9) }],
            labels: [],
            edges: [],
          },
        );

        const { hits } = await searchAsync(
          { persistence },
          {
            namespace: namespacePath(nsA),
            searchEntireDatabase: true,
            content: { vector: makeVec(1.0) },
            options: { topK: 10, arms: { vector: 1, lexical: 0 } },
          },
        );
        const keys = new Set(hits.map((h) => h.memory.key));
        expect(keys.has("mem-a")).toBe(true);
        expect(keys.has("mem-b")).toBe(true);
      });

      test("topK limits vector hits", async () => {
        const persistence = await create();
        const caps = resolveMemoriesBackendCapabilities(persistence);
        if (!caps.vectorSearch || !caps.unscopedSearch) return;

        const root = uniqueNs("contract/vec/topk");
        for (let i = 0; i < 5; i++) {
          await mergeMemoryAsync(
            { persistence },
            {
              key: `m${i}`,
              namespace: namespacePath(`${root}/${i}`),
              content: [{ key: "body", vector: makeVec(1.0) }],
              labels: [],
              edges: [],
            },
          );
        }

        const { hits } = await searchAsync(
          { persistence },
          {
            namespace: namespacePath(root),
            searchEntireDatabase: true,
            content: { vector: makeVec(1.0) },
            options: { topK: 3, arms: { vector: 1, lexical: 0 } },
          },
        );
        expect(hits.length).toBeLessThanOrEqual(3);
      });

      test("pathSubtree still returns in-scope hit when out-of-scope vectors are closer", async () => {
        const persistence = await create();
        const caps = resolveMemoriesBackendCapabilities(persistence);
        if (!caps.vectorSearch) return;

        const root = uniqueNs("contract/vec/scope-regress");
        const otherNs = namespacePath(`${root}/other`);
        const targetNs = namespacePath(`${root}/target`);
        for (let i = 0; i < 5; i++) {
          await mergeMemoryAsync(
            { persistence },
            {
              key: `noise-${i}`,
              namespace: otherNs,
              content: [{ key: "body", vector: makeVec(0.99) }],
              labels: [],
              edges: [],
            },
          );
        }
        await mergeMemoryAsync(
          { persistence },
          {
            key: "target",
            namespace: targetNs,
            content: [{ key: "body", vector: makeVec(0.9) }],
            labels: [],
            edges: [],
          },
        );

        const { hits } = await searchAsync(
          { persistence },
          {
            namespace: targetNs,
            content: { vector: makeVec(1.0) },
            options: { topK: 3, arms: { vector: 1, lexical: 0 } },
          },
        );
        expect(hits.some((h) => h.memory.key === "target")).toBe(true);
        expect(hits.every((h) => h.memory.namespace === targetNs)).toBe(true);
      });

      test("exactScope vector search matches only listed scopes", async () => {
        const persistence = await create();
        const caps = resolveMemoriesBackendCapabilities(persistence);
        if (!caps.vectorSearch) return;

        const nsA = uniqueNs("contract/vec/exact-a");
        const nsB = uniqueNs("contract/vec/exact-b");
        await mergeMemoryAsync(
          { persistence },
          {
            key: "in-scope",
            namespace: namespacePath(nsA),
            content: [{ key: "body", vector: makeVec(1.0) }],
            labels: [],
            edges: [],
          },
        );
        await mergeMemoryAsync(
          { persistence },
          {
            key: "out-scope",
            namespace: namespacePath(nsB),
            content: [{ key: "body", vector: makeVec(1.0) }],
            labels: [],
            edges: [],
          },
        );

        const { hits } = await searchAsync(
          { persistence },
          {
            namespace: namespacePath(nsA),
            content: { vector: makeVec(1.0) },
            options: { topK: 10, arms: { vector: 1, lexical: 0 } },
            searchScopeMode: "exactScope",
          },
        );
        expect(hits.some((h) => h.memory.key === "in-scope")).toBe(true);
        expect(hits.some((h) => h.memory.key === "out-scope")).toBe(false);
      });

      test("searchVectorSourceMapIds memoryIds allowlist restricts results", async () => {
        const persistence = await create();
        const caps = resolveMemoriesBackendCapabilities(persistence);
        if (!caps.vectorSearch || !caps.unscopedSearch) return;

        const namespace = uniqueNs("contract/vec/allow");
        await mergeMemoryAsync(
          { persistence },
          {
            key: "allowed",
            namespace: namespacePath(namespace),
            content: [{ key: "body", vector: makeVec(1.0) }],
            labels: [],
            edges: [],
          },
        );
        await mergeMemoryAsync(
          { persistence },
          {
            key: "blocked",
            namespace: namespacePath(namespace),
            content: [{ key: "body", vector: makeVec(1.0) }],
            labels: [],
            edges: [],
          },
        );
        const allowedId = await persistence.findMemoryIdByKey(namespacePath(namespace), "allowed");
        if (!allowedId) throw new Error("allowed memory not found");

        const result = await persistence.searchVectorSourceMapIds({
          scope: { kind: "unscoped" },
          vector: makeVec(1.0),
          limit: 10,
          memoryIds: [allowedId],
          method: "knn",
        });
        expect(result.sourceMapIds).toHaveLength(1);

        const empty = await persistence.searchVectorSourceMapIds({
          scope: { kind: "unscoped" },
          vector: makeVec(1.0),
          limit: 10,
          memoryIds: [],
          method: "knn",
        });
        expect(empty.sourceMapIds).toEqual([]);
      });

      test("searchVectorSourceMapIds empty scope arrays return nothing", async () => {
        const persistence = await create();
        const caps = resolveMemoriesBackendCapabilities(persistence);
        if (!caps.vectorSearch) return;

        expect(
          await persistence.searchVectorSourceMapIds({
            scope: { kind: "pathSubtree", namespaces: [] },
            vector: makeVec(1.0),
            limit: 10,
            method: "knn",
          }),
        ).toEqual({ sourceMapIds: [] });

        expect(
          await persistence.searchVectorSourceMapIds({
            scope: { kind: "exactScope", scopes: [] },
            vector: makeVec(1.0),
            limit: 10,
            method: "knn",
          }),
        ).toEqual({ sourceMapIds: [] });
      });
    });
  });
}
