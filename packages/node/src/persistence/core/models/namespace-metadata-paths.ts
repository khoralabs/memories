import type { NamespaceMetadataInfo } from "../persistence/types";
import type { NamespacePath } from "./namespace-path";

/** Path strings from catalog metadata rows (for algorithms / filters). */
export function namespacePathsFromMetadata(
  rows: readonly Pick<NamespaceMetadataInfo, "namespace">[],
): NamespacePath[] {
  return rows.map((row) => row.namespace);
}
