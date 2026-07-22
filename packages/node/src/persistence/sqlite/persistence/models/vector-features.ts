import { ids } from "../../../../persistence/core";
import { memoriesPersistenceDocumentSchema } from "../../../../persistence/core/persistence";
import { documentValidator } from "../_lib";
import { vectorToBlob } from "../connection";
import {
  ensureVectorFeaturesVecTable,
  hasVectorAnnSearch,
  vectorVecTableName,
} from "../search-indexes";
import type { DbCtx } from "./context";

export function insertVectorFeature(
  ctx: DbCtx,
  input: { memoryId: string; sourceMapId: string; vector: Float32Array },
): { vectorFeatureId: string } {
  const { db, now, stmts } = ctx;
  const vectorFeatureId = ids.vectorFeature(input.sourceMapId);
  const doc = documentValidator(memoriesPersistenceDocumentSchema, "vector_features");
  const parsed = doc.safeParse({
    _id: vectorFeatureId,
    _ts_created: now,
    memory_id: input.memoryId,
    source_map_id: input.sourceMapId,
    vector: Array.from(input.vector),
  });
  if (!parsed.success) {
    throw new Error(`vector_features validation failed: ${parsed.error.message}`);
  }
  const vfRow = parsed.data;
  const dim = input.vector.length;
  vectorVecTableName(dim);
  const annAvailable = hasVectorAnnSearch(db);
  if (annAvailable) ensureVectorFeaturesVecTable(db, dim);
  const blob = vectorToBlob(input.vector);
  stmts.insertVectorFeatureRow.run(
    vfRow._id,
    vfRow._ts_created,
    vfRow.memory_id,
    vfRow.source_map_id,
    blob,
  );
  if (annAvailable) stmts.getInsertVectorVec(dim).run(vfRow._id, input.vector);
  return { vectorFeatureId };
}
