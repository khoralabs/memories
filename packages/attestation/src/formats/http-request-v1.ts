export const KHORA_HTTP_REQUEST_V1 = "khora.http-request-v1" as const;

export type HttpRequestAttestationPayload = {
  v: 1;
  principal: string;
  issuedAt: string;
  method: string;
  path: string;
  bodySha256: string;
  nonce?: string;
  eventDigest?: string;
};
