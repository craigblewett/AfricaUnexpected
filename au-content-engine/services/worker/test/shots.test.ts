import { describe, expect, it } from "vitest";
import { buildShotRanges, keyframeTimes, MIN_SHOT_MS } from "../src/shots";

describe("buildShotRanges", () => {
  it("covers the whole asset when there are no cuts", () => {
    expect(buildShotRanges([], 30_000)).toEqual([{ startMs: 0, endMs: 30_000 }]);
  });

  it("splits at each cut", () => {
    expect(buildShotRanges([5_000, 12_000], 20_000)).toEqual([
      { startMs: 0, endMs: 5_000 },
      { startMs: 5_000, endMs: 12_000 },
      { startMs: 12_000, endMs: 20_000 },
    ]);
  });

  it("absorbs a sub-threshold flash rather than making a shot of it", () => {
    // 5000 and 5200 are 200ms apart — a detector artefact on a fast pan, not a cut.
    const ranges = buildShotRanges([5_000, 5_200, 12_000], 20_000);
    expect(ranges.every((r) => r.endMs - r.startMs >= MIN_SHOT_MS)).toBe(true);
    expect(ranges).toHaveLength(3);
  });

  it("leaves no gaps and no overlaps", () => {
    const ranges = buildShotRanges([1_000, 1_100, 4_000, 4_050, 9_000], 15_000);
    expect(ranges[0]!.startMs).toBe(0);
    expect(ranges[ranges.length - 1]!.endMs).toBe(15_000);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]!.startMs).toBe(ranges[i - 1]!.endMs);
    }
  });

  it("ignores cuts outside the asset", () => {
    const ranges = buildShotRanges([-500, 5_000, 99_000], 10_000);
    expect(ranges).toEqual([
      { startMs: 0, endMs: 5_000 },
      { startMs: 5_000, endMs: 10_000 },
    ]);
  });

  it("extends the final shot rather than leaving a stub", () => {
    const ranges = buildShotRanges([9_800], 10_000);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.endMs).toBe(10_000);
  });

  it("returns nothing for a zero-length asset", () => {
    expect(buildShotRanges([], 0)).toEqual([]);
  });

  it("tolerates unsorted detector output", () => {
    expect(buildShotRanges([12_000, 5_000], 20_000)).toEqual([
      { startMs: 0, endMs: 5_000 },
      { startMs: 5_000, endMs: 12_000 },
      { startMs: 12_000, endMs: 20_000 },
    ]);
  });
});

describe("keyframeTimes", () => {
  it("samples inside the shot, never at its edges", () => {
    const times = keyframeTimes({ startMs: 1_000, endMs: 5_000 }, 3);
    expect(times).toEqual([2_000, 3_000, 4_000]);
    expect(times[0]).toBeGreaterThan(1_000);
    expect(times[times.length - 1]).toBeLessThan(5_000);
  });

  it("returns nothing for an empty range", () => {
    expect(keyframeTimes({ startMs: 100, endMs: 100 })).toEqual([]);
  });
});
