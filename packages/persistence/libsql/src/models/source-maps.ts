import { ids } from "@khoralabs/memories-persistence-core";
import { memoriesPersistenceDocumentSchema } from "@khoralabs/memories-persistence-core/persistence";
import type { SourceMapBodyParts } from "@khoralabs/memories-persistence-core/provenance";
import { computeSourceMapContentHash } from "@khoralabs/memories-persistence-core/provenance";
import { documentValidator } from "../_lib";
import type { DbCtx } from "../context";
import { ctxExec } from "../db";

export async function insertSourceMap(
  ctx: DbCtx,
  input: { memoryId: string; sourceKey: string },
): Promise<{ sourceMapId: string }> {
  const sourceMapId = ids.sourceMap(input.memoryId, input.sourceKey);
  const doc = documentValidator(memoriesPersistenceDocumentSchema, "source_maps");
  doc.parse({
    _id: sourceMapId,
    _ts_created: ctx.now,
    memory_id: input.memoryId,
    source_key: input.sourceKey,
  });
  await ctxExec(
    ctx,
    `INSERT INTO source_maps (_id, _ts_created, memory_id, source_key) VALUES (?, ?, ?, ?)`,
    [sourceMapId, ctx.now, input.memoryId, input.sourceKey],
  );
  return { sourceMapId };
}

export async function updateSourceMapContentHash(
  ctx: DbCtx,
  input: { sourceMapId: string } & SourceMapBodyParts,
): Promise<void> {
  const hash = computeSourceMapContentHash({
    text: input.text,
    vector: input.vector,
  });
  await ctxExec(ctx, `UPDATE source_maps SET content_hash = ? WHERE _id = ?`, [
    hash,
    input.sourceMapId,
  ]);
}
