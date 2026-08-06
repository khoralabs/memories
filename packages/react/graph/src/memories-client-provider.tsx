import type {
  MemoriesDatabaseId,
  StoredOntologyJsonSchema,
} from "@khoralabs/memories-service/client";
import {
  MemoriesOntologyClient,
  MemoriesServiceClient,
  type MemoriesServiceClientAuthProvider,
  type MemoriesServiceFetch,
} from "@khoralabs/memories-service/client";
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

export type MemoriesClientValue = {
  /** Graph backend client for the focused database. */
  client: ReactMemoriesClient;
  /** Focused database id. Downstream namespaces/memory providers reload when this changes. */
  database: MemoriesDatabaseId;
  /**
   * Switch the focused database: optionally `openDatabase`, rebuild the client when a
   * `createClient` factory was provided, then reload linked ontology.
   * @param id - Database to focus
   */
  focusDatabase: (id: MemoriesDatabaseId) => Promise<void>;
  /**
   * Resolved linked ontology schema for `database`, or `null` when unlinked / unavailable.
   * Hosts may use this to validate create/update forms; this package does not ship forms.
   */
  ontology: StoredOntologyJsonSchema | null;
  /** Hash of the current ontology link, or `null` when unlinked. */
  ontologyHash: string | null;
  ontologyLoading: boolean;
  ontologyError: string | null;
  /** Re-fetch `getCurrentLink` → `getOntology` for the focused database. */
  reloadOntology: () => Promise<void>;
};

const MemoriesClientContext = createContext<MemoriesClientValue | null>(null);

function databaseKey(id: MemoriesDatabaseId): string {
  return `${id.kind}:${id.ownerKey}`;
}

type SharedOntologyProps = {
  /** Optional prebuilt service client (else constructed from `baseUrl` / `auth` / `fetch`). */
  serviceClient?: MemoriesServiceClient;
  /** Optional prebuilt ontology client (else derived from `serviceClient`). */
  ontologyClient?: MemoriesOntologyClient;
  /** Service base URL used to construct clients when `serviceClient` is omitted. */
  baseUrl?: string;
  auth?: MemoriesServiceClientAuthProvider;
  fetch?: MemoriesServiceFetch;
  /** When true (default), call `openDatabase` on focus when a service client is available. */
  openOnFocus?: boolean;
};

export type MemoriesClientProviderProps = PropsWithChildren<
  SharedOntologyProps &
    (
      | {
          /** Preferred: rebuild client when database focus changes. */
          createClient: (database: MemoriesDatabaseId) => ReactMemoriesClient;
          /** Seed (and controlled) focused database. */
          database: MemoriesDatabaseId;
          client?: never;
        }
      | {
          /** Legacy: fixed client; optional database id for ontology resolution. */
          client: ReactMemoriesClient;
          /** Optional id used for ontology resolution when not switching clients. */
          database?: MemoriesDatabaseId;
          createClient?: never;
        }
    )
>;

const UNSET_DATABASE: MemoriesDatabaseId = { kind: "account", ownerKey: "_unset_" };

/**
 * Root provider: focused database, resolved linked ontology, and {@link ReactMemoriesClient}.
 * Mount above {@link MemoriesNamespacesProvider}. Prefer `createClient` + `database` so
 * {@link MemoriesClientValue.focusDatabase} can retarget the client.
 */
export function MemoriesClientProvider(props: MemoriesClientProviderProps) {
  const { children, openOnFocus = true } = props;

  const seedDatabase = props.database !== undefined ? props.database : UNSET_DATABASE;

  const [database, setDatabase] = useState<MemoriesDatabaseId>(seedDatabase);
  const [client, setClient] = useState<ReactMemoriesClient>(() =>
    props.createClient !== undefined ? props.createClient(seedDatabase) : props.client,
  );

  const createClientRef = useRef(props.createClient);
  createClientRef.current = props.createClient;

  const serviceClient = useMemo(() => {
    if (props.serviceClient !== undefined) return props.serviceClient;
    if (props.baseUrl === undefined) return null;
    return new MemoriesServiceClient({
      baseUrl: props.baseUrl,
      ...(props.auth !== undefined ? { auth: props.auth } : {}),
      ...(props.fetch !== undefined ? { fetch: props.fetch } : {}),
    });
  }, [props.serviceClient, props.baseUrl, props.auth, props.fetch]);

  const ontologyClient = useMemo(() => {
    if (props.ontologyClient !== undefined) return props.ontologyClient;
    if (serviceClient === null) return null;
    return new MemoriesOntologyClient({ serviceClient });
  }, [props.ontologyClient, serviceClient]);

  const [ontology, setOntology] = useState<StoredOntologyJsonSchema | null>(null);
  const [ontologyHash, setOntologyHash] = useState<string | null>(null);
  const [ontologyLoading, setOntologyLoading] = useState(false);
  const [ontologyError, setOntologyError] = useState<string | null>(null);

  const reloadOntology = useCallback(async () => {
    if (ontologyClient === null || databaseKey(database) === databaseKey(UNSET_DATABASE)) {
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
      if (link === undefined) {
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

  // Legacy: keep injected client reference in sync.
  useEffect(() => {
    if (props.createClient === undefined && props.client !== undefined) {
      setClient(props.client);
    }
  }, [props.createClient, props.client]);

  const focusDatabase = useCallback(
    async (id: MemoriesDatabaseId) => {
      if (databaseKey(id) === databaseKey(database)) return;
      if (serviceClient !== null && openOnFocus) {
        await serviceClient.openDatabase(id);
      }
      const factory = createClientRef.current;
      if (factory !== undefined) {
        setClient(factory(id));
      }
      setDatabase(id);
    },
    [database, openOnFocus, serviceClient],
  );

  // Host seed database prop change → focus.
  useEffect(() => {
    if (props.database === undefined) return;
    if (databaseKey(props.database) === databaseKey(database)) return;
    void focusDatabase(props.database);
  }, [props.database, database, focusDatabase]);

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
