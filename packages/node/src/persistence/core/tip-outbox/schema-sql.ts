export const TIP_OUTBOX_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS "memory_tip_outbox" (
  "_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL,
  "root_hex" TEXT NOT NULL,
  "facet" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "namespace" TEXT NOT NULL DEFAULT '',
  "memory_key" TEXT NOT NULL DEFAULT '',
  "source_key" TEXT,
  "edge_id" TEXT,
  "payload_sha256" TEXT
);
CREATE INDEX IF NOT EXISTS "idx_memory_tip_outbox_root_hex"
  ON "memory_tip_outbox" ("root_hex");
CREATE INDEX IF NOT EXISTS "idx_memory_tip_outbox_facet_root"
  ON "memory_tip_outbox" ("facet", "root_hex");
CREATE INDEX IF NOT EXISTS "idx_memory_tip_outbox_ns_key_source"
  ON "memory_tip_outbox" ("namespace", "memory_key", "source_key");
CREATE INDEX IF NOT EXISTS "idx_memory_tip_outbox_payload_sha256"
  ON "memory_tip_outbox" ("payload_sha256");
`.trim();

export const TIP_BLOBS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS "memory_tip_blobs" (
  "content_sha256" TEXT PRIMARY KEY NOT NULL,
  "payload" BLOB,
  "location" TEXT NOT NULL DEFAULT 'hot',
  "cold_uri" TEXT,
  "_ts_created" REAL NOT NULL
);
`.trim();

/** One-shot copy from legacy content outbox tables (idempotent). */
export const MIGRATE_CONTENT_TO_TIP_OUTBOX_SQL = `
INSERT OR IGNORE INTO memory_tip_outbox
  (_id, _ts_created, root_hex, facet, event_type, namespace, memory_key, source_key, edge_id, payload_sha256)
SELECT
  _id,
  _ts_created,
  root_hex,
  'content',
  event_type,
  namespace,
  memory_key,
  source_key,
  NULL,
  content_sha256
FROM memory_content_outbox;

INSERT OR IGNORE INTO memory_tip_blobs
  (content_sha256, payload, location, cold_uri, _ts_created)
SELECT
  content_sha256,
  CASE WHEN text IS NOT NULL THEN CAST(text AS BLOB) ELSE NULL END,
  location,
  cold_uri,
  _ts_created
FROM memory_content_blobs;
`.trim();
