$version: "2"

namespace khora.memories

/// Hierarchical memory namespace: `/`-separated segments matching `[a-z0-9_-]+`, depth 1..6.
/// In search scopes, each path is a **subtree root** (matches that path and descendant paths).
@pattern("^[a-z0-9_-]+(/[a-z0-9_-]+){0,5}$")
@length(min: 1, max: 128)
string MemoryNamespace

list MemoryNamespaceList {
    member: MemoryNamespace
}

// --- Row / hit shapes (storage-agnostic, aligned with @khoralabs/memories-core db/rows + search) ---

structure MemoryRow {
    _id: String
    _ts_created: Long
    namespace: MemoryNamespace
    key: String
    /// `node` (default in storage migrations) or `edge` (searchable content pinned to one graph edge).
    kind: String
    /// Empty unless `kind` is `edge`; stable `edges` row id.
    edgeId: String
}

structure SourceMapRow {
    _id: String
    _ts_created: Long
    memory_id: String
    source_key: String
}

structure EdgeRow {
    _id: String
    _ts_created: Long
    from_node_id: String
    to_node_id: String
    properties: Document
}

structure NodeRow {
    _id: String
    _ts_created: Long
    value: String
    properties: Document
}

/// One catalog **kind** plus assignment **props** (JSON object).
structure OntologyLabelInstance {
    kind: String
    props: Document
}

list OntologyLabelInstanceList {
    member: OntologyLabelInstance
}

/// Whether hybrid hit content is attached to a primary **node** or a single **edge** (see `MemoryRow.kind`).
union MemoryGraphAssociation {
    /// Node memory: labels are node ontology assignments.
    node: MemoryGraphOnNode
    /// Edge memory: `edge` is the full graph link; `labels` are edge label instances on that edge.
    edge: GraphEdgeLink
}

@documentation("Unit member: node-attached memory (no embedded edge payload).")
structure MemoryGraphOnNode {
}

structure HydratedSourceMapHit {
    _id: String
    _ts_created: Long
    memory_id: String
    source_key: String
    memory: MemoryRow
    /// Node label assignments when `graph.node`; edge label assignments when `graph.edge`.
    labels: OntologyLabelInstanceList
    graph: MemoryGraphAssociation
}

/// Neighbor row from **ListNeighborsForMemory** (no fused neighbor score).
structure HydratedNeighbor {
    _id: String
    _ts_created: Long
    namespace: MemoryNamespace
    key: String
    labels: OntologyLabelInstanceList
    edge: EdgeRow
    /// Incident edge label (kind + props) for this neighbor row.
    edgeLabel: OntologyLabelInstance
}

list HydratedNeighborList {
    member: HydratedNeighbor
}

structure SearchNeighborHit {
    _id: String
    _ts_created: Long
    namespace: MemoryNamespace
    key: String
    labels: OntologyLabelInstanceList
    edge: EdgeRow
    edgeLabel: OntologyLabelInstance
    neighborScore: Double
    matchedSourceMapId: String
}

structure SearchHit {
    /// Source map row fields
    _id: String
    _ts_created: Long
    memory_id: String
    source_key: String
    score: Double
    memory: MemoryRow
    labels: OntologyLabelInstanceList
    graph: MemoryGraphAssociation
    neighbors: SearchNeighborHitList
}

list SearchNeighborHitList {
    member: SearchNeighborHit
}

@documentation("""
Optional backend feature flags. Omitted keys default via core `resolveMemoriesBackendCapabilities`
(lexical, vector, neighbor, graph index, multi-namespace on; **unscopedSearch** off).

When a flag is false, the logic layer:
- **lexicalSearch:** skips lexical arm; text-only merge may still run if FTS is a no-op.
- **vectorSearch:** skips vector arm; rejects merge content items with vector; vector-only search returns [].
- **neighborIndex:** skips neighbor listing and expansion in search.
- **graphIndex:** graph topology reads on persistence return empty lists/maps.
- **multiNamespaceSearch:** core runs separate per-namespace retrieval and merges with RRF (no `IN` list required).
- **unscopedSearch:** rejects `searchEntireDatabase` on SearchParams; unscoped scope is not used.

Thin single-namespace adapters should set **multiNamespaceSearch** false; core still works via fallback.
""")
structure MemoriesBackendCapabilities {
    /// When false, logic skips lexical arm.
    lexicalSearch: Boolean
    /// When false, logic rejects merge vectors and skips vector arm.
    vectorSearch: Boolean
    /// When false, search ignores neighbor listing and expansion.
    neighborIndex: Boolean
    /// When false, graph topology reads return empty structures.
    graphIndex: Boolean
    /// When false, core runs separate per-namespace retrieval and merges with RRF.
    multiNamespaceSearch: Boolean
    /// When false, `searchEntireDatabase` on SearchParams is rejected.
    unscopedSearch: Boolean
}

/// Retrieval scope for hybrid search (`SearchLexicalSourceMapIds` / `SearchVectorSourceMapIds`).
union SearchNamespaceScope {
    /// Prefix roots on each memory row's primary `namespace` column (current subtree behavior).
    pathSubtree: PathSubtreeScope
    /// Scope DAG roots: memory matches when attached to any scope reachable as a descendant.
    scopeDag: ScopeDagScope
    /// Memories attached to scope ids exactly equal to listed scopes (no DAG descent).
    exactScope: ExactScopeAttachmentScope
    /// Marker member: no namespace predicate (entire DB).
    unscoped: UnscopedScope
}

structure PathSubtreeScope {
    /// Non-empty, deduped subtree roots on primary namespace paths.
    namespaces: MemoryNamespaceList
}

structure ScopeDagScope {
    /// Non-empty scope ids (`MemoryNamespace` syntax); closure expands to descendant scopes.
    roots: MemoryNamespaceList
}

structure ExactScopeAttachmentScope {
    /// Exact scope attachments — ids use `MemoryNamespace` syntax.
    scopes: MemoryNamespaceList
}

/// Marker member: no namespace predicate (entire DB).
structure UnscopedScope {}

// --- Public API: merge / search / delete ---

structure MergeMemoryContentItem {
    /// User content key; must not be reserved (`__` prefix or search-meta key).
    key: String
    text: String
    vector: DoubleList
}

list DoubleList {
    member: Double
}

structure MergeMemoryEdge {
    /// Peer endpoint memory id (`ids.memory(ns, key)`); primary namespace is implicit on the peer row.
    peer_memory_id: String
    direction: EdgeDirection
    label: OntologyLabelInstance
    properties: Document
}

enum EdgeDirection {
    @enumValue("in")
    IN

    @enumValue("out")
    OUT
}

/// Discriminated merge: **node** (primary graph node + optional incident edges) vs **edge** (content on one graph edge).
union MergeMemoryParams {
    node: MergeMemoryParamsNode
    edge: MergeMemoryParamsEdge
}

structure MergeMemoryParamsNode {
    key: String
    namespace: MemoryNamespace
    content: MergeMemoryContentItemList
    labels: OntologyLabelInstanceList
    properties: Document
    edges: MergeMemoryEdgeList
    /// Optional extra DAG scope attachments (`attachScopes` in TS); primary namespace is always attached by merge.
    searchMetaVector: DoubleList
}

structure MergeMemoryEdgeAssociation {
    from_memory_id: String
    to_memory_id: String
    label: OntologyLabelInstance
    properties: Document
}

structure MergeMemoryParamsEdge {
    key: String
    namespace: MemoryNamespace
    content: MergeMemoryContentItemList
    /// Endpoints and edge label for the single graph edge this memory owns.
    edge: MergeMemoryEdgeAssociation
    /// Optional scope attachments (`attachScopes` in TS), same semantics as node merge.
    searchMetaVector: DoubleList
}

list MergeMemoryContentItemList {
    member: MergeMemoryContentItem
}

list MergeMemoryEdgeList {
    member: MergeMemoryEdge
}

structure MergeMemoryOutput {
    /// Keys whose search-meta lexical row was rebuilt.
    invalidatedMetaKeys: StringList
}

structure DeleteMemoryParams {
    namespace: MemoryNamespace
    key: String
}

structure DeleteMemoryOutput {}

structure SearchContent {
    text: String
    vector: DoubleList
}

structure LabelFilter {
    all: StringList
    some: StringList
}

structure NeighborNodesFilter {
    all: StringList
    some: StringList
}

structure NeighborConstraint {
    /// Edge label kind (opaque string).
    label: String
    direction: EdgeDirection
    nodes: NeighborNodesFilter
}

structure NeighborFilter {
    all: NeighborConstraintList
    some: NeighborConstraintList
}

list NeighborConstraintList {
    member: NeighborConstraint
}

union NeighborSearchOption {
    toggle: Boolean
    structured: NeighborFilter
}

structure SearchArms {
    vector: Double
    lexical: Double
}

structure SearchOptions {
    topK: Integer
    minScore: Double
    labels: LabelFilter
    neighbors: NeighborSearchOption
    maxNeighbors: Integer
    arms: SearchArms
}

structure SearchParams {
    namespace: MemoryNamespace
    additionalNamespaces: MemoryNamespaceList
    searchEntireDatabase: Boolean
    content: SearchContent
    options: SearchOptions
}

structure SearchOutput {
    hits: SearchHitList
}

list SearchHitList {
    member: SearchHit
}

list HydratedSourceMapHitList {
    member: HydratedSourceMapHit
}

list StringList {
    member: String
}

list SourceMapRowList {
    member: SourceMapRow
}

/// Denormalized text row for export (JSONL prefetch); join of `text_features` and `source_maps`.
structure TextFeatureExportRow {
    memory_id: String
    source_key: String
    text: String
}

list TextFeatureExportRowList {
    member: TextFeatureExportRow
}

list IntegerList {
    member: Integer
}

// --- Persistence: shared op context ---

structure MemoryOpContext {
    now: Long
}

structure GraphEdgeLink {
    edgeId: String
    fromKey: String
    toKey: String
    labels: OntologyLabelInstanceList
    /// JSON object from the `edges` row (not label-assignment props). Omitted when absent.
    properties: Document
    /// When true, the stored link is treated as directed (`fromKey` → `toKey`). Omitted when false/absent.
    directed: Boolean
}

list GraphEdgeLinkList {
    member: GraphEdgeLink
}

/// Primary graph node for one memory (labels + properties + stable ids).
structure GraphNode {
    namespace: MemoryNamespace
    memoryKey: String
    nodeId: String
    labels: OntologyLabelInstanceList
    /// Parsed `nodes.properties`; use empty object when null in storage.
    properties: Document
}

/// One memory key’s node labels (bulk graph read).
structure MemoryKeyNodeLabelsEntry {
    memoryKey: String
    labels: OntologyLabelInstanceList
}

list MemoryKeyNodeLabelsEntryList {
    member: MemoryKeyNodeLabelsEntry
}

/// One memory key’s node JSON properties (bulk graph read).
structure MemoryKeyNodePropertiesEntry {
    memoryKey: String
    /// Parsed `nodes.properties`; use empty object when null in storage.
    properties: Document
}

list MemoryKeyNodePropertiesEntryList {
    member: MemoryKeyNodePropertiesEntry
}

structure GraphMemoryEmbedding {
    memoryKey: String
    memoryId: String
    embedding: DoubleList
}

structure EdgePreviewPayload {
    edgeId: String
    fromKey: String
    toKey: String
    labels: OntologyLabelInstanceList
    properties: Document
}

structure InsertEdgeIdParts {
    label: String
    fromMemoryId: String
    toMemoryId: String
}
