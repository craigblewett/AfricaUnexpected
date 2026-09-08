/**
 * Time-range maths, in integer milliseconds.
 *
 * Milliseconds rather than seconds because floating-point drift across a
 * twenty-cut timeline accumulates into visible frame errors, and every
 * source range eventually becomes an FFmpeg seek argument.
 */

export interface TimeRange {
  startMs: number;
  endMs: number;
}

export const durationOf = (r: TimeRange): number => r.endMs - r.startMs;

/** True when `inner` sits wholly within `outer`. Boundaries are inclusive. */
export const contains = (outer: TimeRange, inner: TimeRange): boolean =>
  inner.startMs >= outer.startMs && inner.endMs <= outer.endMs;

/** Half-open comparison: a range ending exactly where the next begins does not overlap. */
export const overlaps = (a: TimeRange, b: TimeRange): boolean =>
  a.startMs < b.endMs && b.startMs < a.endMs;

export const isWellFormed = (r: TimeRange): boolean =>
  Number.isInteger(r.startMs) &&
  Number.isInteger(r.endMs) &&
  r.startMs >= 0 &&
  r.endMs > r.startMs;

export const totalDuration = (ranges: readonly TimeRange[]): number =>
  ranges.reduce((sum, r) => sum + durationOf(r), 0);

/** Intersect a range with bounds, or null when they do not meet. */
export const clampTo = (r: TimeRange, bounds: TimeRange): TimeRange | null => {
  const startMs = Math.max(r.startMs, bounds.startMs);
  const endMs = Math.min(r.endMs, bounds.endMs);
  return endMs > startMs ? { startMs, endMs } : null;
};

export interface ContiguityBreak {
  index: number;
  kind: "gap" | "overlap" | "not-at-zero";
  expectedMs: number;
  actualMs: number;
}

/**
 * A rendered timeline must be gapless and start at zero — the renderer concatenates
 * segments in order, so a gap silently shortens the Reel and an overlap drops a frame
 * range rather than blending it.
 */
export const findContiguityBreaks = (
  ranges: readonly TimeRange[],
): ContiguityBreak[] => {
  const breaks: ContiguityBreak[] = [];
  let cursor = 0;

  ranges.forEach((r, index) => {
    if (r.startMs !== cursor) {
      const kind =
        index === 0 ? "not-at-zero" : r.startMs > cursor ? "gap" : "overlap";
      breaks.push({ index, kind, expectedMs: cursor, actualMs: r.startMs });
    }
    cursor = Math.max(cursor, r.endMs);
  });

  return breaks;
};
