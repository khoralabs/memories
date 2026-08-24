import { useCallback, useEffect, useState } from "react";
import type { EdgeDetailJson } from "./memories-client.js";
import { useMemoriesClient } from "./memories-client-provider.js";

export function useEdgeDetail(input: {
  namespace: string;
  edgeId: string;
  open: boolean;
  rootHex?: string;
  includeVectors?: boolean;
  includeSuppressed?: boolean;
}): {
  detail: EdgeDetailJson | null;
  loading: boolean;
  rootHex: string | undefined;
  setRootHex: (rootHex: string | undefined) => void;
  tipReplayAtRootHex: boolean;
} {
  const client = useMemoriesClient();
  const entityKey = `${input.namespace}:${input.edgeId}`;
  const [detailEntityKey, setDetailEntityKey] = useState(entityKey);
  const [detail, setDetail] = useState<EdgeDetailJson | null>(null);
  const [loading, setLoading] = useState(false);
  const [scrubEntityKey, setScrubEntityKey] = useState(entityKey);
  const [scrubRootHex, setScrubRootHex] = useState<string | undefined>();
  const [wasOpen, setWasOpen] = useState(input.open);
  const [tipReplayAtRootHex, setTipReplayAtRootHex] = useState(false);

  if (detailEntityKey !== entityKey) {
    setDetailEntityKey(entityKey);
    setDetail(null);
  }

  if (scrubEntityKey !== entityKey) {
    setScrubEntityKey(entityKey);
    setScrubRootHex(undefined);
  }
  if (input.open && !wasOpen) {
    setWasOpen(true);
    setScrubRootHex(undefined);
  }
  if (!input.open && wasOpen) {
    setWasOpen(false);
  }

  const queryRootHex =
    scrubEntityKey === entityKey ? (scrubRootHex ?? input.rootHex) : input.rootHex;

  useEffect(() => {
    if (!input.open) return;
    const ac = new AbortController();
    void client
      .getBackendCapabilities({ signal: ac.signal })
      .then((caps) => {
        if (!ac.signal.aborted) setTipReplayAtRootHex(caps.tipReplayAtRootHex === true);
      })
      .catch(() => {
        if (!ac.signal.aborted) setTipReplayAtRootHex(false);
      });
    return () => ac.abort();
  }, [input.open, client]);

  useEffect(() => {
    if (!input.open) {
      setDetail(null);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setDetail(null);
    void client
      .getEdgeDetail({
        namespace: input.namespace,
        edgeId: input.edgeId,
        ...(queryRootHex !== undefined ? { rootHex: queryRootHex } : {}),
        ...(input.includeVectors === true ? { includeVectors: true } : {}),
        ...(input.includeSuppressed === true ? { includeSuppressed: true } : {}),
        signal: ac.signal,
      })
      .then((json) => {
        if (!ac.signal.aborted) setDetail(json);
      })
      .catch(() => {
        if (!ac.signal.aborted) setDetail(null);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [
    input.open,
    input.namespace,
    input.edgeId,
    input.includeVectors,
    input.includeSuppressed,
    queryRootHex,
    client,
  ]);

  const setScrubRootHexForEntity = useCallback(
    (next: string | undefined) => {
      setScrubEntityKey(entityKey);
      setScrubRootHex(next);
    },
    [entityKey],
  );

  return {
    detail,
    loading,
    rootHex: detail?.rootHex ?? queryRootHex,
    setRootHex: setScrubRootHexForEntity,
    tipReplayAtRootHex,
  };
}
