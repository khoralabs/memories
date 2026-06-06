$version: "2"

namespace khora.memories

@documentation("""
Logical client API: validates content and ontology at the app layer, then drives persistence.
Label kinds are opaque strings here (Zod / closed enums live in app packages).

Merge returns keys whose search-meta lexical row was rebuilt.
""")
service MemoriesPublic {
    version: "2026-04-11"
    operations: [
        MergeMemory
        Search
        DeleteMemory
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
