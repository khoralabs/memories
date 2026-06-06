/**
 * Conservative default for tool-loop steps in memory adapter/integrator agents.
 * Hosts should pass explicit `maxSteps` (or set `defaultMaxSteps` on clients) for
 * full-quality ingests; short loops keep accidental runaway cost low.
 */
export const DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS = 2;

/** Default tool-loop steps for the memory investigator (multi-hop search + synthesis). */
export const DEFAULT_INVESTIGATOR_MAX_STEPS = 10;
