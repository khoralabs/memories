import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ReactMemoriesClient } from "./memories-client.js";
import { type MemoriesDatabaseId, memoriesDatabaseKey } from "./memories-database-id.js";

/** Linked ontology document (opaque to the UI package — hosts validate forms). */
export type MemoriesOntologySchema = Record<string, unknown>;

/** Duck-typed open/focus helper; typically a memories-service client. */
export type MemoriesOpenDatabaseClient = {
  openDatabase(id: MemoriesDatabaseId): Promise<void>;
};

/** Duck-typed ontology registry client. */
export type MemoriesOntologyLinkClient = {
  getCurrentLink(database: MemoriesDatabaseId): Promise<{ hash: string } | undefined | null>;
  getOntology(hash: string): Promise<{ hash: string; schema: MemoriesOntologySchema }>;
};

export type MemoriesClientValue = {
  /** Graph backend client for the focused database. */
  client: ReactMemoriesClient;
  /** Focused database id. Downstream namespaces/memory providers reload when this changes. */
  database: MemoriesDatabaseId;
  /**
   * Switch the focused database: optionally `openDatabase`, rebuild the client via
   * `createClient`, then reload linked ontology.
   * @param id - Database to focus
   */
  focusDatabase: (id: MemoriesDatabaseId) => Promise<void>;
  /**
   * Resolved linked ontology schema for `database`, or `null` when unlinked / unavailable.
   * Hosts may use this to validate create/update forms; this package does not ship forms.
   */
  ontology: MemoriesOntologySchema | null;
  /** Hash of the current ontology link, or `null` when unlinked. */
  ontologyHash: string | null;
  ontologyLoading: boolean;
  ontologyError: string | null;
  /** Re-fetch `getCurrentLink` → `getOntology` for the focused database. */
  reloadOntology: () => Promise<void>;
};

const MemoriesClientContext = createContext<MemoriesClientValue | null>(null);

export type MemoriesClientProviderProps = PropsWithChildren<{
  /** Rebuild client when database focus changes. */
  createClient: (database: MemoriesDatabaseId) => ReactMemoriesClient;
  /** Seed (and controlled) focused database. */
  database: MemoriesDatabaseId;
  /** Optional prebuilt service client for `openOnFocus` (inject from host; no Node import here). */
  serviceClient?: MemoriesOpenDatabaseClient;
  /** Optional ontology client (inject from host). */
  ontologyClient?: MemoriesOntologyLinkClient;
  /** When true (default), call `openDatabase` on focus when a service client is available. */
  openOnFocus?: boolean;
}>;

/**
 * Root provider: focused database, resolved linked ontology, and {@link ReactMemoriesClient}.
 * Mount above {@link MemoriesNamespacesProvider}. Pass `createClient` + `database` so
 * {@link MemoriesClientValue.focusDatabase} can retarget the client.
 *
 * This module is browser-safe: it does not import `@khoralabs/memories-service`. Pass
 * `serviceClient` / `ontologyClient` when you need open-on-focus or ontology resolution.
 */
export function MemoriesClientProvider(props: MemoriesClientProviderProps) {
  const {
    children,
    createClient,
    database: seedDatabase,
    openOnFocus = true,
    serviceClient = null,
    ontologyClient = null,
  } = props;

  const [database, setDatabase] = useState<MemoriesDatabaseId>(seedDatabase);
  const [client, setClient] = useState<ReactMemoriesClient>(() => createClient(seedDatabase));

  const createClientRef = useRef(createClient);
  createClientRef.current = createClient;

  const [ontology, setOntology] = useState<MemoriesOntologySchema | null>(null);
  const [ontologyHash, setOntologyHash] = useState<string | null>(null);
  const [ontologyLoading, setOntologyLoading] = useState(false);
  const [ontologyError, setOntologyError] = useState<string | null>(null);

  const reloadOntology = useCallback(async () => {
    if (ontologyClient === null) {
      setOntology(null);
      setOntologyHash(null);
      setOntologyError(null);
      setOntologyLoading(false);
      return;
    }
    setOntologyLoading(true);
    setOntologyError(null);
    try {
      const link = await ontologyClient.getCurrentLink(database);
      if (link == null) {
        setOntology(null);
        setOntologyHash(null);
        return;
      }
      const { schema } = await ontologyClient.getOntology(link.hash);
      setOntology(schema);
      setOntologyHash(link.hash);
    } catch (e) {
      setOntology(null);
      setOntologyHash(null);
      setOntologyError(e instanceof Error ? e.message : String(e));
    } finally {
      setOntologyLoading(false);
    }
  }, [ontologyClient, database]);

  useEffect(() => {
    void reloadOntology();
  }, [reloadOntology]);

  const focusDatabase = useCallback(
    async (id: MemoriesDatabaseId) => {
      if (memoriesDatabaseKey(id) === memoriesDatabaseKey(database)) return;
      if (serviceClient !== null && openOnFocus) {
        await serviceClient.openDatabase(id);
      }
      setClient(createClientRef.current(id));
      setDatabase(id);
    },
    [database, openOnFocus, serviceClient],
  );

  // Host seed database prop change → focus.
  useEffect(() => {
    if (memoriesDatabaseKey(seedDatabase) === memoriesDatabaseKey(database)) return;
    void focusDatabase(seedDatabase);
  }, [seedDatabase, database, focusDatabase]);

  const value = useMemo(
    (): MemoriesClientValue => ({
      client,
      database,
      focusDatabase,
      ontology,
      ontologyHash,
      ontologyLoading,
      ontologyError,
      reloadOntology,
    }),
    [
      client,
      database,
      focusDatabase,
      ontology,
      ontologyHash,
      ontologyLoading,
      ontologyError,
      reloadOntology,
    ],
  );

  return <MemoriesClientContext.Provider value={value}>{children}</MemoriesClientContext.Provider>;
}

/** Full client context (database focus + ontology + ReactMemoriesClient). */
export function useMemoriesDatabase(): MemoriesClientValue {
  const ctx = useContext(MemoriesClientContext);
  if (ctx == null) {
    throw new Error("useMemoriesDatabase must be used within MemoriesClientProvider");
  }
  return ctx;
}

/** Injected {@link ReactMemoriesClient}; must be under {@link MemoriesClientProvider}. */
export function useMemoriesClient(): ReactMemoriesClient {
  return useMemoriesDatabase().client;
}
