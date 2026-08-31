import type { TursoClients } from "@khoralabs/memories-node/turso-serverless";
import {
  createMemoriesTursoServerlessPersistence,
  createTursoClients,
  getCurrentSchemaVersion,
  readQueryOne,
} from "@khoralabs/memories-node/turso-serverless";
import type {
  MemoriesDatabaseBackend,
  MemoriesDatabaseBackendFactory,
  MemoriesDatabaseBackendStrategy,
  MemoriesDatabaseHandle,
  TursoServerlessBackendStrategy,
} from "../../storage/core/index";
import { unsupportedStorageFeature } from "../../storage/core/index";
import { resolveTursoCredentials } from "./resolve-credentials";

/** Tables cleared by {@link deleteTursoPrincipalData}; order respects FK dependencies. */
const DELETE_TABLES_IN_ORDER = [
  "memory_tip_outbox",
  "memory_tip_blobs",
  "memory_provenance",
  "edge_label_assignments",
  "node_label_assignments",
  "text_features",
  "vector_features",
  "source_maps",
  "memory_scopes",
  "memories",
  "edges",
  "nodes",
  "edge_labels",
  "node_labels",
  "scope_closure",
  "scope_edges",
  "scopes",
] as const;

function assertTursoServerlessStrategy(
  strategy: MemoriesDatabaseBackendStrategy,
): TursoServerlessBackendStrategy {
  if (strategy.kind !== "turso-serverless") {
    throw new Error(`Expected turso-serverless strategy, got ${strategy.kind}`);
  }
  const turso = strategy as TursoServerlessBackendStrategy;
  if (typeof turso.url !== "string" || turso.url.trim().length === 0) {
    throw new Error("turso-serverless strategy requires non-empty url");
  }
  return turso;
}

async function deleteTursoPrincipalData(db: TursoClients): Promise<void> {
  for (const table of DELETE_TABLES_IN_ORDER) {
    await db.write.execute(`DELETE FROM "${table.replaceAll('"', '""')}"`);
  }
}

export type CreateTursoServerlessBackendOptions = {
  strategy: TursoServerlessBackendStrategy;
};

export function createTursoServerlessBackend(
  opts: CreateTursoServerlessBackendOptions,
): MemoriesDatabaseBackend {
  const strategy = assertTursoServerlessStrategy(opts.strategy);

  return {
    strategy,

    async open(id) {
      const credentials = resolveTursoCredentials(strategy, id);
      const db = createTursoClients(credentials);
      const persistence = await createMemoriesTursoServerlessPersistence({ ...credentials, db });

      let closed = false;
      const handle: MemoriesDatabaseHandle = {
        persistence,
        async close() {
          if (closed) return;
          closed = true;
          await db.read.close();
          await db.write.close();
        },
      };
      return handle;
    },

    async exists(id) {
      try {
        const credentials = resolveTursoCredentials(strategy, id);
        const db = createTursoClients(credentials);
        try {
          const version = await getCurrentSchemaVersion(db);
          if (version !== undefined) {
            return true;
          }
          const row = await readQueryOne<{ ok: number }>(
            db.read,
            `SELECT 1 AS ok FROM memories LIMIT 1`,
          );
          if (row !== undefined) {
            return true;
          }
          return false;
        } finally {
          await db.read.close();
          await db.write.close();
        }
      } catch {
        return false;
      }
    },

    async list(_filter) {
      return [];
    },

    async delete(id) {
      const credentials = resolveTursoCredentials(strategy, id);
      const db = createTursoClients(credentials);
      try {
        const version = await getCurrentSchemaVersion(db);
        if (version !== undefined) {
          await deleteTursoPrincipalData(db);
        }
      } finally {
        await db.read.close();
        await db.write.close();
      }
    },

    async checkpoint(_id) {
      return;
    },

    async snapshot(_id) {
      return unsupportedStorageFeature("snapshot", "turso-serverless");
    },

    async close(_id) {
      return;
    },
  };
}

export function createTursoServerlessBackendFactory(): MemoriesDatabaseBackendFactory {
  return {
    create(strategy) {
      return createTursoServerlessBackend({
        strategy: assertTursoServerlessStrategy(strategy),
      });
    },
  };
}
