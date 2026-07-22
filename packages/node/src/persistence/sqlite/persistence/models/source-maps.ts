import { ids } from "../../../../persistence/core";
import { memoriesPersistenceDocumentSchema } from "../../../../persistence/core/persistence";
import type { SourceMapBodyParts } from "../../../../persistence/core/provenance";
import { computeSourceMapContentHash } from "../../../../persistence/core/provenance";
import { documentValidator } from "../_lib";
import type { DbCtx } from "./context";

export function insertSourceMap(
  ctx: DbCtx,
  input: { memoryId: string; sourceKey: string },
): {
  sourceMapId: string;
} {
  const { now, stmts } = ctx;
  const sourceMapId = ids.sourceMap(input.memoryId, input.sourceKey);
  const doc = documentValidator(memoriesPersistenceDocumentSchema, "source_maps");
  doc.parse({
    _id: sourceMapId,
    _ts_created: now,
    memory_id: input.memoryId,
    source_key: input.sourceKey,
  });
  stmts.insertSourceMap.run(sourceMapId, now, input.memoryId, input.sourceKey);
  return { sourceMapId };
}

export function updateSourceMapContentHash(
  ctx: DbCtx,
  input: { sourceMapId: string } & SourceMapBodyParts,
): void {
  const hash = computeSourceMapContentHash({
    text: input.text,
    vector: input.vector,
  });
  ctx.stmts.updateSourceMapContentHash.run(hash, input.sourceMapId);
}
