import { describe, expect, test } from "bun:test";
import { generateIdentity } from "@khoralabs/did-key-identity";

import {
  AGENT_REQUEST_HEADER,
  canonicalAgentRequestMessage,
  createMemoryNonceStore,
  signAgentRequest,
  verifyAgentRequest,
} from "./agent-request-wire";
import { createDidKeyPrincipalVerifier } from "./did-key-verifier";
import { createDidPrincipalAuthStrategy } from "./did-principal";

describe("agent-request-wire", () => {
  test("sign and verify round-trip", async () => {
    const signer = await generateIdentity();
    const bodyText = JSON.stringify({ kind: "account", ownerKey: signer.did });
    const path = "/databases/open";
    const { headers } = await signAgentRequest({
      method: "POST",
      path,
      bodyText,
      signer,
    });
    const req = new Request(`http://memories.test${path}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: bodyText,
    });
    const { did } = await verifyAgentRequest(req, { nonceStore: createMemoryNonceStore() });
    expect(did).toBe(signer.did);
    expect(await req.text()).toBe(bodyText);
  });

  test("canonical message uppercases method", async () => {
    const a = await canonicalAgentRequestMessage({
      method: "post",
      path: "/x",
      timestampMs: 1,
      nonce: "n",
      bodyText: "{}",
    });
    const b = await canonicalAgentRequestMessage({
      method: "POST",
      path: "/x",
      timestampMs: 1,
      nonce: "n",
      bodyText: "{}",
    });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  test("rejects bad signature", async () => {
    const signer = await generateIdentity();
    const bodyText = "{}";
    const { headers } = await signAgentRequest({
      method: "POST",
      path: "/x",
      bodyText,
      signer,
    });
    headers[AGENT_REQUEST_HEADER.sig] = "AAAA";
    await expect(
      verifyAgentRequest(
        new Request("http://memories.test/x", {
          method: "POST",
          headers,
          body: bodyText,
        }),
        { nonceStore: createMemoryNonceStore() },
      ),
    ).rejects.toThrow(/signature invalid|Uint8Array|expected/);
  });

  test("createDidKeyPrincipalVerifier authenticates did-principal strategy", async () => {
    const signer = await generateIdentity();
    const path = "/databases";
    const { headers } = await signAgentRequest({
      method: "GET",
      path,
      bodyText: "",
      signer,
    });
    const auth = createDidPrincipalAuthStrategy({
      verify: createDidKeyPrincipalVerifier(),
    });
    const actor = await auth.authenticate(
      new Request(`http://memories.test${path}`, { method: "GET", headers }),
    );
    expect(actor.scheme).toBe("did-principal");
    expect(actor.subject).toBe(signer.did);
  });

  test("rejects nonce reuse", async () => {
    const signer = await generateIdentity();
    const bodyText = "{}";
    const { headers } = await signAgentRequest({
      method: "POST",
      path: "/x",
      bodyText,
      signer,
      nonce: () => "fixed-nonce-aaaaaaaa",
      now: () => 1_700_000_000_000,
    });
    const store = createMemoryNonceStore();
    const mk = () =>
      new Request("http://memories.test/x", {
        method: "POST",
        headers: { ...headers },
        body: bodyText,
      });
    await verifyAgentRequest(mk(), { nonceStore: store, now: () => 1_700_000_000_000 });
    await expect(
      verifyAgentRequest(mk(), { nonceStore: store, now: () => 1_700_000_000_000 }),
    ).rejects.toThrow(/nonce reuse/);
  });

  test("rejects stale timestamp", async () => {
    const signer = await generateIdentity();
    const bodyText = "{}";
    const { headers } = await signAgentRequest({
      method: "POST",
      path: "/x",
      bodyText,
      signer,
      now: () => 1_000,
    });
    await expect(
      verifyAgentRequest(
        new Request("http://memories.test/x", {
          method: "POST",
          headers,
          body: bodyText,
        }),
        { nonceStore: createMemoryNonceStore(), now: () => 1_000 + 120_000 },
      ),
    ).rejects.toThrow(/timestamp out of window/);
  });
});
