import { z } from "zod";

/** Stable machine-readable codes for memories-service JSON error envelopes. */
export const MEMORIES_ERROR_CODE = {
  invalid_request: "invalid_request",
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  not_found: "not_found",
  conflict: "conflict",
  not_configured: "not_configured",
  internal_error: "internal_error",
  bad_gateway: "bad_gateway",
} as const;

export type MemoriesErrorCode = (typeof MEMORIES_ERROR_CODE)[keyof typeof MEMORIES_ERROR_CODE];

export const zMemoriesErrorCode = z.enum([
  MEMORIES_ERROR_CODE.invalid_request,
  MEMORIES_ERROR_CODE.unauthorized,
  MEMORIES_ERROR_CODE.forbidden,
  MEMORIES_ERROR_CODE.not_found,
  MEMORIES_ERROR_CODE.conflict,
  MEMORIES_ERROR_CODE.not_configured,
  MEMORIES_ERROR_CODE.internal_error,
  MEMORIES_ERROR_CODE.bad_gateway,
]);

export const zMemoriesErrorEnvelope = z.object({
  error: z.string(),
  code: zMemoriesErrorCode.optional(),
});

export type MemoriesErrorEnvelope = z.infer<typeof zMemoriesErrorEnvelope>;

export function memoriesErrorCodeForStatus(status: number): MemoriesErrorCode {
  if (status === 401) return MEMORIES_ERROR_CODE.unauthorized;
  if (status === 403) return MEMORIES_ERROR_CODE.forbidden;
  if (status === 404) return MEMORIES_ERROR_CODE.not_found;
  if (status === 409) return MEMORIES_ERROR_CODE.conflict;
  if (status === 501) return MEMORIES_ERROR_CODE.not_configured;
  if (status === 502) return MEMORIES_ERROR_CODE.bad_gateway;
  if (status >= 500) return MEMORIES_ERROR_CODE.internal_error;
  if (status >= 400) return MEMORIES_ERROR_CODE.invalid_request;
  return MEMORIES_ERROR_CODE.internal_error;
}
