import { createHash } from "node:crypto";

/** SHA-256 digest as lowercase hex. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** SHA-256 digest as raw bytes. */
export function sha256Digest(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}
