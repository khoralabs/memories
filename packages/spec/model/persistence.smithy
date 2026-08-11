$version: "2"

namespace khora.memories

use smithy.api#Document
use smithy.api#Unit

@documentation("""
Lexical mutation + catalog + edges + search-meta (text path) + lexical retrieval + hydrate.
Minimum profile for a lexical-only backend: typically **Core** + **MemoriesPersistenceReads**.
""")
service MemoriesPersistenceCore {
    version: "2026-07-21"
    operations: [
        WithTransaction
        ListNeighborMemoriesForNode
        ClearMemorySubtree
        UpsertMemory
        UpsertNodeForMemoryKey
        LoadMemoryNamespaceKey
        UpsertScope
        LinkScopes
        UnlinkScopeEdge
        ReplaceMemoryScopes
        ListScopesForMemory
        UpsertNamespaceMetadata
        DeleteNamespaceMetadata
        RenameNamespacePaths
        InsertSourceMap
        InsertLexicalFeature
        EnsureNodeLabel
        InsertNodeLabelAssignment
        FindMemoryIdByKey
        FindMemoryAssociation
        NodeExists
        InsertEdge
        EnsureEdgeLabel
        InsertEdgeLabelAssignment
        SyncMemorySearchMeta
        BuildCanonicalMemorySearchMetaText
        DeleteMemoryRootRows
        GetProvenanceHeadRootHex
        AppendProvenanceEvent
        AppendContentOutbox
        UpdateSourceMapContentHash
        SearchLexicalSourceMapIds
        HydrateSourceMapHits
    ]
}

@documentation("""
Vector features, hybrid meta vector upsert, vector search, and embedding-dimension introspection.
Omit entire module when `vectorSearch` is `false`.
""")
service MemoriesPersistenceVector {
    version: "2026-07-21"
    operations: [
        InsertVectorFeature
        UpsertMemorySearchMetaVector
        SearchVectorSourceMapIds
        ListVectorEmbeddingIndexDimensions
    ]
}

@documentation("""
Neighbor listing for search expansion and filters. Omit when `neighborIndex` is `false`.
""")
service MemoriesPersistenceNeighbors {
    version: "2026-07-21"
    operations: [
        ListNeighborsForMemory
        ListNeighborsForEdgeMemory
    ]
}

@documentation("""
Label-props lexical chunks for ontology props search. Optional; omit if unsupported.
""")
service MemoriesPersistenceLabelProps {
    version: "2026-07-21"
    operations: [
        SyncLabelPropsSearchFeatures
    ]
}

@documentation("""
Prefetch and export reads (not required for minimal in-process stores, but common for tooling).
""")
service MemoriesPersistenceReads {
    version: "2026-07-21"
    operations: [
        ListMemoryNamespaces
        ListNamespacesWithMetadata
        GetNamespaceMetadata
        ListMemoryKeysInNamespace
        ListSourceMapsForMemory
        ListTextFeatureExportRowsForMemory
        GetSourceMapTextPreview
        GetProvenanceTimestampMsForRootHex
        ListProvenanceEvents
        ListProvenanceChain
        GetMemoryContentAtRootHex
    ]
}

@documentation("""
**Full persistence surface:** union of **MemoriesPersistenceCore**, **MemoriesPersistenceVector**,
**MemoriesPersistenceNeighbors**, **MemoriesPersistenceLabelProps**, and **MemoriesPersistenceReads**
(same operation shapes). Operation order is stable for diff-friendly specs. Use this service id for
“full adapter” or codegen that expect a single aggregate.

**Capability modules:** Implementors may conform to a subset; see the module services above. Hosts expose
optional **MemoriesBackendCapabilities** alongside operations (not modeled as RPC). TypeScript interfaces:
`MemoriesPersistence` (and capability slices) in `@khoralabs/memories-node`; public API in `@khoralabs/memories-node`.

**Capability matrix (modules ↔ `MemoriesBackendCapabilities`):**
- **MemoriesPersistenceCore** — baseline for merge/delete + lexical search + hydrate.
- **MemoriesPersistenceVector** — omit when `vectorSearch` is `false`.
- **MemoriesPersistenceNeighbors** — omit when `neighborIndex` is `false`.
- **Graph topology reads** (`MemoriesGraphIndex` in TS on `MemoriesPersistence`) — **LoadGraphEdgesForNamespace**, **LoadNodeLabelsForNamespace**, **LoadNodePropertiesForNamespace**, **ListIncidentGraphEdges**, **LoadNodeLabelsForMemory**, **LoadNodePropertiesForMemory**, **LoadGraphEdge**, **LoadGraphNode** — omit when `graphIndex` is `false`.
- **MemoriesPersistenceLabelProps** — optional (`syncLabelPropsSearchFeatures?` in TS).
- **MemoriesPersistenceReads** — prefetch/export; commonly implemented with Core.
- **AppendContentOutbox** / **GetProvenanceTimestampMsForRootHex** / **ListProvenanceEvents** / **ListProvenanceChain** / **GetMemoryContentAtRootHex** — optional methods in TS (`?`).

`multiNamespaceSearch`, `unscopedSearch`, and `asOfTimestampMsSearch` constrain search **behavior**, not operation membership.

**Transactions:** Prefer one outer transaction per merge/delete. Nesting depends on the driver.

**clearMemorySubtree** vs **DeleteMemoryRootRows:** subtree clear removes dependents while roots may remain until root delete. Both take a **node** vs **edge** discriminant (`memoryKind`). Delete is idempotent if already absent.

**Search-meta:** reserved `source_key` for hybrid meta chunk; **SyncMemorySearchMeta** rebuilds canonical text and optional vector.

**Label-props chunks (optional):** reserved `__mem_nl_props__*` / `__mem_edge_props__*` keys; **SyncLabelPropsSearchFeatures** runs after meta sync for invalidated keys when implemented.

**Async:** Mirror with Promise/async method signatures in language bindings.

**Read helpers:** **ListMemoryNamespaces**, **ListNamespacesWithMetadata**, **GetNamespaceMetadata**, **ListSourceMapsForMemory**, **ListTextFeatureExportRowsForMemory**, **GetSourceMapTextPreview**. **ListVectorEmbeddingIndexDimensions** returns empty when dimension metadata is unavailable or not applicable.

**Provenance + source-map digests:** **GetProvenanceHeadRootHex**, **AppendProvenanceEvent** (returns new `rootHex`), optional **AppendContentOutbox**, **GetProvenanceTimestampMsForRootHex**, **ListProvenanceEvents**, **ListProvenanceChain**, **GetMemoryContentAtRootHex**, and **UpdateSourceMapContentHash** back the linear SHA-256 mutation log (`memory_provenance`, merge + delete + suppress/unsuppress + rename) and nullable **`source_maps.content_hash`** body commitments. Event shapes are **MemoryProvenanceEvent** (`MERGE_MEMORY` / `DELETE_MEMORY` / `SUPPRESS_MEMORY` / `UNSUPPRESS_MEMORY` / `RENAME_NAMESPACE`). Normative hashing lives in `@khoralabs/memories-node/provenance` (see SQLite implementors guide). Content-at-root is per-arm LWW (not a full tip snapshot); cold-evacuated bodies are resolved when a cold store is configured.
""")
service MemoriesPersistenceService {
    version: "2026-07-21"
    operations: [
        WithTransaction
        ListNeighborMemoriesForNode
        ClearMemorySubtree
        UpsertMemory
        UpsertNodeForMemoryKey
        LoadMemoryNamespaceKey
        UpsertScope
        LinkScopes
        UnlinkScopeEdge
        ReplaceMemoryScopes
        ListScopesForMemory
        UpsertNamespaceMetadata
        DeleteNamespaceMetadata
        RenameNamespacePaths
        InsertSourceMap
        InsertLexicalFeature
        InsertVectorFeature
        EnsureNodeLabel
        InsertNodeLabelAssignment
        FindMemoryIdByKey
        FindMemoryAssociation
        NodeExists
        InsertEdge
        EnsureEdgeLabel
        InsertEdgeLabelAssignment
        SyncMemorySearchMeta
        SyncLabelPropsSearchFeatures
        BuildCanonicalMemorySearchMetaText
        UpsertMemorySearchMetaVector
        DeleteMemoryRootRows
        GetProvenanceHeadRootHex
        AppendProvenanceEvent
        AppendContentOutbox
        UpdateSourceMapContentHash
        SearchLexicalSourceMapIds
        SearchVectorSourceMapIds
        HydrateSourceMapHits
        ListNeighborsForMemory
        ListNeighborsForEdgeMemory
        ListMemoryNamespaces
        ListNamespacesWithMetadata
        GetNamespaceMetadata
        ListMemoryKeysInNamespace
        ListSourceMapsForMemory
        ListTextFeatureExportRowsForMemory
        GetSourceMapTextPreview
        GetProvenanceTimestampMsForRootHex
        ListProvenanceEvents
        ListProvenanceChain
        GetMemoryContentAtRootHex
        ListVectorEmbeddingIndexDimensions
        LoadGraphEdgesForNamespace
        LoadNodeLabelsForNamespace
        LoadNodePropertiesForNamespace
        ListIncidentGraphEdges
        LoadNodeLabelsForMemory
        LoadNodePropertiesForMemory
        LoadGraphEdge
        LoadGraphNode
    ]
}

@documentation("""
Host-native: run callback body in one ACID transaction; commit on success, rollback on error.
Not a serializable wire operation in v1.

In-process adapters implement this with their driver’s transaction primitive.
""")
operation WithTransaction {
    input: WithTransactionInput
    output: WithTransactionOutput
}

structure WithTransactionInput {}

structure WithTransactionOutput {
    committed: Boolean
}

structure NeighborMemoryRef {
    namespace: MemoryNamespace
    key: String
}

list NeighborMemoryRefList {
    member: NeighborMemoryRef
}

operation ListNeighborMemoriesForNode {
    input: ListNeighborMemoriesForNodeInput
    output: ListNeighborMemoriesForNodeOutput
}

structure ListNeighborMemoriesForNodeInput {
    op: MemoryOpContext
    namespace: MemoryNamespace
    nodeId: String
}

structure ListNeighborMemoriesForNodeOutput {
    neighbors: NeighborMemoryRefList
}

operation ClearMemorySubtree {
    input: ClearMemorySubtreeInput
    output: ClearMemorySubtreeOutput
}

/// Discriminated target: node (clears incident edges) vs edge (clears features; keeps edges row for replace).
union ClearMemorySubtreeTarget {
    node: ClearMemorySubtreeNodeTarget
    edge: ClearMemorySubtreeEdgeTarget
}

structure ClearMemorySubtreeNodeTarget {
    memoryId: String
    nodeId: String
}

structure ClearMemorySubtreeEdgeTarget {
    memoryId: String
    edgeId: String
}

structure ClearMemorySubtreeInput {
    op: MemoryOpContext
    target: ClearMemorySubtreeTarget
}

structure ClearMemorySubtreeOutput {}

operation UpsertMemory {
    input: UpsertMemoryInput
    output: UpsertMemoryOutput
}

enum MemoryKind {
    @enumValue("node")
    NODE

    @enumValue("edge")
    EDGE
}

structure UpsertMemoryInput {
    op: MemoryOpContext
    namespace: MemoryNamespace
    key: String
    /// Defaults to `node` in storage when omitted.
    kind: MemoryKind
    /// Required when `kind` is `edge` after the graph edge exists.
    edgeId: String
}

structure UpsertMemoryOutput {
    memoryId: String
    _ts_created: Long
}

operation UpsertNodeForMemoryKey {
    input: UpsertNodeForMemoryKeyInput
    output: UpsertNodeForMemoryKeyOutput
}

structure UpsertNodeForMemoryKeyInput {
    op: MemoryOpContext
    namespace: MemoryNamespace
    memoryKey: String
    memoryId: String
    properties: Document
}

structure UpsertNodeForMemoryKeyOutput {
    nodeId: String
}

operation LoadMemoryNamespaceKey {
    input: LoadMemoryNamespaceKeyInput
    output: LoadMemoryNamespaceKeyOutput
}

structure LoadMemoryNamespaceKeyInput {
    memoryId: String
}

structure LoadMemoryNamespaceKeyOutput {
    namespace: MemoryNamespace
    key: String
}

operation UpsertScope {
    input: UpsertScopeInput
    output: UpsertScopeOutput
}

structure UpsertScopeInput {
    op: MemoryOpContext
    scopeId: MemoryNamespace
}

structure UpsertScopeOutput {}

operation UpsertNamespaceMetadata {
    input: UpsertNamespaceMetadataInput
    output: UpsertNamespaceMetadataOutput
}

structure UpsertNamespaceMetadataInput {
    @required
    namespace: MemoryNamespace
    /// Soft-rename label. Pass null to clear (UI uses key). Omit on update to leave unchanged.
    /// Wire field is `alias` (DB column remains `display_name`).
    alias: String
    description: String
}

structure UpsertNamespaceMetadataOutput {}

operation DeleteNamespaceMetadata {
    input: DeleteNamespaceMetadataInput
    output: DeleteNamespaceMetadataOutput
}

structure DeleteNamespaceMetadataInput {
    @required
    namespace: MemoryNamespace
}

structure DeleteNamespaceMetadataOutput {}

operation RenameNamespacePaths {
    input: RenameNamespacePathsInput
    output: RenameNamespacePathsOutput
}

structure RenameNamespacePathsInput {
    op: MemoryOpContext
    /// JSON object map of old namespace path → new namespace path.
    nsMapJson: String
}

structure RenameNamespacePathsOutput {
    renamedMemories: Integer
}

operation LinkScopes {
    input: LinkScopesInput
    output: LinkScopesOutput
}

structure LinkScopesInput {
    op: MemoryOpContext
    parentScopeId: MemoryNamespace
    childScopeId: MemoryNamespace
}

structure LinkScopesOutput {}

operation UnlinkScopeEdge {
    input: UnlinkScopeEdgeInput
    output: UnlinkScopeEdgeOutput
}

structure UnlinkScopeEdgeInput {
    op: MemoryOpContext
    parentScopeId: MemoryNamespace
    childScopeId: MemoryNamespace
}

structure UnlinkScopeEdgeOutput {}

operation ReplaceMemoryScopes {
    input: ReplaceMemoryScopesInput
    output: ReplaceMemoryScopesOutput
}

structure ReplaceMemoryScopesInput {
    op: MemoryOpContext
    memoryId: String
    scopeIds: MemoryNamespaceList
}

structure ReplaceMemoryScopesOutput {}

operation ListScopesForMemory {
    input: ListScopesForMemoryInput
    output: ListScopesForMemoryOutput
}

structure ListScopesForMemoryInput {
    memoryId: String
}

structure ListScopesForMemoryOutput {
    scopes: MemoryNamespaceList
}

operation InsertSourceMap {
    input: InsertSourceMapInput
    output: InsertSourceMapOutput
}

structure InsertSourceMapInput {
    op: MemoryOpContext
    memoryId: String
    sourceKey: String
}

structure InsertSourceMapOutput {
    sourceMapId: String
}

@documentation("""
Attach searchable text for lexical retrieval on the source map.
""")
operation InsertLexicalFeature {
    input: InsertLexicalFeatureInput
    output: InsertLexicalFeatureOutput
}

structure InsertLexicalFeatureInput {
    op: MemoryOpContext
    memoryId: String
    sourceMapId: String
    text: String
}

structure InsertLexicalFeatureOutput {
    textFeatureId: String
}

@documentation("""
Attach an embedding vector and index it for similarity search (dimension must match query vectors).
""")
operation InsertVectorFeature {
    input: InsertVectorFeatureInput
    output: InsertVectorFeatureOutput
}

structure InsertVectorFeatureInput {
    op: MemoryOpContext
    memoryId: String
    sourceMapId: String
    vector: DoubleList
}

structure InsertVectorFeatureOutput {
    vectorFeatureId: String
}

operation EnsureNodeLabel {
    input: EnsureNodeLabelInput
    output: EnsureNodeLabelOutput
}

structure EnsureNodeLabelInput {
    op: MemoryOpContext
    kind: String
    description: String
    /// Serialized JSON Schema (Draft 2020-12) for assignment `props`, or empty when unset.
    schemaJson: String
}

structure EnsureNodeLabelOutput {
    labelId: String
}

operation InsertNodeLabelAssignment {
    input: InsertNodeLabelAssignmentInput
    output: InsertNodeLabelAssignmentOutput
}

structure InsertNodeLabelAssignmentInput {
    op: MemoryOpContext
    nodeId: String
    labelId: String
    props: Document
}

structure InsertNodeLabelAssignmentOutput {}

operation FindMemoryIdByKey {
    input: FindMemoryIdByKeyInput
    output: FindMemoryIdByKeyOutput
}

structure FindMemoryIdByKeyInput {
    namespace: MemoryNamespace
    key: String
}

structure FindMemoryIdByKeyOutput {
    memoryId: String
}

@documentation("""
Resolve graph association for a logical key (`undefined` / omitted output when no memory row).
Node memories infer `nodeId`; edge memories require stored `edge_id`.
""")
operation FindMemoryAssociation {
    input: FindMemoryAssociationInput
    output: FindMemoryAssociationOutput
}

structure FindMemoryAssociationInput {
    namespace: MemoryNamespace
    key: String
}

union MemoryAssociation {
    node: MemoryAssociationNode
    edge: MemoryAssociationEdge
}

structure MemoryAssociationNode {
    memoryId: String
    nodeId: String
}

structure MemoryAssociationEdge {
    memoryId: String
    edgeId: String
}

structure FindMemoryAssociationOutput {
    /// Omitted when no memory exists for the key.
    association: MemoryAssociation
}

operation NodeExists {
    input: NodeExistsInput
    output: NodeExistsOutput
}

structure NodeExistsInput {
    nodeId: String
}

structure NodeExistsOutput {
    exists: Boolean
}

operation InsertEdge {
    input: InsertEdgeInput
    output: InsertEdgeOutput
}

structure InsertEdgeInput {
    op: MemoryOpContext
    fromNodeId: String
    toNodeId: String
    properties: Document
    idParts: InsertEdgeIdParts
}

structure InsertEdgeOutput {
    edgeId: String
}

operation EnsureEdgeLabel {
    input: EnsureEdgeLabelInput
    output: EnsureEdgeLabelOutput
}

structure EnsureEdgeLabelInput {
    op: MemoryOpContext
    kind: String
    description: String
    schemaJson: String
}

structure EnsureEdgeLabelOutput {
    labelId: String
}

operation InsertEdgeLabelAssignment {
    input: InsertEdgeLabelAssignmentInput
    output: InsertEdgeLabelAssignmentOutput
}

structure InsertEdgeLabelAssignmentInput {
    op: MemoryOpContext
    edgeId: String
    labelId: String
    props: Document
}

structure InsertEdgeLabelAssignmentOutput {}

operation SyncMemorySearchMeta {
    input: SyncMemorySearchMetaInput
    output: SyncMemorySearchMetaOutput
}

structure SyncMemorySearchMetaInput {
    op: MemoryOpContext
    namespace: MemoryNamespace
    memoryKey: String
    metaVector: DoubleList
}

structure SyncMemorySearchMetaOutput {}

@documentation("""
Optional on implementors (omit on backends that only support topology meta).

Remove prior label-props source_map rows for the memory, then insert fresh lexical chunks from ontology props.
""")
operation SyncLabelPropsSearchFeatures {
    input: SyncLabelPropsSearchFeaturesInput
    output: SyncLabelPropsSearchFeaturesOutput
}

structure SyncLabelPropsSearchFeaturesInput {
    op: MemoryOpContext
    namespace: MemoryNamespace
    memoryKey: String
}

structure SyncLabelPropsSearchFeaturesOutput {}

operation BuildCanonicalMemorySearchMetaText {
    input: BuildCanonicalMemorySearchMetaTextInput
    output: BuildCanonicalMemorySearchMetaTextOutput
}

structure BuildCanonicalMemorySearchMetaTextInput {
    op: MemoryOpContext
    namespace: MemoryNamespace
    memoryKey: String
}

structure BuildCanonicalMemorySearchMetaTextOutput {
    text: String
}

operation UpsertMemorySearchMetaVector {
    input: UpsertMemorySearchMetaVectorInput
    output: UpsertMemorySearchMetaVectorOutput
}

structure UpsertMemorySearchMetaVectorInput {
    op: MemoryOpContext
    namespace: MemoryNamespace
    memoryKey: String
    vector: DoubleList
}

structure UpsertMemorySearchMetaVectorOutput {}

operation DeleteMemoryRootRows {
    input: DeleteMemoryRootRowsInput
    output: DeleteMemoryRootRowsOutput
}

/// Node: delete memory + primary node. Edge: delete graph `edges` row (CASCADE removes memory + features).
union DeleteMemoryRootRowsTarget {
    node: DeleteMemoryRootRowsNodeTarget
    edge: DeleteMemoryRootRowsEdgeTarget
}

structure DeleteMemoryRootRowsNodeTarget {
    memoryId: String
    nodeId: String
}

structure DeleteMemoryRootRowsEdgeTarget {
    edgeId: String
}

structure DeleteMemoryRootRowsInput {
    target: DeleteMemoryRootRowsTarget
}

structure DeleteMemoryRootRowsOutput {}

@documentation("Returns rank-ordered source_map ids (best first); RRF consumes rank only, not scores.")
operation SearchLexicalSourceMapIds {
    input: SearchLexicalSourceMapIdsInput
    output: SearchLexicalSourceMapIdsOutput
}

structure SearchLexicalSourceMapIdsInput {
    scope: SearchNamespaceScope
    text: String
    limit: Integer
    memoryIds: StringList
    /// Bounds on `memories._ts_created` (backend-dependent).
    asOf: SearchAsOf
}

structure SearchLexicalSourceMapIdsOutput {
    sourceMapIds: StringList
}

@documentation("Returns rank-ordered source_map ids (best first).")
operation SearchVectorSourceMapIds {
    input: SearchVectorSourceMapIdsInput
    output: SearchVectorSourceMapIdsOutput
}

structure SearchVectorSourceMapIdsInput {
    scope: SearchNamespaceScope
    vector: DoubleList
    limit: Integer
    memoryIds: StringList
    /// Distance upper bound; omit = top-k without a distance cutoff.
    maxVectorDistance: Double
    /// Bounds on `memories._ts_created` (backend-dependent).
    asOf: SearchAsOf
    /// Resolved method from core (`knn` or `ann`). Unsupported → empty ids.
    method: VectorSearchMethod
}

structure SearchVectorSourceMapIdsOutput {
    sourceMapIds: StringList
    /// Method that ran; omit when noop (unsupported method).
    vectorSearchMethod: VectorSearchMethod
}

operation HydrateSourceMapHits {
    input: HydrateSourceMapHitsInput
    output: HydrateSourceMapHitsOutput
}

structure HydrateSourceMapHitsInput {
    sourceMapIds: StringList
}

structure HydrateSourceMapHitsOutput {
    hits: HydratedSourceMapHitList
}

operation ListNeighborsForMemory {
    input: ListNeighborsForMemoryInput
    output: ListNeighborsForMemoryOutput
}

structure ListNeighborsForMemoryInput {
    namespace: MemoryNamespace
    key: String
    filters: NeighborFilter
}

structure ListNeighborsForMemoryOutput {
    neighbors: HydratedNeighborList
}

@documentation("""
Endpoint node memories for a graph edge (neighbor expansion when the search root is an edge memory).
""")
operation ListNeighborsForEdgeMemory {
    input: ListNeighborsForEdgeMemoryInput
    output: ListNeighborsForEdgeMemoryOutput
}

structure ListNeighborsForEdgeMemoryInput {
    namespace: MemoryNamespace
    edgeId: String
    filters: NeighborFilter
}

structure ListNeighborsForEdgeMemoryOutput {
    neighbors: HydratedNeighborList
}

operation ListMemoryNamespaces {
    input: Unit
    output: ListMemoryNamespacesOutput
}

structure ListMemoryNamespacesOutput {
    /// Distinct primary memory namespaces, sorted for stable UI.
    namespaces: MemoryNamespaceList
}

operation ListNamespacesWithMetadata {
    input: Unit
    output: ListNamespacesWithMetadataOutput
}

structure ListNamespacesWithMetadataOutput {
    /// Union of namespaces with memories and/or metadata rows, sorted by path.
    namespaces: NamespaceMetadataList
}

operation GetNamespaceMetadata {
    input: GetNamespaceMetadataInput
    output: GetNamespaceMetadataOutput
}

structure GetNamespaceMetadataInput {
    @required
    namespace: MemoryNamespace
}

structure GetNamespaceMetadataOutput {
    metadata: NamespaceMetadata
}

operation ListMemoryKeysInNamespace {
    input: ListMemoryKeysInNamespaceInput
    output: ListMemoryKeysInNamespaceOutput
}

structure ListMemoryKeysInNamespaceInput {
    @required
    namespace: MemoryNamespace
}

structure ListMemoryKeysInNamespaceOutput {
    keys: StringList
}

operation ListSourceMapsForMemory {
    input: ListSourceMapsForMemoryInput
    output: ListSourceMapsForMemoryOutput
}

structure ListSourceMapsForMemoryInput {
    memoryId: String
    limit: Integer
}

structure ListSourceMapsForMemoryOutput {
    /// Most recent first (`_ts_created DESC`).
    sourceMaps: SourceMapRowList
}

operation ListTextFeatureExportRowsForMemory {
    input: ListTextFeatureExportRowsForMemoryInput
    output: ListTextFeatureExportRowsForMemoryOutput
}

structure ListTextFeatureExportRowsForMemoryInput {
    memoryId: String
}

structure ListTextFeatureExportRowsForMemoryOutput {
    rows: TextFeatureExportRowList
}

@documentation("Display text attached to one source map row, truncated to `maxChars` when supplied.")
operation GetSourceMapTextPreview {
    input: GetSourceMapTextPreviewInput
    output: GetSourceMapTextPreviewOutput
}

structure GetSourceMapTextPreviewInput {
    sourceMapId: String
    maxChars: Integer
}

structure GetSourceMapTextPreviewOutput {
    /// Omitted / null when no text is attached.
    text: String
}

@documentation("""
Timestamp (`memory_provenance._ts_created`) for a chain link `root_hex`, when known.
Optional on implementors (`getProvenanceTimestampMsForRootHex?` in TS).
""")
operation GetProvenanceTimestampMsForRootHex {
    input: GetProvenanceTimestampMsForRootHexInput
    output: GetProvenanceTimestampMsForRootHexOutput
}

structure GetProvenanceTimestampMsForRootHexInput {
    rootHex: String
}

structure GetProvenanceTimestampMsForRootHexOutput {
    /// Omitted when the root is unknown.
    timestampMs: Long
}

@documentation("""
Newest-first provenance events, optionally filtered by memory `namespace` / `memoryKey`
via `event_json`. `memoryKey` requires `namespace`. Implementations hard-cap `limit` (typical max 100).
Optional on implementors (`listProvenanceEvents?` in TS).
""")
operation ListProvenanceEvents {
    input: ListProvenanceEventsInput
    output: ListProvenanceEventsOutput
}

structure ListProvenanceEventsInput {
    namespace: String
    memoryKey: String
    limit: Integer
    beforeCreatedAt: Long
    beforeId: String
}

structure ProvenanceEventListItem {
    id: String
    rootHex: String
    parentRootHex: String
    eventType: String
    createdAt: Long
    event: MemoryProvenanceEvent
    intentSnapshotId: String
}

list ProvenanceEventListItemList {
    member: ProvenanceEventListItem
}

structure ListProvenanceEventsOutput {
    events: ProvenanceEventListItemList
}

@documentation("""
Newest-first chain tip links (no full event blob). Page older than `beforeRootHex` when set.
Implementations hard-cap `limit` (typical max 100).
Optional on implementors (`listProvenanceChain?` in TS).
""")
operation ListProvenanceChain {
    input: ListProvenanceChainInput
    output: ListProvenanceChainOutput
}

structure ListProvenanceChainInput {
    limit: Integer
    beforeRootHex: String
}

structure ProvenanceChainLink {
    rootHex: String
    parentRootHex: String
    eventType: String
    createdAt: Long
    id: String
}

list ProvenanceChainLinkList {
    member: ProvenanceChainLink
}

structure ListProvenanceChainOutput {
    links: ProvenanceChainLinkList
}

@documentation("""
Lexical source arms as of a provenance tip (per-arm LWW). Empty when tip unknown,
memory deleted at tip, or bodies unavailable (e.g. dropped without cold store).
Optional on implementors (`getMemoryContentAtRootHex?` in TS).
""")
operation GetMemoryContentAtRootHex {
    input: GetMemoryContentAtRootHexInput
    output: GetMemoryContentAtRootHexOutput
}

structure GetMemoryContentAtRootHexInput {
    rootHex: String
    namespace: String
    memoryKey: String
}

structure MemoryContentAtRootItem {
    sourceKey: String
    text: String
}

list MemoryContentAtRootItemList {
    member: MemoryContentAtRootItem
}

structure GetMemoryContentAtRootHexOutput {
    content: MemoryContentAtRootItemList
}

@documentation("""
Distinct embedding widths for vector indexes present in the store.
Return empty `dimensions` when there are no indexed vectors or the backend cannot report widths.
""")
operation ListVectorEmbeddingIndexDimensions {
    input: ListVectorEmbeddingIndexDimensionsInput
    output: ListVectorEmbeddingIndexDimensionsOutput
}

structure ListVectorEmbeddingIndexDimensionsInput {}

structure ListVectorEmbeddingIndexDimensionsOutput {
    dimensions: IntegerList
}

// --- Graph topology reads (`MemoriesGraphIndex` in TS); omit when `graphIndex` is false. ---

@documentation("All edges whose endpoint memories lie in `namespace`.")
operation LoadGraphEdgesForNamespace {
    input: LoadGraphEdgesForNamespaceInput
    output: LoadGraphEdgesForNamespaceOutput
}

structure LoadGraphEdgesForNamespaceInput {
    namespace: MemoryNamespace
}

structure LoadGraphEdgesForNamespaceOutput {
    edges: GraphEdgeLinkList
}

@documentation("Ontology node labels per memory key in a namespace (bulk).")
operation LoadNodeLabelsForNamespace {
    input: LoadNodeLabelsForNamespaceInput
    output: LoadNodeLabelsForNamespaceOutput
}

structure LoadNodeLabelsForNamespaceInput {
    namespace: MemoryNamespace
}

structure LoadNodeLabelsForNamespaceOutput {
    entries: MemoryKeyNodeLabelsEntryList
}

@documentation("Node JSON properties per memory key (bulk).")
operation LoadNodePropertiesForNamespace {
    input: LoadNodePropertiesForNamespaceInput
    output: LoadNodePropertiesForNamespaceOutput
}

structure LoadNodePropertiesForNamespaceInput {
    namespace: MemoryNamespace
}

structure LoadNodePropertiesForNamespaceOutput {
    entries: MemoryKeyNodePropertiesEntryList
}

@documentation("Edges incident to `memoryKey` within `namespace`.")
operation ListIncidentGraphEdges {
    input: ListIncidentGraphEdgesInput
    output: ListIncidentGraphEdgesOutput
}

structure ListIncidentGraphEdgesInput {
    namespace: MemoryNamespace
    memoryKey: String
}

structure ListIncidentGraphEdgesOutput {
    edges: GraphEdgeLinkList
}

@documentation("Ontology labels for a single memory’s graph node.")
operation LoadNodeLabelsForMemory {
    input: LoadNodeLabelsForMemoryInput
    output: LoadNodeLabelsForMemoryOutput
}

structure LoadNodeLabelsForMemoryInput {
    namespace: MemoryNamespace
    memoryKey: String
}

structure LoadNodeLabelsForMemoryOutput {
    labels: OntologyLabelInstanceList
}

union LoadNodePropertiesForMemoryResult {
    notFound: Unit
    properties: Document
}

@documentation("Parsed `nodes.properties` for one memory, or notFound when absent/unknown.")
operation LoadNodePropertiesForMemory {
    input: LoadNodePropertiesForMemoryInput
    output: LoadNodePropertiesForMemoryOutput
}

structure LoadNodePropertiesForMemoryInput {
    namespace: MemoryNamespace
    memoryKey: String
}

structure LoadNodePropertiesForMemoryOutput {
    result: LoadNodePropertiesForMemoryResult
}

union LoadGraphEdgeResult {
    notFound: Unit
    edge: GraphEdgeLink
}

@documentation("One edge by id within `namespace`, or notFound.")
operation LoadGraphEdge {
    input: LoadGraphEdgeInput
    output: LoadGraphEdgeOutput
}

structure LoadGraphEdgeInput {
    namespace: MemoryNamespace
    edgeId: String
}

structure LoadGraphEdgeOutput {
    result: LoadGraphEdgeResult
}

union LoadGraphNodeResult {
    notFound: Unit
    node: GraphNode
}

@documentation("Full graph node for one memory (labels + properties + ids), or notFound when no memory row exists.")
operation LoadGraphNode {
    input: LoadGraphNodeInput
    output: LoadGraphNodeOutput
}

structure LoadGraphNodeInput {
    namespace: MemoryNamespace
    memoryKey: String
}

structure LoadGraphNodeOutput {
    result: LoadGraphNodeResult
}

@documentation("""
Latest committed provenance chain head (`memory_provenance.root_hex`), or absent when the table is empty.
""")
operation GetProvenanceHeadRootHex {
    input: GetProvenanceHeadRootHexInput
    output: GetProvenanceHeadRootHexOutput
}

structure GetProvenanceHeadRootHexInput {}

structure GetProvenanceHeadRootHexOutput {
    rootHex: String
}

@documentation("""
Append one row advancing the linear chain. Must run inside **WithTransaction**. `event` is stored as canonical JSON in `memory_provenance.event_json`; implementations derive `root_hex` per `@khoralabs/memories-node/provenance`.
Returns the new chain head.
""")
operation AppendProvenanceEvent {
    input: AppendProvenanceEventInput
    output: AppendProvenanceEventOutput
}

structure AppendProvenanceEventInput {
    op: MemoryOpContext
    event: MemoryProvenanceEvent
}

structure AppendProvenanceEventOutput {
    rootHex: String
}

@documentation("""
Write raw content to the append-only outbox so point-in-time reconstruction is possible.
Must run in the same transaction as **AppendProvenanceEvent**, immediately after.
For `MERGE_MEMORY` pass one entry per user content item; for `DELETE_MEMORY` / `SUPPRESS_MEMORY` / `UNSUPPRESS_MEMORY` pass empty `entries`.
Optional on implementors (`appendContentOutbox?` in TS).
""")
operation AppendContentOutbox {
    input: AppendContentOutboxInput
    output: AppendContentOutboxOutput
}

enum ProvenanceEventType {
    @enumValue("MERGE_MEMORY")
    MERGE_MEMORY

    @enumValue("DELETE_MEMORY")
    DELETE_MEMORY

    @enumValue("SUPPRESS_MEMORY")
    SUPPRESS_MEMORY

    @enumValue("UNSUPPRESS_MEMORY")
    UNSUPPRESS_MEMORY

    @enumValue("RENAME_NAMESPACE")
    RENAME_NAMESPACE

    @enumValue("SUPPRESS_NAMESPACE")
    SUPPRESS_NAMESPACE

    @enumValue("UNSUPPRESS_NAMESPACE")
    UNSUPPRESS_NAMESPACE
}

structure ContentOutboxEntry {
    sourceKey: String
    text: String
}

list ContentOutboxEntryList {
    member: ContentOutboxEntry
}

structure AppendContentOutboxInput {
    op: MemoryOpContext
    rootHex: String
    eventType: ProvenanceEventType
    namespace: String
    memoryKey: String
    entries: ContentOutboxEntryList
}

structure AppendContentOutboxOutput {}

@documentation("""
Persist **content_hash** for one source map after lexical and/or vector features exist (`SHA-256(MEMORIES_SOURCE_BODY_v1 …)` over a canonical descriptor). Merge pipelines call this once per content item in the same transaction. `text` and `vector` are both optional (at least the parts that exist for that content item).
""")
operation UpdateSourceMapContentHash {
    input: UpdateSourceMapContentHashInput
    output: UpdateSourceMapContentHashOutput
}

structure UpdateSourceMapContentHashInput {
    op: MemoryOpContext
    sourceMapId: String
    text: String
    vector: DoubleList
}

structure UpdateSourceMapContentHashOutput {}
