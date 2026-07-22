import z from "zod";

/** Epoch / creation time in milliseconds (non-negative; may be fractional). */
const zMillisTimestamp = z.number().nonnegative();

/** Runtime metadata for {@link zId} — used to derive SQLite foreign keys. */
export type ZIdMeta<NAME extends string = string> = { readonly idRef: NAME };

/** String id with `idRef` meta for relational mapping; plain `string` inference (no nominal brand). */
export const zId = <NAME extends string>(name: NAME) =>
  z.string().meta({ idRef: name } as const satisfies ZIdMeta<NAME>);

/**
 * Extends a Zod object with `_id` and `_ts_created` (ms timestamp).
 */
export function defineTable<const NAME extends string, BASE extends z.ZodObject>(
  name: NAME,
  base: BASE,
) {
  return base.extend({
    _id: zId(name),
    _ts_created: zMillisTimestamp,
  });
}

/** Structural shape per table — avoids `ReturnType<typeof defineTable>` collapsing generics to `unknown`. */
type SchemaShape<T extends Record<string, z.ZodObject>> = {
  [K in keyof T]: z.ZodObject<
    z.util.Extend<
      T[K]["shape"],
      {
        _id: ReturnType<typeof zId<K & string>>;
        _ts_created: typeof zMillisTimestamp;
      }
    >
  >;
};

/**
 * Builds a `z.object` of table schemas: each entry is `defineTable(key, tables[key])`.
 */
export function defineSchema<const T extends Record<string, z.ZodObject>>(
  tables: T,
): z.ZodObject<SchemaShape<T>> {
  const shape = {} as Record<string, z.ZodObject>;
  for (const k of Object.keys(tables) as (keyof T & string)[]) {
    const child = tables[k];
    if (child === undefined) continue;
    shape[k] = defineTable(k, child);
  }
  return z.object(shape as SchemaShape<T>);
}

/**
 * Document (row) validator for one table: same as `schema.shape[name]`, including `_id` and `_ts_created`.
 */
export function documentValidator<
  S extends z.ZodObject<Record<string, z.ZodObject>>,
  K extends keyof S["shape"] & string,
>(schema: S, name: K): S["shape"][K] {
  const doc = schema.shape[name];
  if (doc === undefined) {
    throw new RangeError(`Unknown table: ${String(name)}`);
  }
  return doc as S["shape"][K];
}
