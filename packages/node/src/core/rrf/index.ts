export type ItemId = string;

export type RankedItem<TId extends ItemId = ItemId> = {
  id: TId;
  /**
   * Optional multiplier for this item in this arm only.
   * Useful for local boosts from expansion or arm-specific confidence.
   */
  boost?: number;
};

export type RankedInput<TId extends ItemId = ItemId> = readonly TId[] | readonly RankedItem<TId>[];

export type RrfArm<TId extends ItemId = ItemId> = {
  armId: string;
  ranked: RankedInput<TId>;
  /**
   * Arm-wide multiplier.
   */
  weight?: number;
};

export type ArmAdapterInput<TItem, TId extends ItemId = ItemId> = {
  armId: string;
  items: readonly TItem[];
  getId: (item: TItem) => TId;
  getScore?: (item: TItem) => number | undefined;
  weight?: number;
  sortByScore?: boolean;
  descending?: boolean;
  limit?: number;
  /**
   * Maps a raw score to an optional item boost.
   * Defaults to no boost.
   */
  scoreToBoost?: (score: number, item: TItem, index: number) => number;
};

export type RrfOptions<TId extends ItemId = ItemId> = {
  /**
   * RRF constant. Typical values: 60-100.
   */
  k?: number;
  /**
   * Optional global item boost applied after arm + per-item boosts.
   */
  itemBoosts?: ReadonlyMap<TId, number> | Partial<Record<TId, number>>;
  /**
   * If set, only include the top N results from each arm.
   */
  maxPerArm?: number;
};

export type RrfContribution = {
  armId: string;
  rank: number;
  score: number;
};

export type RrfResult<TId extends ItemId = ItemId> = {
  id: TId;
  score: number;
  contributions: RrfContribution[];
};

function normalizeRanked<TId extends ItemId>(ranked: RankedInput<TId>): RankedItem<TId>[] {
  if (!ranked.length) return [];
  const first = ranked[0];
  if (typeof first === "string") {
    return (ranked as readonly TId[]).map((id) => ({ id }));
  }
  return [...(ranked as readonly RankedItem<TId>[])];
}

function lookupBoost<TId extends ItemId>(
  boosts: RrfOptions<TId>["itemBoosts"],
  id: TId,
): number | undefined {
  if (!boosts) return undefined;
  if (boosts instanceof Map) return boosts.get(id);
  return (boosts as Partial<Record<string, number>>)[id];
}

export function fuseRrf<TId extends ItemId = ItemId>(
  arms: readonly RrfArm<TId>[],
  options: RrfOptions<TId> = {},
): RrfResult<TId>[] {
  const k = options.k ?? 60;
  const maxPerArm = options.maxPerArm;
  const byId = new Map<TId, RrfResult<TId>>();

  for (const arm of arms) {
    const weight = arm.weight ?? 1;
    const ranked = normalizeRanked(arm.ranked);
    const slice = maxPerArm ? ranked.slice(0, maxPerArm) : ranked;

    for (let i = 0; i < slice.length; i++) {
      const item = slice[i];
      if (!item) continue;
      const rank = i + 1;
      const perItemBoost = item.boost ?? 1;
      const globalBoost = lookupBoost(options.itemBoosts, item.id) ?? 1;
      const score = (weight * perItemBoost * globalBoost) / (k + rank);

      const existing = byId.get(item.id);
      if (existing) {
        existing.score += score;
        existing.contributions.push({ armId: arm.armId, rank, score });
      } else {
        byId.set(item.id, {
          id: item.id,
          score,
          contributions: [{ armId: arm.armId, rank, score }],
        });
      }
    }
  }

  const sorted = [...byId.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id.localeCompare(b.id);
  });
  return sorted;
}

export function rankIds<TId extends ItemId = ItemId>(
  arms: readonly RrfArm<TId>[],
  options?: RrfOptions<TId>,
): TId[] {
  return fuseRrf(arms, options).map((row) => row.id);
}

/**
 * Adapter to build an RRF arm from arbitrary result shapes.
 */
export function adaptArm<TItem, TId extends ItemId = ItemId>(
  input: ArmAdapterInput<TItem, TId>,
): RrfArm<TId> {
  const sortByScore = input.sortByScore ?? !!input.getScore;
  const descending = input.descending ?? true;
  const scoreToBoost = input.scoreToBoost;

  const enriched = input.items.map((item, index) => {
    const score = input.getScore?.(item);
    const normalizedScore = Number.isFinite(score) ? score : undefined;
    return { item, index, score: normalizedScore };
  });

  if (sortByScore) {
    enriched.sort((a, b) => {
      const as = a.score ?? (descending ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY);
      const bs = b.score ?? (descending ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY);
      if (as !== bs) return descending ? bs - as : as - bs;
      return a.index - b.index;
    });
  }

  const limited = input.limit ? enriched.slice(0, input.limit) : enriched;
  const ranked = limited.map(({ item, score }, i) => {
    const boost = score !== undefined && scoreToBoost ? scoreToBoost(score, item, i) : undefined;
    return boost === undefined ? { id: input.getId(item) } : { id: input.getId(item), boost };
  });

  return {
    armId: input.armId,
    weight: input.weight,
    ranked,
  };
}
