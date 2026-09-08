import { describe, expect, it } from "vitest";
import {
  clampTo,
  contains,
  durationOf,
  findContiguityBreaks,
  isWellFormed,
  overlaps,
  totalDuration,
} from "../src/time";

describe("durationOf", () => {
  it("measures the range", () => {
    expect(durationOf({ startMs: 1_000, endMs: 2_500 })).toBe(1_500);
  });
});

describe("contains", () => {
  const shot = { startMs: 10_000, endMs: 18_000 };

  it("accepts a range inside", () => {
    expect(contains(shot, { startMs: 12_400, endMs: 13_950 })).toBe(true);
  });

  it("accepts a range flush with both boundaries", () => {
    expect(contains(shot, shot)).toBe(true);
  });

  it("rejects a range starting before", () => {
    expect(contains(shot, { startMs: 9_999, endMs: 12_000 })).toBe(false);
  });

  it("rejects a range ending after", () => {
    expect(contains(shot, { startMs: 12_000, endMs: 18_001 })).toBe(false);
  });
});

describe("overlaps", () => {
  it("treats abutting ranges as not overlapping", () => {
    expect(
      overlaps({ startMs: 0, endMs: 1_000 }, { startMs: 1_000, endMs: 2_000 }),
    ).toBe(false);
  });

  it("detects a one-millisecond intersection", () => {
    expect(
      overlaps({ startMs: 0, endMs: 1_001 }, { startMs: 1_000, endMs: 2_000 }),
    ).toBe(true);
  });
});

describe("isWellFormed", () => {
  it.each([
    [{ startMs: 0, endMs: 1 }, true],
    [{ startMs: 5, endMs: 5 }, false],
    [{ startMs: 5, endMs: 4 }, false],
    [{ startMs: -1, endMs: 10 }, false],
    [{ startMs: 0.5, endMs: 10 }, false],
  ])("%o -> %s", (range, expected) => {
    expect(isWellFormed(range)).toBe(expected);
  });
});

describe("clampTo", () => {
  it("trims to the bounds", () => {
    expect(
      clampTo({ startMs: 0, endMs: 5_000 }, { startMs: 1_000, endMs: 3_000 }),
    ).toEqual({ startMs: 1_000, endMs: 3_000 });
  });

  it("returns null when the ranges do not meet", () => {
    expect(
      clampTo({ startMs: 0, endMs: 500 }, { startMs: 1_000, endMs: 3_000 }),
    ).toBeNull();
  });
});

describe("findContiguityBreaks", () => {
  it("passes a gapless timeline", () => {
    expect(
      findContiguityBreaks([
        { startMs: 0, endMs: 1_550 },
        { startMs: 1_550, endMs: 5_550 },
      ]),
    ).toEqual([]);
  });

  it("reports a timeline that does not start at zero", () => {
    const [first] = findContiguityBreaks([{ startMs: 40, endMs: 1_000 }]);
    expect(first).toMatchObject({ index: 0, kind: "not-at-zero", expectedMs: 0, actualMs: 40 });
  });

  it("reports a gap between segments", () => {
    const [first] = findContiguityBreaks([
      { startMs: 0, endMs: 1_000 },
      { startMs: 1_200, endMs: 2_000 },
    ]);
    expect(first).toMatchObject({ index: 1, kind: "gap", expectedMs: 1_000, actualMs: 1_200 });
  });

  it("reports an overlap between segments", () => {
    const [first] = findContiguityBreaks([
      { startMs: 0, endMs: 1_000 },
      { startMs: 900, endMs: 2_000 },
    ]);
    expect(first).toMatchObject({ index: 1, kind: "overlap" });
  });
});

describe("totalDuration", () => {
  it("sums the ranges", () => {
    expect(
      totalDuration([
        { startMs: 0, endMs: 1_550 },
        { startMs: 1_550, endMs: 5_550 },
      ]),
    ).toBe(5_550);
  });
});
