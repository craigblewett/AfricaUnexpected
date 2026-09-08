import { describe, expect, it } from "vitest";
import type { Segment } from "@au/schemas";
import { segmentCacheKey } from "../src/render";

const canvas = { width: 1080, height: 1920, fps: 30 };

const seg = (over: Partial<Segment> = {}): Segment => ({
  id: "seg_001",
  assetId: "ast_drone",
  shotId: "sht_reveal",
  sourceInMs: 12_400,
  sourceOutMs: 13_950,
  timelineInMs: 0,
  role: "hook",
  crop: { mode: "smart_9x16", focus: [0.58, 0.44] },
  sourceAudioDb: -12,
  ...over,
});

describe("segmentCacheKey", () => {
  it("is stable for identical inputs", () => {
    expect(segmentCacheKey(seg(), "aaa", canvas)).toBe(segmentCacheKey(seg(), "aaa", canvas));
  });

  it("changes when the source range changes", () => {
    expect(segmentCacheKey(seg({ sourceOutMs: 14_000 }), "aaa", canvas)).not.toBe(
      segmentCacheKey(seg(), "aaa", canvas),
    );
  });

  it("changes when the crop changes", () => {
    expect(segmentCacheKey(seg({ crop: { mode: "manual_focus", focus: [0.3, 0.5] } }), "aaa", canvas)).not.toBe(
      segmentCacheKey(seg(), "aaa", canvas),
    );
  });

  it("changes when audio gain changes", () => {
    expect(segmentCacheKey(seg({ sourceAudioDb: -6 }), "aaa", canvas)).not.toBe(
      segmentCacheKey(seg(), "aaa", canvas),
    );
  });

  it("changes when the underlying file changes, even at the same times", () => {
    expect(segmentCacheKey(seg(), "bbb", canvas)).not.toBe(segmentCacheKey(seg(), "aaa", canvas));
  });

  it("changes when the renderer version is bumped", () => {
    expect(segmentCacheKey(seg(), "aaa", canvas, "2")).not.toBe(segmentCacheKey(seg(), "aaa", canvas, "1"));
  });

  it("is UNCHANGED when only the timeline position moves — reordering must stay cached", () => {
    expect(segmentCacheKey(seg({ timelineInMs: 9_000 }), "aaa", canvas)).toBe(
      segmentCacheKey(seg(), "aaa", canvas),
    );
  });

  it("is UNCHANGED when only the role label changes", () => {
    expect(segmentCacheKey(seg({ role: "payoff" }), "aaa", canvas)).toBe(
      segmentCacheKey(seg(), "aaa", canvas),
    );
  });

  it("is UNCHANGED by the segment id, so renumbering does not invalidate the cache", () => {
    expect(segmentCacheKey(seg({ id: "seg_007" }), "aaa", canvas)).toBe(
      segmentCacheKey(seg(), "aaa", canvas),
    );
  });
});
