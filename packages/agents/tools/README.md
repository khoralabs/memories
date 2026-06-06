# @khoralabs/memories-tools

Shared **hybrid memory search** toolkit for `@khoralabs/agent-capabilities` composables: `memory_search` (FTS + embedding, RRF fusion), query embedding helpers, and `ToolkitContext` / `ToolRuntimeContext` builders.

**Logging**

- Phases: `memories.toolkit.toolCall`, `memories.toolkit.memory_search`, `memories.embed.textChunks`.
- Full tool input bodies in logs: set `MEMORIES_LOG_TOOL_BODIES=1`.

**Embedding model**

- `EmbeddingModel` is a minimal readonly shape for `embedMany`; callers typically build models via `createMemoriesEmbeddingModel` from `@khoralabs/memories-core/helpers` — values are structurally compatible with this interface.
