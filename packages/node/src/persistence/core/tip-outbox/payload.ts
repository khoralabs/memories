import { sha256Hex } from "../models/sha256";

export function payloadSha256(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}

export function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function float32Bytes(values: readonly number[]): Uint8Array {
  const arr = new Float32Array(values);
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}

export function float32FromBytes(bytes: Uint8Array): number[] {
  const aligned = bytes.byteOffset % 4 === 0 ? bytes : new Uint8Array(bytes);
  const view = new Float32Array(
    aligned.buffer,
    aligned.byteOffset,
    Math.floor(aligned.byteLength / 4),
  );
  return Array.from(view);
}
