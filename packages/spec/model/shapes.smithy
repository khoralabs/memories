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

/// Soft-rename / display label for a namespace path. `alias` omitted/null means UI should use `namespace`.
structure NamespaceMetadata {
    @required
    namespace: MemoryNamespace
    alias: String
    @required
    description: String
}

list NamespaceMetadataList {
    member: NamespaceMetadata
}

// --- Row / hit shapes (storage-agnostic, aligned with @khoralabs/memories-node) ---

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
    /// Lowercase SHA-256 hex body commitment (`MEMORIES_SOURCE_BODY_v1`); omitted when unset.
    content_hash: String
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
(lexical, vector, neighbor, graph index, multi-namespace on; **unscopedSearch** off;
**vectorKnnSearch** / **vectorAnnSearch** off — backends must opt in).

When a flag is false, the logic layer:
- **lexicalSearch:** skips lexical arm; text-only merge may still run if FTS is a no-op.
- **vectorSearch:** skips vector arm; rejects merge content items with vector; vector-only search returns [].
- **vectorKnnSearch:** exact cosine path unavailable; explicit `knn` is a noop.
- **vectorAnnSearch:** approximate index path unavailable; explicit `ann` is a noop.
- **neighborIndex:** skips neighbor listing and expansion in search.
- **graphIndex:** graph topology reads on persistence return empty lists/maps.
- **multiNamespaceSearch:** core runs separate per-namespace retrieval and merges with RRF (no `IN` list required).
- **unscopedSearch:** rejects `searchEntireDatabase` on SearchParams; unscoped scope is not used.
- **asOfTimestampMsSearch:** when true, `SearchParams.asOf` is applied; when omitted/false, as-of search is rejected.
- **tipReplayAtRootHex:** when true, graph/vector/provenance replay at a provenance tip is available; when omitted/false, those replay ops are unavailable (content facet replay is separate).

Thin single-namespace adapters should set **multiNamespaceSearch** false; core still works via fallback.
""")
structure MemoriesBackendCapabilities {
    /// When false, logic skips lexical arm.
    lexicalSearch: Boolean
    /// When false, logic rejects merge vectors and skips vector arm.
    vectorSearch: Boolean
    /// When true, exact / linear cosine vector search (`knn`) is available.
    vectorKnnSearch: Boolean
    /// When true, approximate vector index search (`ann`) is available.
    vectorAnnSearch: Boolean
    /// When false, search ignores neighbor listing and expansion.
    neighborIndex: Boolean
    /// When false, graph topology reads return empty structures.
    graphIndex: Boolean
    /// When false, core runs separate per-namespace retrieval and merges with RRF.
    multiNamespaceSearch: Boolean
    /// When false, `searchEntireDatabase` on SearchParams is rejected.
    unscopedSearch: Boolean
    /// When true, hybrid search honors `asOf` (memory `_ts_created` bounds).
    asOfTimestampMsSearch: Boolean
    /// When true, graph/vector/provenance TipOutbox replay at a provenance tip is available.
    tipReplayAtRootHex: Boolean
}

enum VectorSearchMethod {
    @enumValue("knn")
    KNN

    @enumValue("ann")
    ANN
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
    /// At least one of `text` or `vector` must be present (Zod refine in TS).
    text: String
    vector: DoubleList
}

/// Caller-supplied attribution for merge/delete (feeds `MemoryOpContext`).
structure MemoryMutationAttribution {
    contributor: ContributorAttestation
    intentSnapshotId: String
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
    /// Extra DAG scope attachments; primary namespace is always attached by merge.
    attachScopes: MemoryNamespaceList
    searchMetaVector: DoubleList
    attribution: MemoryMutationAttribution
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
    /// Extra DAG scope attachments; same semantics as node merge.
    attachScopes: MemoryNamespaceList
    searchMetaVector: DoubleList
    attribution: MemoryMutationAttribution
}

list MergeMemoryContentItemList {
    member: MergeMemoryContentItem
}

list MergeMemoryEdgeList {
    member: MergeMemoryEdge
}

structure MergeMemoryOutput {
    /// Stable memory ids touched by the merge (primary + any neighbors whose search-meta was synced).
    memoryIds: StringList
}

structure DeleteMemoryParams {
    namespace: MemoryNamespace
    key: String
    attribution: MemoryMutationAttribution
}

structure DeleteMemoryOutput {}

/// Upsert one content arm without clearing other arms, labels, edges, or scopes.
/// Omitting `text` or `vector` preserves that sibling arm. Records provenance as `MERGE_MEMORY`.
structure ReplaceMemoryFeatureParams {
    namespace: MemoryNamespace
    key: String
    sourceKey: String
    text: String
    vector: DoubleList
    attribution: MemoryMutationAttribution
}

structure ReplaceMemoryFeatureOutput {
    sourceMapId: String
    rootHex: String
}

structure SuppressMemoryParams {
    namespace: MemoryNamespace
    key: String
    attribution: MemoryMutationAttribution
}

structure SuppressMemoryOutput {}

structure UnsuppressMemoryParams {
    namespace: MemoryNamespace
    key: String
    attribution: MemoryMutationAttribution
}

structure UnsuppressMemoryOutput {}

structure SuppressNamespaceParams {
    namespace: MemoryNamespace
    attribution: MemoryMutationAttribution
}

structure SuppressNamespaceOutput {}

structure UnsuppressNamespaceParams {
    namespace: MemoryNamespace
    attribution: MemoryMutationAttribution
}

structure UnsuppressNamespaceOutput {}

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
    /// Drop vector candidates whose distance exceeds this value before RRF (omit = no cutoff).
    maxVectorDistance: Double
    /// Select `knn` or `ann`; omit = ANN if available else KNN. Unsupported selection is a noop.
    vectorSearchMethod: VectorSearchMethod
}

enum SearchScopeMode {
    @enumValue("pathSubtree")
    PATH_SUBTREE

    @enumValue("scopeDag")
    SCOPE_DAG

    @enumValue("exactScope")
    EXACT_SCOPE
}

/// Bounds on `memories._ts_created` for hybrid search membership filtering.
/// Not provenance-tip replay — indexed features are read from the current store.
/// For lexical content at a tip, use `GetMemoryContentAtRootHex`.
structure SearchAsOf {
    /// `_ts_created > gt` on the **memory row** (first upsert time; preserved across merges).
    gt: Long
    /// `_ts_created >= gte`
    gte: Long
    /// `_ts_created < lt`
    lt: Long
    /// `_ts_created <= lte`
    lte: Long
}

structure SearchParams {
    namespace: MemoryNamespace
    additionalNamespaces: MemoryNamespaceList
    searchEntireDatabase: Boolean
    /// How `namespace` + `additionalNamespaces` are interpreted when not searching the entire DB. Default `pathSubtree`.
    searchScopeMode: SearchScopeMode
    content: SearchContent
    options: SearchOptions
    /// Bounds on `memories._ts_created` (`gt` / `gte` / `lt` / `lte`). Requires `asOfTimestampMsSearch`.
    /// Membership filter only — does not replay indexed features at a provenance tip.
    asOf: SearchAsOf
}

structure SearchOutput {
    hits: SearchHitList
    /// Vector method that ran (`knn` or `ann`); omit when the vector arm did not run.
    vectorSearchMethod: VectorSearchMethod
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

// --- Persistence: shared op context + provenance events ---

structure ContributorAttestation {
    /// Schema version; TS requires literal `1`.
    v: Integer
    format: String
    principal: String
    payload: String
    signature: String
    alg: String
    keyId: String
}

structure MemoryOpContext {
    now: Long
    contributor: ContributorAttestation
    intentSnapshotId: String
}

/// Provenance event stored as canonical JSON in `memory_provenance.event_json`.
union MemoryProvenanceEvent {
    MERGE_MEMORY: MergeMemoryProvenanceEvent
    DELETE_MEMORY: DeleteMemoryProvenanceEvent
    SUPPRESS_MEMORY: SuppressMemoryProvenanceEvent
    UNSUPPRESS_MEMORY: UnsuppressMemoryProvenanceEvent
    RENAME_NAMESPACE: RenameNamespaceProvenanceEvent
    SUPPRESS_NAMESPACE: SuppressNamespaceProvenanceEvent
    UNSUPPRESS_NAMESPACE: UnsuppressNamespaceProvenanceEvent
}

structure MergeMemoryProvenanceEvent {
    /// Schema version; TS requires literal `1`.
    v: Integer
    namespace: String
    memory_key: String
    memory_id: String
    source_keys: StringList
    /// Map of source_key → content_hash hex (when body digests were computed).
    content_hashes: StringStringMap
    contributor: ContributorAttestation
    intent_snapshot_id: String
}

structure DeleteMemoryProvenanceEvent {
    /// Schema version; TS requires literal `1`.
    v: Integer
    namespace: String
    memory_key: String
    memory_id: String
    contributor: ContributorAttestation
    intent_snapshot_id: String
}

structure SuppressMemoryProvenanceEvent {
    /// Schema version; TS requires literal `1`.
    v: Integer
    namespace: String
    memory_key: String
    memory_id: String
    contributor: ContributorAttestation
    intent_snapshot_id: String
}

structure UnsuppressMemoryProvenanceEvent {
    /// Schema version; TS requires literal `1`.
    v: Integer
    namespace: String
    memory_key: String
    memory_id: String
    contributor: ContributorAttestation
    intent_snapshot_id: String
}

structure RenameNamespaceProvenanceEvent {
    /// Schema version; TS requires literal `1`.
    v: Integer
    from_namespace: String
    to_namespace: String
    recursive: Boolean
    contributor: ContributorAttestation
    intent_snapshot_id: String
}

structure SuppressNamespaceProvenanceEvent {
    /// Schema version; TS requires literal `1`.
    v: Integer
    namespace: String
    contributor: ContributorAttestation
    intent_snapshot_id: String
}

structure UnsuppressNamespaceProvenanceEvent {
    /// Schema version; TS requires literal `1`.
    v: Integer
    namespace: String
    contributor: ContributorAttestation
    intent_snapshot_id: String
}

map StringStringMap {
    key: String
    value: String
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
