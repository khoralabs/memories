import type { Migration } from "@khoralabs/sqlite-migrate";
import { MEMORIES_SCHEMA_SQL } from "../../schema";
import { TEXT_FEATURES_FTS_SQL } from "../../search-indexes";

const MEMORIES_INDEXES_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_node_label_assignments_node_label
  ON node_label_assignments (node_id, label_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_edge_label_assignments_edge_label
  ON edge_label_assignments (edge_id, label_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_provenance_root_hex
  ON memory_provenance (root_hex);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_edge_id_unique
  ON memories (edge_id) WHERE edge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memories_ns_prefixes
  ON memories (ns_prefix_1, ns_prefix_2, ns_prefix_3, ns_prefix_4, ns_prefix_5, ns_prefix_6);
`;

export default {
  from: "0.0.0",
  to: "0.1.0",
  name: "001-initial",
  up(db) {
    db.run(MEMORIES_SCHEMA_SQL);
    db.run(MEMORIES_INDEXES_SQL);
    db.run(TEXT_FEATURES_FTS_SQL);
  },
} satisfies Migration;
