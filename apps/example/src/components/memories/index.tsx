export {
  AddMemoryButton,
  type AddMemoryButtonProps,
} from "@/components/memories/add-memory-button";
export {
  AddNamespaceButton,
  type AddNamespaceButtonProps,
} from "@/components/memories/add-namespace-button";
export {
  EdgeBillboard,
  EdgeBillboardHeader,
  type EdgeBillboardHeaderProps,
  EdgeBillboardLabels,
  type EdgeBillboardLabelsCtx,
  type EdgeBillboardLabelsProps,
  EdgeBillboardLoading,
  type EdgeBillboardLoadingProps,
  EdgeBillboardMetadata,
  type EdgeBillboardMetadataCtx,
  type EdgeBillboardMetadataProps,
  type EdgeBillboardProps,
  useEdgeBillboard,
} from "@/components/memories/edge-billboard";
export {
  GraphEdgeBillboardMetadata,
  GraphEdgeBillboardOntology,
  GraphNodeBillboardMetadata,
  GraphNodeBillboardOntology,
} from "@/components/memories/graph-billboard-compounds";
export {
  GraphCameraChrome,
  GraphCameraChromeProvider,
  GraphCameraReframeHint,
  type GraphCameraReframeHintProps,
  useGraphCameraChrome,
} from "@/components/memories/graph-camera-chrome";
export {
  GraphFetchError,
  type GraphFetchErrorProps,
} from "@/components/memories/graph-fetch-error";
export { GraphLoading, type GraphLoadingProps } from "@/components/memories/graph-loading";
export {
  GraphNamespaceSearch,
  type GraphNamespaceSearchProps,
} from "@/components/memories/graph-namespace-search";
export {
  GraphNamespaceTree,
  type GraphNamespaceTreeProps,
} from "@/components/memories/graph-namespace-tree";
export { GraphOverlayContainer } from "@/components/memories/graph-overlay-container";
export {
  GraphPinnedEscHint,
  type GraphPinnedEscHintProps,
} from "@/components/memories/graph-pinned-esc-hint";
export {
  GraphPreviewDock,
  type GraphPreviewDockContent,
  type GraphPreviewDockProps,
} from "@/components/memories/graph-preview-dock";
export {
  RefreshGraphButton,
  type RefreshGraphButtonProps,
} from "@/components/memories/graph-refresh-button";
export type { GraphSceneEdgeProps } from "@/components/memories/graph-scene-edge";
export type {
  GraphSceneFogBlurOptions,
  GraphSceneFogChannel,
  GraphSceneFogChannelOptions,
  GraphSceneFogColorOptions,
  GraphSceneFogEase,
  GraphSceneFogOptions,
  GraphSceneFogProp,
} from "@/components/memories/graph-scene-fog";
export {
  fogBlurCssPx,
  fogChannelStrength,
  fogFactor,
  useGraphSceneFog,
} from "@/components/memories/graph-scene-fog";
export type {
  GraphSceneNodeButtonProps,
  GraphSceneNodeProps,
  GraphSceneNodeTooltipProps,
} from "@/components/memories/graph-scene-node";
export { useGraphSceneNode } from "@/components/memories/graph-scene-node";
export type {
  GraphSceneEdgeRender,
  GraphSceneNodeRender,
} from "@/components/memories/graph-scene-slots";
export { GraphSearch, type GraphSearchProps } from "@/components/memories/graph-search";
export type {
  EdgeDetailJson,
  EdgePreviewJson,
  GraphCountsResult,
  GraphSearchResult,
  GraphStatsResult,
  MemoriesDatabaseId,
  MemoryDetailJson,
  MemoryPreviewJson,
  NamespaceSearchArms,
  NamespaceSearchClientResult,
  NamespaceSearchHitResult,
  ReactMemoriesClient,
  TipAtRootJson,
} from "@/components/memories/memories-client";
export {
  MemoriesClientProvider,
  type MemoriesClientProviderProps,
  type MemoriesClientValue,
  type MemoriesOntologyLinkClient,
  type MemoriesOntologySchema,
  type MemoriesOpenDatabaseClient,
  useMemoriesClient,
  useMemoriesDatabase,
} from "@/components/memories/memories-client-provider";
export {
  type CatalogMemory,
  type CreateMemoryInput,
  type FocusedMemory,
  type MemoriesMemoryValue,
  MemoriesNamespaceMemoriesProvider,
  type MemoriesNamespaceMemoriesProviderProps,
  type MemoryContentArm,
  type MemoryFeatures,
  type MemoryLabelArm,
  type UpdateMemoryFeaturesInput,
  useMemoriesMemory,
} from "@/components/memories/memories-memory-provider";
export {
  type CreateNamespaceInput,
  MemoriesNamespacesProvider,
  type MemoriesNamespacesProviderProps,
  type MemoriesNamespacesValue,
  useMemoriesNamespaces,
} from "@/components/memories/memories-namespaces-provider";
export {
  formatEdgeLabelKind,
  formatNodeLabelKind,
  formatOntologyLabelChain,
  formatOntologyLabelKind,
  MemoryDetailOntology,
  type MemoryLabel,
} from "@/components/memories/memory-detail-ontology";
export {
  isSafeMetaPropertyName,
  MemoryMetadata,
  type MemoryMetadataKind,
  type MemoryMetadataProps,
} from "@/components/memories/memory-metadata";
export {
  firstContentExcerpt,
  MemoryEdgeHoverCard,
  MemoryNodeHoverCard,
} from "@/components/memories/memory-relation-hovers";
export {
  NodeBillboard,
  NodeBillboardHeader,
  type NodeBillboardHeaderProps,
  NodeBillboardLabels,
  type NodeBillboardLabelsCtx,
  type NodeBillboardLabelsProps,
  NodeBillboardLoading,
  type NodeBillboardLoadingProps,
  NodeBillboardMetadata,
  type NodeBillboardMetadataCtx,
  type NodeBillboardMetadataProps,
  type NodeBillboardProps,
  useNodeBillboard,
} from "@/components/memories/node-billboard";
export * from "@/components/memories/projection-types";
export {
  AtTipPanel,
  type AtTipPanelProps,
  ProvenanceTimeline,
  type ProvenanceTimelineProps,
} from "@/components/memories/provenance-timeline";
export {
  RelationChain,
  RelationEdgeBadge,
  relationEdgeSegmentText,
  relationNodeSegmentText,
  truncateRelationKey,
} from "@/components/memories/relation-chain";
export type {
  GraphEdgeRenderMode,
  GraphSceneOverlayOptions,
  GraphSceneProps,
  GraphSceneResolvedOverlay,
} from "@/components/memories/scene";
export { GraphScene, resolveGraphSceneOverlay } from "@/components/memories/scene";
export type {
  GraphProjectionProviderProps,
  GraphScope,
  MemoriesGraphChromeValue,
  MemoriesGraphProfileEntry,
} from "@/components/memories/use-projection";
export {
  DEFAULT_GRAPH_FOCUS_DELAY_MS,
  DEFAULT_GRAPH_UNFOCUS_DELAY_MS,
  GraphProjectionProvider,
  useMemoriesGraphChrome,
  useProjection,
} from "@/components/memories/use-projection";
export { Badge, badgeVariants } from "@/components/ui/badge";
export {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
export { Spinner } from "@/components/ui/spinner";
export { useEdgeDetail } from "@/hooks/use-edge-detail";
export {
  type GraphMemoriesSearchValue,
  type GraphNamespacesSearchValue,
  graphNamespaceSearchSummaryLine,
  graphSearchSummaryLine,
  useGraphMemoriesSearch,
  useGraphNamespacesSearch,
} from "@/hooks/use-graph-search";
export { useMemoryDetail } from "@/hooks/use-memory-detail";
export { useSuppressBenignResizeObserverErrors } from "@/hooks/use-suppress-benign-resize-observer-errors";
export {
  contentArmsToMergeItems,
  ensureMergeContent,
  isReservedContentSourceKey,
  type PreviewContentArm,
  type PreviewLabel,
  userContentArms,
} from "@/lib/memory-merge";
export { resolveMemoryPathIdentity } from "@/lib/memory-path";
export {
  entriesToProperties,
  type PropertyEntry,
  propertiesToEntries,
} from "@/lib/memory-properties";
export type {
  MemoriesGraphNamespaceEntry,
  MemoriesGraphNamespaceEntryInput,
} from "@/lib/namespace-entries";
export {
  joinNamespacePath,
  NAMESPACE_MAX_DEPTH,
  NAMESPACE_MAX_PATH_LENGTH,
  type NamespacePathPolicy,
  validateNamespacePath,
  validateNamespaceSegment,
} from "@/lib/namespace-path";
export { DEFAULT_SEARCH_DEBOUNCE_MS } from "@/lib/search-debounce";
export {
  installBenignResizeObserverErrorSuppression,
  isBenignResizeObserverError,
} from "@/lib/suppress-benign-resize-observer-errors";
