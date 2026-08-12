import z from "zod";
import type { NamespacePath } from "../../persistence/core";
import { assertNamespacePath } from "../../persistence/core";
import {
  resolveMemoriesBackendCapabilities,
  zVectorPayload,
} from "../../persistence/core/persistence";
import { runWithOpTelemetryAsync } from "../../telemetry/index.js";
import { buildMemoryOpContext, zMergeMemoryContentItem, zUserSourceKey } from "./merge-memory";
import type { MutationCtxAsync } from "./merge-memory-async";
import type {
  ReplaceMemoryFeatureParams,
  ReplaceMemoryFeatureResult,
} from "./replace-memory-feature";
import { applyReplaceMemoryFeatureArmsAsync } from "./replace-memory-feature-arms";

const zReplaceMemoryFeatureBody = z
  .object({
    sourceKey: zUserSourceKey,
    text: z.string().optional(),
    vector: z.array(z.number()).optional(),
  })
  .refine((v) => v.text !== undefined || v.vector !== undefined, {
    message: "content item must include text and/or vector",
  });

/** Async counterpart of {@link replaceMemoryFeature}. */
export async function replaceMemoryFeatureAsync(
  ctx: MutationCtxAsync,
  params: ReplaceMemoryFeatureParams,
): Promise<ReplaceMemoryFeatureResult> {
  return runWithOpTelemetryAsync({
    telemetry: ctx.telemetry,
    op: "replace_feature",
    namespace: params.namespace,
    memoryKey: params.key,
    getProvenanceRootHex: async () => (await ctx.persistence.getProvenanceHeadRootHex()) ?? "",
    fn: async () => {
      const { persistence } = ctx;
      const policy = ctx.namespacePathPolicy ?? persistence.namespacePathPolicy;
      const namespace = assertNamespacePath(params.namespace, policy) as NamespacePath;
      const parsed = zReplaceMemoryFeatureBody.parse({
        sourceKey: params.sourceKey,
        ...(params.text !== undefined ? { text: params.text } : {}),
        ...(params.vector !== undefined ? { vector: params.vector } : {}),
      });
      zMergeMemoryContentItem.parse({
        key: parsed.sourceKey,
        ...(parsed.text !== undefined ? { text: parsed.text } : {}),
        ...(parsed.vector !== undefined ? { vector: parsed.vector } : {}),
      });

      const caps = resolveMemoriesBackendCapabilities(persistence);
      if (parsed.vector !== undefined) {
        zVectorPayload.parse(parsed.vector);
        if (!caps.vectorSearch) {
          throw new Error(
            "replaceMemoryFeatureAsync: content includes vector but persistence.capabilities.vectorSearch is false",
          );
        }
      }

      const op = buildMemoryOpContext(params.attribution);
      let result: ReplaceMemoryFeatureResult | undefined;

      await persistence.withTransaction(async () => {
        const assoc = await persistence.findMemoryAssociation(namespace, params.key);
        if (assoc === undefined) {
          throw new Error("memory not found");
        }
        const arms = await applyReplaceMemoryFeatureArmsAsync(persistence, op, {
          memoryId: assoc.memoryId,
          sourceKey: parsed.sourceKey,
          ...(parsed.text !== undefined ? { text: parsed.text } : {}),
          ...(parsed.vector !== undefined ? { vector: new Float32Array(parsed.vector) } : {}),
        });

        const { root_hex } = await persistence.appendProvenanceEvent(op, {
          v: 1,
          kind: "MERGE_MEMORY",
          namespace,
          memory_key: params.key,
          memory_id: assoc.memoryId,
          source_keys: [parsed.sourceKey],
          content_hashes: { [parsed.sourceKey]: arms.contentHash },
          ...(op.contributor !== undefined ? { contributor: op.contributor } : {}),
          ...(op.intentSnapshotId !== undefined ? { intent_snapshot_id: op.intentSnapshotId } : {}),
        });
        await persistence.appendContentOutbox?.(op, {
          root_hex,
          event_type: "MERGE_MEMORY",
          namespace,
          memoryKey: params.key,
          entries: [{ sourceKey: parsed.sourceKey, text: arms.text }],
        });
        result = { sourceMapId: arms.sourceMapId, rootHex: root_hex };
      });

      if (result === undefined) {
        throw new Error("replaceMemoryFeatureAsync: transaction did not produce a result");
      }
      return result;
    },
  });
}
