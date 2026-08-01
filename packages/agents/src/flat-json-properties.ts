import z from "zod";

const MAX_FLAT_PROPERTY_ENTRIES = 32;

const flatPropertyValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** Flat string-keyed bag of JSON primitives (no nested objects/arrays). */
export function zFlatJsonProperties(description: string) {
  return z
    .record(z.string(), flatPropertyValue)
    .refine((obj) => Object.keys(obj).length <= MAX_FLAT_PROPERTY_ENTRIES, {
      message: `properties must have at most ${String(MAX_FLAT_PROPERTY_ENTRIES)} entries`,
    })
    .optional()
    .describe(description);
}
