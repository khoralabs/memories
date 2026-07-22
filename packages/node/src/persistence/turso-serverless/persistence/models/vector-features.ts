import { ids } from "../../../../persistence/core";
import { memoriesPersistenceDocumentSchema } from "../../../../persistence/core/persistence";
import { documentValidator } from "../_lib";
import type { DbCtx } from "../context";
import { ctxExec } from "../db";
import { vector32Json } from "../sql";

export async function insertVectorFeature(
  ctx: DbCtx,
  input: { memoryId: string; sourceMapId: string; vector: Float32Array },
): Promise<{ vectorFeatureId: string }> {
  const vectorFeatureId = ids.vectorFeature(input.sourceMapId);
  const doc = documentValidator(memoriesPersistenceDocumentSchema, "vector_features");
  const parsed = doc.safeParse({
    _id: vectorFeatureId,
    _ts_created: ctx.now,
    memory_id: input.memoryId,
    source_map_id: input.sourceMapId,
    vector: Array.from(input.vector),
  });
  if (!parsed.success) {
    throw new Error(`vector_features validation failed: ${parsed.error.message}`);
  }
  const vfRow = parsed.data;
  const vectorJson = vector32Json(input.vector);
  await ctxExec(
    ctx,
    `INSERT INTO vector_features (_id, _ts_created, memory_id, source_map_id, vector)
     VALUES (?, ?, ?, ?, vector32(?))`,
    [vfRow._id, vfRow._ts_created, vfRow.memory_id, vfRow.source_map_id, vectorJson],
  );
  return { vectorFeatureId };
}
