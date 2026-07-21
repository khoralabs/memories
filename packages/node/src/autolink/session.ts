import type { AutolinkIntegrateDeps } from "./integrate.js";

const GLOBAL_KEY = "__khoralabs_memories_autolink_sessions__";

type AutolinkSessionStore = Map<string, AutolinkIntegrateDeps>;

function sessions(): AutolinkSessionStore {
  const g = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: AutolinkSessionStore;
  };
  if (g[GLOBAL_KEY] === undefined) {
    g[GLOBAL_KEY] = new Map();
  }
  return g[GLOBAL_KEY];
}

/** Bind a non-serializable memories client for workflow steps keyed by {@code sessionId}. */
export function provideAutolinkSession(sessionId: string, deps: AutolinkIntegrateDeps): void {
  if (sessionId.length === 0) {
    throw new Error("provideAutolinkSession: sessionId must be non-empty");
  }
  sessions().set(sessionId, deps);
}

export function getAutolinkSession(sessionId: string): AutolinkIntegrateDeps | undefined {
  return sessions().get(sessionId);
}

export function requireAutolinkSession(sessionId: string): AutolinkIntegrateDeps {
  const session = sessions().get(sessionId);
  if (session === undefined) {
    throw new Error(`autolink session ${sessionId} is not active`);
  }
  return session;
}

export function releaseAutolinkSession(sessionId: string): AutolinkIntegrateDeps | undefined {
  const store = sessions();
  const session = store.get(sessionId);
  store.delete(sessionId);
  return session;
}

export function resetAutolinkSessionRegistryForTests(): void {
  sessions().clear();
}
