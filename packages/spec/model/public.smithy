$version: "2"

namespace khora.memories

@documentation("""
Logical client API: validates content and ontology at the app layer, then drives persistence.
Label kinds are opaque strings here (Zod / closed enums live in app packages).

Merge returns stable memory ids touched by the operation (primary + neighbors whose search-meta was synced).
Attribution (`contributor` / `intentSnapshotId`) is optional on merge, delete, replace-feature, suppress, and unsuppress and feeds provenance.
""")
service MemoriesPublic {
    version: "2026-07-21"
    operations: [
        MergeMemory
        Search
        DeleteMemory
        ReplaceMemoryFeature
        SuppressMemory
        UnsuppressMemory
        SuppressNamespace
        UnsuppressNamespace
    ]
}

operation MergeMemory {
    input: MergeMemoryParams
    output: MergeMemoryOutput
}

operation Search {
    input: SearchParams
    output: SearchOutput
}

operation DeleteMemory {
    input: DeleteMemoryParams
    output: DeleteMemoryOutput
}

operation ReplaceMemoryFeature {
    input: ReplaceMemoryFeatureParams
    output: ReplaceMemoryFeatureOutput
}

operation SuppressMemory {
    input: SuppressMemoryParams
    output: SuppressMemoryOutput
}

operation UnsuppressMemory {
    input: UnsuppressMemoryParams
    output: UnsuppressMemoryOutput
}

operation SuppressNamespace {
    input: SuppressNamespaceParams
    output: SuppressNamespaceOutput
}

operation UnsuppressNamespace {
    input: UnsuppressNamespaceParams
    output: UnsuppressNamespaceOutput
}
