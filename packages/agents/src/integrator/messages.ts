/** User message wrapping content to integrate (phase 1 search). */
export function buildMemoryIntegratorUserMessage(args: { content: string }): {
  role: "user";
  content: string;
} {
  return {
    role: "user",
    content: `Integrate the following content into the memory graph. Use memory_search to find neighbor memories, then signal completion.\n\n---\n\n${args.content}`,
  };
}

/** Phase 2 nudge after search transcript is in context. */
export function buildMemoryIntegratorPlanUserMessage(args: {
  allowedMemoryKeys: readonly string[];
}): {
  role: "user";
  content: string;
} {
  const keys =
    args.allowedMemoryKeys.length > 0
      ? args.allowedMemoryKeys.join(", ")
      : "(none — use edges: [])";
  return {
    role: "user",
    content: `Output MemoryIntegratorPlan now. For edge.memory use only these exact neighbor keys from search: ${keys}`,
  };
}
