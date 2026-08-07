import { zVectorPayload } from "@khoralabs/memories-node/persistence";

import { HttpError } from "./handlers";

/**
 * Fail-fast HTTP check for client-supplied embeddings (search / merge).
 * Bounds match {@link zVectorPayload}: 512–3072 float32 values.
 */
export function assertHttpVectorPayload(vector: unknown, field: string): number[] {
  const parsed = zVectorPayload.safeParse(vector);
  if (!parsed.success) {
    const detail = parsed.error.issues[0]?.message ?? "invalid vector payload";
    throw new HttpError(`${field}: ${detail} (expected 512-3072 float32 values)`, 400);
  }
  return parsed.data;
}
