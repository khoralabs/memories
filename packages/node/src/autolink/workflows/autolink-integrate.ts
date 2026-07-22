import { start } from "workflow/api";
import type { LabelSchemaMap } from "../../ontology/ontology.ts";
import {
  type AutolinkIntegrateDeps,
  type IntegrateNewMemoryArgs,
  runAutolinkIntegrate,
} from "../integrate.js";
import { requireAutolinkSession } from "../session.js";

/**
 * Serializable workflow params. Bind the memories client via
 * `provideAutolinkSession` before `start`, or pass `deps` into
 * {@link executeAutolinkIntegrate} for tests / nested callers.
 */
export type AutolinkIntegrateParams = IntegrateNewMemoryArgs<LabelSchemaMap, LabelSchemaMap> & {
  sessionId?: string;
};

export type AutolinkIntegrateResult = string[];

/**
 * Durable search-then-link integrate workflow.
 * The hosting process must configure and start the Workflow world (e.g. Local
 * or Turso) before invoking this — autolink does not select a world backend.
 */
export async function autolinkIntegrate(
  params: AutolinkIntegrateParams,
): Promise<AutolinkIntegrateResult> {
  "use workflow";

  return await executeAutolinkIntegrate(params);
}

export async function executeAutolinkIntegrate(
  params: AutolinkIntegrateParams,
  deps?: AutolinkIntegrateDeps,
): Promise<AutolinkIntegrateResult> {
  "use step";

  const { sessionId, ...args } = params;
  if (deps !== undefined) {
    return runAutolinkIntegrate(args, deps);
  }
  if (sessionId === undefined || sessionId.length === 0) {
    throw new Error(
      "executeAutolinkIntegrate: pass deps or set params.sessionId after provideAutolinkSession",
    );
  }
  return runAutolinkIntegrate(args, requireAutolinkSession(sessionId));
}

export async function startAutolinkIntegrate(
  params: AutolinkIntegrateParams,
): Promise<AutolinkIntegrateResult> {
  const run = await start(autolinkIntegrate, [params]);
  return run.returnValue as Promise<AutolinkIntegrateResult>;
}
