import { ids } from "@khoralabs/memories-core";
import { memoriesPersistenceDocumentSchema } from "@khoralabs/memories-core/persistence";
import { documentValidator } from "../_lib";
import type { DbCtx } from "./context";

export function insertLexicalFeature(
  ctx: DbCtx,
  input: { memoryId: string; sourceMapId: string; text: string },
): { textFeatureId: string } {
  const { now, stmts } = ctx;
  const textFeatureId = ids.textFeature(input.sourceMapId);
  const doc = documentValidator(memoriesPersistenceDocumentSchema, "text_features");
  doc.parse({
    _id: textFeatureId,
    _ts_created: now,
    memory_id: input.memoryId,
    source_map_id: input.sourceMapId,
    text: input.text,
  });
  stmts.insertTextFeature.run(textFeatureId, now, input.memoryId, input.sourceMapId, input.text);
  stmts.insertTextFeatureFts.run(textFeatureId, input.memoryId, input.sourceMapId, input.text);
  return { textFeatureId };
}
