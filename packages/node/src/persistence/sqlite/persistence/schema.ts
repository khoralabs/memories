/** SQLite DDL for the memories reference store. On-disk shape changes ship as new migrations. */
export const MEMORIES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS "edge_labels" (
  "kind" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "schema" TEXT,
  "_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS "memory_provenance" (
  "parent_root_hex" TEXT NOT NULL,
  "root_hex" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "event_json" TEXT NOT NULL,
  "intent_snapshot_id" TEXT,
  "_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS "node_labels" (
  "kind" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "schema" TEXT,
  "_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS "nodes" (
  "memory_id" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "properties" TEXT,
  "_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS "scopes" (
  "_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS "edges" (
  "from_node_id" TEXT NOT NULL REFERENCES "nodes" ("_id") ON DELETE CASCADE,
  "to_node_id" TEXT NOT NULL REFERENCES "nodes" ("_id") ON DELETE CASCADE,
  "properties" TEXT,
  "_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS "memories" (
  "namespace" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "edge_id" TEXT REFERENCES "edges" ("_id") ON DELETE CASCADE,
  "_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS "memory_scopes" (
  "memory_id" TEXT NOT NULL REFERENCES "memories" ("_id") ON DELETE CASCADE,
  "scope_id" TEXT NOT NULL REFERENCES "scopes" ("_id") ON DELETE CASCADE,
  "_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS "node_label_assignments" (
  "node_id" TEXT NOT NULL REFERENCES "nodes" ("_id") ON DELETE CASCADE,
  "label_id" TEXT NOT NULL REFERENCES "node_labels" ("_id") ON DELETE CASCADE,
  "props" TEXT NOT NULL,
  "_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS "scope_closure" (
  "ancestor_scope_id" TEXT NOT NULL REFERENCES "scopes" ("_id") ON DELETE CASCADE,
  "descendant_scope_id" TEXT NOT NULL REFERENCES "scopes" ("_id") ON DELETE CASCADE,
  "_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS "scope_edges" (
  "parent_scope_id" TEXT NOT NULL REFERENCES "scopes" ("_id") ON DELETE CASCADE,
  "child_scope_id" TEXT NOT NULL REFERENCES "scopes" ("_id") ON DELETE CASCADE,
  "_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS "source_maps" (
  "memory_id" TEXT NOT NULL REFERENCES "memories" ("_id") ON DELETE CASCADE,
  "source_key" TEXT NOT NULL,
  "content_hash" TEXT,
  "_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS "text_features" (
  "memory_id" TEXT NOT NULL REFERENCES "memories" ("_id") ON DELETE CASCADE,
  "source_map_id" TEXT NOT NULL REFERENCES "source_maps" ("_id") ON DELETE CASCADE,
  "text" TEXT NOT NULL,
  "_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS "vector_features" (
  "memory_id" TEXT NOT NULL REFERENCES "memories" ("_id") ON DELETE CASCADE,
  "source_map_id" TEXT NOT NULL REFERENCES "source_maps" ("_id") ON DELETE CASCADE,
  "vector" BLOB NOT NULL,
  "_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS "edge_label_assignments" (
  "edge_id" TEXT NOT NULL REFERENCES "edges" ("_id") ON DELETE CASCADE,
  "label_id" TEXT NOT NULL REFERENCES "edge_labels" ("_id") ON DELETE CASCADE,
  "props" TEXT NOT NULL,
  "_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_edge_label_assignments_edge_id" ON "edge_label_assignments" ("edge_id");

CREATE INDEX IF NOT EXISTS "idx_edge_label_assignments_label_id" ON "edge_label_assignments" ("label_id");

CREATE INDEX IF NOT EXISTS "idx_edges_from_node_id" ON "edges" ("from_node_id");

CREATE INDEX IF NOT EXISTS "idx_edges_to_node_id" ON "edges" ("to_node_id");

CREATE INDEX IF NOT EXISTS "idx_memories_edge_id" ON "memories" ("edge_id");

CREATE INDEX IF NOT EXISTS "idx_memories_namespace" ON "memories" ("namespace");

CREATE INDEX IF NOT EXISTS "idx_memory_scopes_memory_id" ON "memory_scopes" ("memory_id");

CREATE INDEX IF NOT EXISTS "idx_memory_scopes_scope_id" ON "memory_scopes" ("scope_id");

CREATE INDEX IF NOT EXISTS "idx_node_label_assignments_node_id" ON "node_label_assignments" ("node_id");

CREATE INDEX IF NOT EXISTS "idx_node_label_assignments_label_id" ON "node_label_assignments" ("label_id");

CREATE INDEX IF NOT EXISTS "idx_scope_closure_ancestor_scope_id" ON "scope_closure" ("ancestor_scope_id");

CREATE INDEX IF NOT EXISTS "idx_scope_closure_descendant_scope_id" ON "scope_closure" ("descendant_scope_id");

CREATE INDEX IF NOT EXISTS "idx_scope_edges_parent_scope_id" ON "scope_edges" ("parent_scope_id");

CREATE INDEX IF NOT EXISTS "idx_scope_edges_child_scope_id" ON "scope_edges" ("child_scope_id");

CREATE INDEX IF NOT EXISTS "idx_source_maps_memory_id" ON "source_maps" ("memory_id");

CREATE INDEX IF NOT EXISTS "idx_text_features_memory_id" ON "text_features" ("memory_id");

CREATE INDEX IF NOT EXISTS "idx_text_features_source_map_id" ON "text_features" ("source_map_id");

CREATE INDEX IF NOT EXISTS "idx_vector_features_memory_id" ON "vector_features" ("memory_id");

CREATE INDEX IF NOT EXISTS "idx_vector_features_source_map_id" ON "vector_features" ("source_map_id");
`;
