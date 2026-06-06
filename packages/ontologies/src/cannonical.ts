import { defineOntology } from "@khoralabs/memories-core";
import z from "zod";

/** Default graph vocabulary for personal/agent memory: people, places, time, facts, and how they relate. */
export const canonicalOntology = defineOntology({
  nodeLabels: {
    person: z
      .object({
        name: z.string().describe("Primary name or handle as the user refers to them."),
        role: z
          .string()
          .optional()
          .describe(
            "Job title, relationship (e.g. manager, sibling), or capacity in this context.",
          ),
        organization: z.string().optional().describe("Employer, team, or affiliation if known."),
        timezone: z
          .string()
          .optional()
          .describe("IANA tz id (e.g. America/New_York) when scheduling matters."),
      })
      .describe("A human or agent the user interacts with."),

    place: z
      .object({
        name: z.string().describe("Short label: building, city, or virtual space."),
        kind: z
          .enum(["physical", "online", "region", "other"])
          .optional()
          .describe("How this place is encountered."),
        country: z.string().optional().describe("ISO3166-1 alpha-2 or country name when relevant."),
      })
      .describe("Somewhere work or life happens: office, city, URL-backed venue."),

    preference: z
      .object({
        topic: z
          .string()
          .describe("What the preference is about (stack, vendor, workflow, food, etc.)."),
        stance: z
          .enum(["likes", "dislikes", "neutral", "prefers_when"])
          .describe("Direction of the preference."),
        detail: z.string().optional().describe("One concrete reason or constraint (keep short)."),
      })
      .describe("User taste, default choice, or thing to avoid."),

    event: z
      .object({
        summary: z
          .string()
          .optional()
          .describe(
            "Human-readable summary if distinct from surrounding memory text. Keep it short and concise.",
          ),
        startsAt: z.string().optional().describe("Start time in ISO 8601 (UTC or with offset)."),
        endsAt: z
          .string()
          .optional()
          .describe("End time in ISO 8601 when the event has a clear end."),
        status: z
          .enum(["planned", "completed", "cancelled", "unknown"])
          .optional()
          .describe("Whether this is past, future, or uncertain."),
      })
      .describe("Something that happened or will happen at a time."),

    fact: z
      .object({
        subject: z.string().describe("Entity the fact is about (noun phrase)."),
        predicate: z.string().describe("Relationship or attribute (short verb phrase)."),
        object: z.string().describe("Value or other entity (noun phrase)."),
        source: z
          .string()
          .optional()
          .describe("Where this was learned: doc, person, ticket id, etc."),
      })
      .describe("Atomic subject-predicate-object statement treated as ground truth here."),

    observation: z
      .object({
        summary: z.string().describe("What was noticed, past tense, one or two sentences max."),
        confidence: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe("How sure the user or system is."),
        observedAt: z
          .string()
          .optional()
          .describe("ISO 8601 when the observation was made or recorded."),
      })
      .describe("Perceived state of the world; may be revised later."),

    belief: z
      .object({
        claim: z.string().describe("What is believed to be true (full sentence)."),
        certainty: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("0 = hunch, 1 = would bet on it; omit if unknown."),
        basis: z
          .string()
          .optional()
          .describe("Why this belief exists: inference, hearsay, measurement."),
      })
      .describe("Hypothesis or working assumption, not yet promoted to fact."),

    temporal: z
      .object({
        label: z.string().describe("Human window: e.g. Q1 2025, sprint42, last Tuesday."),
        anchor: z
          .string()
          .optional()
          .describe("ISO 8601 instant or date if the window pins to a single point."),
        grain: z
          .enum(["instant", "day", "week", "month", "quarter", "year", "range", "fuzzy"])
          .optional()
          .describe("How precise the time reference is."),
      })
      .describe("Named or fuzzy time bucket for ordering and recall."),
  },
  edgeLabels: {
    references: z
      .object({
        context: z
          .string()
          .optional()
          .describe("Why this link exists: citation, background reading, ticket."),
      })
      .describe("Points to supporting material or related memory without implying causality."),

    affects: z
      .object({
        impact: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe("How strongly the source influences the target."),
        aspect: z
          .string()
          .optional()
          .describe("What dimension is affected: timeline, cost, morale, scope, etc."),
      })
      .describe("Source changes or constrains the target in practice."),

    causes: z
      .object({
        mechanism: z.string().optional().describe("Short causal chain or mediating factor."),
      })
      .describe("Source brought about or strongly explains the target."),

    describes: z
      .object({
        facet: z
          .string()
          .optional()
          .describe("Which part of the target is characterized (role, history, risk)."),
      })
      .describe("Source text or node is primarily about the target."),

    before: z
      .object({
        orderingConfidence: z
          .enum(["exact", "approximate", "inferred"])
          .optional()
          .describe("How reliable the ordering is."),
      })
      .describe("Source event or time precedes the target."),

    after: z
      .object({
        orderingConfidence: z
          .enum(["exact", "approximate", "inferred"])
          .optional()
          .describe("How reliable the ordering is."),
      })
      .describe("Source event or time follows the target."),

    during: z
      .object({
        overlap: z
          .enum(["full", "partial", "unknown"])
          .optional()
          .describe("Whether the whole source fits inside the target window."),
      })
      .describe("Source occurs inside the target interval or container event."),

    includes: z
      .object({
        part: z
          .string()
          .optional()
          .describe("Role of the target inside the aggregate: agenda item, attendee, subtask."),
      })
      .describe("Source aggregate or agenda contains the target member."),
  },
});
