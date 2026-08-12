import z from "zod";
import type { NamespacePath } from "../../persistence/core";
import { assertNamespacePath } from "../../persistence/core";
import {
  resolveMemoriesBackendCapabilities,
  zVectorPayload,
} from "../../persistence/core/persistence";
import type { MemoryMutationAttribution } from "../../persistence/core/provenance";
import { runWithOpTelemetrySync } from "../../telemetry/index.js";
import {
  buildMemoryOpContext,
  type MutationCtx,
  zMergeMemoryContentItem,
  zUserSourceKey,
} from "./merge-memory";
import { applyReplaceMemoryFeatureArmsSync } from "./replace-memory-feature-arms";

export type ReplaceMemoryFeatureParams = {
  namespace: string;
  key: string;
  sourceKey: string;
  text?: string;
  vector?: number[];
  attribution?: MemoryMutationAttribution;
};

export type ReplaceMemoryFeatureResult = {
  sourceMapId: string;
  rootHex: string;
};

const zReplaceMemoryFeatureBody = z
  .object({
    sourceKey: zUserSourceKey,
    text: z.string().optional(),
    vector: z.array(z.number()).optional(),
  })
  .refine((v) => v.text !== undefined || v.vector !== undefined, {
    message: "content item must include text and/or vector",
  });

/**
 * Upsert one (sourceKey → text?/vector?) feature on an existing memory without clearing
 * other arms, labels, edges, or scopes. Omitting text or vector preserves that sibling arm.
 */
export function replaceMemoryFeature(
  ctx: MutationCtx,
  params: ReplaceMemoryFeatureParams,
): ReplaceMemoryFeatureResult {
  return runWithOpTelemetrySync({
    telemetry: ctx.telemetry,
    op: "replace_feature",
    namespace: params.namespace,
    memoryKey: params.key,
    getProvenanceRootHex: () => ctx.persistence.getProvenanceHeadRootHex() ?? "",
    fn: () => {
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
            "replaceMemoryFeature: content includes vector but persistence.capabilities.vectorSearch is false",
          );
        }
      }

      const op = buildMemoryOpContext(params.attribution);
      let result: ReplaceMemoryFeatureResult | undefined;

      persistence.withTransaction(() => {
        const assoc = persistence.findMemoryAssociation(namespace, params.key);
        if (assoc === undefined) {
          throw new Error("memory not found");
        }
        const arms = applyReplaceMemoryFeatureArmsSync(persistence, op, {
          memoryId: assoc.memoryId,
          sourceKey: parsed.sourceKey,
          ...(parsed.text !== undefined ? { text: parsed.text } : {}),
          ...(parsed.vector !== undefined ? { vector: new Float32Array(parsed.vector) } : {}),
        });

        const { root_hex } = persistence.appendProvenanceEvent(op, {
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
        persistence.appendContentOutbox?.(op, {
          root_hex,
          event_type: "MERGE_MEMORY",
          namespace,
          memoryKey: params.key,
          entries: [{ sourceKey: parsed.sourceKey, text: arms.text }],
        });
        result = { sourceMapId: arms.sourceMapId, rootHex: root_hex };
      });

      if (result === undefined) {
        throw new Error("replaceMemoryFeature: transaction did not produce a result");
      }
      return result;
    },
  });
}
