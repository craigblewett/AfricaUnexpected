import type { TimeRange } from "@au/schemas";

/**
 * Turn scene-change timestamps into shot ranges. Pure, so the boundary logic can be
 * measured against hand-marked truth without running FFmpeg.
 */

/**
 * A "shot" shorter than this is almost always a detector artefact — a flash, a fast pan,
 * or compression noise on drone footage — rather than a real cut, so it is merged back
 * into its predecessor. This threshold is the main lever when tuning against hand marks.
 */
export const MIN_SHOT_MS = 700;

export const buildShotRanges = (
  sceneChangesMs: readonly number[],
  assetDurationMs: number,
  minShotMs = MIN_SHOT_MS,
): TimeRange[] => {
  if (assetDurationMs <= 0) return [];

  const boundaries = [
    ...new Set([
      0,
      ...sceneChangesMs.filter((t) => t > 0 && t < assetDurationMs),
      assetDurationMs,
    ]),
  ].sort((a, b) => a - b);

  const merged: TimeRange[] = [];
  for (let i = 1; i < boundaries.length; i++) {
    const range = { startMs: boundaries[i - 1]!, endMs: boundaries[i]! };
    const previous = merged[merged.length - 1];
    // A sub-threshold fragment extends its predecessor rather than becoming a shot, so
    // the timeline stays gapless and no shot is too short to cut to. This applies to the
    // trailing fragment too, which is the common case: a cut detected near the last second.
    if (previous && range.endMs - range.startMs < minShotMs) {
      previous.endMs = range.endMs;
      continue;
    }
    merged.push(range);
  }

  // A short FIRST shot has no predecessor to join, so it absorbs forward instead.
  if (merged.length > 1 && merged[0]!.endMs - merged[0]!.startMs < minShotMs) {
    merged[1]!.startMs = merged[0]!.startMs;
    merged.shift();
  }

  return merged;
};

/** Sample points for keyframes: a shot needs more than one frame to be judged. */
export const keyframeTimes = (range: TimeRange, count = 3): number[] => {
  const span = range.endMs - range.startMs;
  if (span <= 0) return [];
  return Array.from({ length: count }, (_, i) =>
    Math.round(range.startMs + (span * (i + 1)) / (count + 1)),
  );
};
