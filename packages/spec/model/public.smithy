$version: "2"

namespace khora.memories

@documentation("""
Logical client API: validates content and ontology at the app layer, then drives persistence.
Label kinds are opaque strings here (Zod / closed enums live in app packages).

Merge returns stable memory ids touched by the operation (primary + neighbors whose search-meta was synced).
Attribution (`contributor` / `intentSnapshotId`) is optional on merge, delete, replace-feature, suppress,
unsuppress, rename-namespace, and delete-namespace and feeds provenance.

**TS binding:** `MergeMemoryParams` is a Smithy union (`node` / `edge`); TypeScript uses a `kind` discriminant
(`"node"` default / `"edge"`) on the same fields — see `@khoralabs/memories-node` `merge-memory.ts`.
""")
service MemoriesPublic {
    version: "2026-10-28"
    operations: [
        MergeMemory
        Search
        DeleteMemory
        ReplaceMemoryFeature
        SuppressMemory
        UnsuppressMemory
        SuppressNamespace
        UnsuppressNamespace
        RenameNamespace
        DeleteNamespace
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

operation RenameNamespace {
    input: RenameNamespaceParams
    output: RenameNamespaceOutput
}

operation DeleteNamespace {
    input: DeleteNamespaceParams
    output: DeleteNamespaceOutput
}
