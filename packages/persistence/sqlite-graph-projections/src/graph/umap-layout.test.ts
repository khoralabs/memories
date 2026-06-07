import { expect, test } from "bun:test";
import { umap3DLayout } from "./umap-layout";

test("umap3DLayout is deterministic for the same embeddings", () => {
  const emb = Array.from({ length: 10 }, (_, i) => [Math.sin(i), Math.cos(i * 0.7), i * 0.1, 0.5]);
  const a = umap3DLayout(emb);
  const b = umap3DLayout(emb);
  expect(a).toEqual(b);
});
