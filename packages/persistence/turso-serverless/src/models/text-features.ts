import { ids } from "@khoralabs/memories-core";
import { memoriesPersistenceDocumentSchema } from "@khoralabs/memories-core/persistence";
import { documentValidator } from "../_lib";
import type { DbCtx } from "../context";
import { ctxExec } from "../db";

export async function insertLexicalFeature(
  ctx: DbCtx,
  input: { memoryId: string; sourceMapId: string; text: string },
): Promise<{ textFeatureId: string }> {
  const textFeatureId = ids.textFeature(input.sourceMapId);
  const doc = documentValidator(memoriesPersistenceDocumentSchema, "text_features");
  doc.parse({
    _id: textFeatureId,
    _ts_created: ctx.now,
    memory_id: input.memoryId,
    source_map_id: input.sourceMapId,
    text: input.text,
  });
  await ctxExec(
    ctx,
    `INSERT INTO text_features (_id, _ts_created, memory_id, source_map_id, text) VALUES (?, ?, ?, ?, ?)`,
    [textFeatureId, ctx.now, input.memoryId, input.sourceMapId, input.text],
  );
  return { textFeatureId };
}
