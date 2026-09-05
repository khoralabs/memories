/**
 * Node/server-only: re-export from `@khoralabs/memories-service/react-client/service`.
 * Do not import this entry from browser UI bundles.
 */

export type {
  EdgePreviewJson,
  GraphSearchResult,
  MemoriesDatabaseId,
  NamespaceSearchArms,
  NamespaceSearchClientResult,
  NamespaceSearchHitResult,
  ReactMemoriesClient,
} from "@khoralabs/memories-service/react-client";
export {
  type CreateServiceReactMemoriesClientOptions,
  createServiceReactMemoriesClient,
} from "@khoralabs/memories-service/react-client/service";
