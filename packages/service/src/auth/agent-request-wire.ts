/**
 * Khora/relay-compatible agent HTTP request signatures for memories-service.
 * Wire matches chat/relay X-Agent-* (METHOD\\nPATH\\nts\\nnonce\\nsha256(body)).
 */
import type { Signer } from "@khoralabs/did-key-identity";
import { ed25519PublicKeyBytesFromDid } from "@khoralabs/did-key-identity";
import { verifyAsync } from "@noble/ed25519";

export const AGENT_REQUEST_HEADER = {
  did: "X-Agent-Did",
  ts: "X-Agent-Timestamp",
  nonce: "X-Agent-Nonce",
  sig: "X-Agent-Signature",
} as const;

export const AGENT_REQUEST_FRESHNESS_WINDOW_MS = 60_000;

export type AgentRequestEnvelope = {
  did: string;
  timestampMs: number;
  nonce: string;
  signatureB64Url: string;
};

export type MemoriesNonceStore = {
  tryInsert(p: {
    did: string;
    nonce: string;
    expiresAtMs: number;
    nowMs: number;
  }): boolean | Promise<boolean>;
  sweepExpired(nowMs: number): number | Promise<number>;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function base64UrlToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

async function sha256B64Url(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return bytesToBase64Url(new Uint8Array(buf));
}

export async function canonicalAgentRequestMessage(p: {
  method: string;
  path: string;
  timestampMs: number;
  nonce: string;
  bodyText: string;
}): Promise<Uint8Array> {
  const bodyHash = await sha256B64Url(p.bodyText);
  const message = `${p.method.toUpperCase()}\n${p.path}\n${p.timestampMs}\n${p.nonce}\n${bodyHash}`;
  return new TextEncoder().encode(message);
}

export function canonicalAgentRequestPath(
  pathname: string,
  searchParams: URLSearchParams,
  allowedKeys: readonly string[] = [],
): string {
  const out = new URLSearchParams();
  for (const key of allowedKeys) {
    for (const v of searchParams.getAll(key)) {
      out.append(key, v);
    }
  }
  const qs = out.toString();
  return qs.length > 0 ? `${pathname}?${qs}` : pathname;
}

function parseStrictUnsignedInt(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) return undefined;
  return n;
}

export function parseAgentRequestEnvelopeFromHeaders(
  headers: Headers,
): AgentRequestEnvelope | undefined {
  const did = headers.get(AGENT_REQUEST_HEADER.did);
  const tsRaw = headers.get(AGENT_REQUEST_HEADER.ts);
  const nonce = headers.get(AGENT_REQUEST_HEADER.nonce);
  const sig = headers.get(AGENT_REQUEST_HEADER.sig);
  if (
    did === null ||
    did.length === 0 ||
    tsRaw === null ||
    nonce === null ||
    nonce.length === 0 ||
    sig === null ||
    sig.length === 0
  ) {
    return undefined;
  }
  const timestampMs = parseStrictUnsignedInt(tsRaw);
  if (timestampMs === undefined) return undefined;
  return { did, timestampMs, nonce, signatureB64Url: sig };
}

export function randomAgentRequestNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function createMemoryNonceStore(): MemoriesNonceStore {
  const seen = new Map<string, number>();
  return {
    tryInsert(p) {
      const key = `${p.did}\0${p.nonce}`;
      if (seen.has(key)) return false;
      seen.set(key, p.expiresAtMs);
      return true;
    },
    sweepExpired(nowMs) {
      let n = 0;
      for (const [key, exp] of seen) {
        if (exp <= nowMs) {
          seen.delete(key);
          n += 1;
        }
      }
      return n;
    },
  };
}

export type SignAgentRequestInput = {
  method: string;
  path: string;
  bodyText: string;
  signer: Signer;
  now?: () => number;
  nonce?: () => string;
};

export async function signAgentRequest(
  input: SignAgentRequestInput,
): Promise<{ headers: Record<string, string>; envelope: AgentRequestEnvelope }> {
  const timestampMs = (input.now ?? Date.now)();
  const nonce = (input.nonce ?? randomAgentRequestNonce)();
  const message = await canonicalAgentRequestMessage({
    method: input.method,
    path: input.path,
    timestampMs,
    nonce,
    bodyText: input.bodyText,
  });
  const sigBytes = await input.signer.sign(message);
  const signatureB64Url = bytesToBase64Url(sigBytes);
  return {
    headers: {
      [AGENT_REQUEST_HEADER.did]: input.signer.did,
      [AGENT_REQUEST_HEADER.ts]: String(timestampMs),
      [AGENT_REQUEST_HEADER.nonce]: nonce,
      [AGENT_REQUEST_HEADER.sig]: signatureB64Url,
    },
    envelope: {
      did: input.signer.did,
      timestampMs,
      nonce,
      signatureB64Url,
    },
  };
}

export class AgentRequestVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRequestVerifyError";
  }
}

export type VerifyAgentRequestOptions = {
  nonceStore: MemoriesNonceStore;
  now?: () => number;
  freshnessWindowMs?: number;
  signedQueryKeys?: readonly string[];
  /** Pre-read body; if omitted, clones the request and reads text. */
  bodyText?: string;
};

/** Verify X-Agent-* on a Request; returns the proved DID. */
export async function verifyAgentRequest(
  req: Request,
  opts: VerifyAgentRequestOptions,
): Promise<{ did: string }> {
  const envelope = parseAgentRequestEnvelopeFromHeaders(req.headers);
  if (envelope === undefined) {
    throw new AgentRequestVerifyError("missing agent request signature");
  }

  const now = opts.now ?? (() => Date.now());
  const freshnessWindowMs = opts.freshnessWindowMs ?? AGENT_REQUEST_FRESHNESS_WINDOW_MS;
  const t = now();
  if (Math.abs(t - envelope.timestampMs) > freshnessWindowMs) {
    throw new AgentRequestVerifyError("agent request timestamp out of window");
  }

  const url = new URL(req.url);
  const path = canonicalAgentRequestPath(
    url.pathname,
    url.searchParams,
    opts.signedQueryKeys ?? [],
  );
  const bodyText = opts.bodyText ?? (await req.clone().text());
  const message = await canonicalAgentRequestMessage({
    method: req.method,
    path,
    timestampMs: envelope.timestampMs,
    nonce: envelope.nonce,
    bodyText,
  });

  let pubKey: Uint8Array;
  try {
    pubKey = ed25519PublicKeyBytesFromDid(envelope.did);
  } catch {
    throw new AgentRequestVerifyError("invalid agent DID");
  }

  let ok = false;
  try {
    ok = await verifyAsync(base64UrlToBytes(envelope.signatureB64Url), message, pubKey);
  } catch {
    throw new AgentRequestVerifyError("agent request signature invalid");
  }
  if (!ok) {
    throw new AgentRequestVerifyError("agent request signature invalid");
  }

  await opts.nonceStore.sweepExpired(t);
  const inserted = await opts.nonceStore.tryInsert({
    did: envelope.did,
    nonce: envelope.nonce,
    expiresAtMs: envelope.timestampMs + freshnessWindowMs,
    nowMs: t,
  });
  if (!inserted) {
    throw new AgentRequestVerifyError("agent request nonce reuse");
  }
  return { did: envelope.did };
}
