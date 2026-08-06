import { createContext, type PropsWithChildren, useContext } from "react";
import type { ReactMemoriesClient } from "./memories-client.js";

const MemoriesClientContext = createContext<ReactMemoriesClient | null>(null);

export type MemoriesClientProviderProps = PropsWithChildren<{
  client: ReactMemoriesClient;
}>;

/** Mount high in the tree; graph chrome/components load data via {@link useMemoriesClient}. */
export function MemoriesClientProvider({ client, children }: MemoriesClientProviderProps) {
  return <MemoriesClientContext.Provider value={client}>{children}</MemoriesClientContext.Provider>;
}

/** Injected {@link ReactMemoriesClient}; must be under {@link MemoriesClientProvider}. */
export function useMemoriesClient(): ReactMemoriesClient {
  const client = useContext(MemoriesClientContext);
  if (client == null) {
    throw new Error("useMemoriesClient must be used within MemoriesClientProvider");
  }
  return client;
}
