import { describe, expect, it } from "vitest";
import { ReelManifestSchema } from "../src/manifest";
import { ConceptSchema } from "../src/concept";
import { isRenderable, validateConcept, validateManifest, validateShotMoments } from "../src/validate";
import { catalogue, manifest, segment } from "./fixtures";

const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code);

describe("Zod layer", () => {
  it("accepts a well-formed manifest", () => {
    expect(ReelManifestSchema.safeParse(manifest()).success).toBe(true);
  });

  it("rejects a non-integer source time before the validator ever runs", () => {
    const bad = manifest({ segments: [segment({ sourceInMs: 12_400.5 })] });
    expect(ReelManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects positive audio gain, which would clip", () => {
    const bad = manifest({ segments: [segment({ sourceAudioDb: 3 })] });
    expect(ReelManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a crop focus outside the frame", () => {
    const bad = manifest({
      segments: [segment({ crop: { mode: "manual_focus", focus: [1.4, 0.5] } })],
    });
    expect(ReelManifestSchema.safeParse(bad).success).toBe(false);
  });
});

describe("validateManifest", () => {
  it("passes the fixture", () => {
    expect(validateManifest(manifest(), catalogue)).toEqual({ ok: true, issues: [] });
  });

  it("rejects an unknown asset", () => {
    const m = manifest({ segments: [segment({ assetId: "ast_nope", shotId: null })] });
    expect(codes(validateManifest(m, catalogue))).toContain("UNKNOWN_ASSET");
  });

  it("rejects an unknown shot", () => {
    const m = manifest({ segments: [segment({ shotId: "sht_nope" })] });
    expect(codes(validateManifest(m, catalogue))).toContain("UNKNOWN_SHOT");
  });

  it("rejects a shot that belongs to a different asset", () => {
    const m = manifest({
      segments: [segment({ assetId: "ast_phone", shotId: "sht_reveal", sourceInMs: 3_000, sourceOutMs: 4_000 })],
    });
    expect(codes(validateManifest(m, catalogue))).toContain("SHOT_ASSET_MISMATCH");
  });

  it("rejects a source range beyond the asset duration", () => {
    const m = manifest({
      segments: [segment({ shotId: null, sourceInMs: 29_000, sourceOutMs: 31_000 })],
      durationMs: 2_000,
    });
    expect(codes(validateManifest(m, catalogue))).toContain("RANGE_OUTSIDE_ASSET");
  });

  it("rejects a source range that leaves its shot", () => {
    const m = manifest({
      segments: [segment({ sourceInMs: 9_000, sourceOutMs: 11_000 })],
      durationMs: 2_000,
    });
    expect(codes(validateManifest(m, catalogue))).toContain("RANGE_OUTSIDE_SHOT");
  });

  it("reports one issue, not a cascade, for an inverted range", () => {
    const m = manifest({ segments: [segment({ sourceInMs: 5_000, sourceOutMs: 5_000 })] });
    // Zod would normally catch this shape; the validator must still fail safe on its own.
    expect(codes(validateManifest(m, catalogue))).toContain("INVERTED_RANGE");
  });

  it("rejects a gap in the timeline", () => {
    const m = manifest();
    m.segments[1]!.timelineInMs = 2_000;
    expect(codes(validateManifest(m, catalogue))).toContain("TIMELINE_GAP");
  });

  it("rejects an overlap in the timeline", () => {
    const m = manifest();
    m.segments[1]!.timelineInMs = 1_000;
    expect(codes(validateManifest(m, catalogue))).toContain("TIMELINE_OVERLAP");
  });

  it("rejects a declared duration that disagrees with the segments", () => {
    expect(codes(validateManifest(manifest({ durationMs: 9_999 }), catalogue))).toContain(
      "DURATION_MISMATCH",
    );
  });

  it("rejects an overlay running past the end of the Reel", () => {
    const m = manifest({
      overlays: [{ text: "Would you stay here?", startMs: 5_000, endMs: 9_000, preset: "hook" }],
    });
    expect(codes(validateManifest(m, catalogue))).toContain("OVERLAY_OUT_OF_BOUNDS");
  });

  it("passes an overlay whose price matches a verified fact", () => {
    const m = manifest({
      overlays: [{ text: "R950 a night", startMs: 120, endMs: 2_700, preset: "hook" }],
    });
    expect(validateManifest(m, catalogue).ok).toBe(true);
  });

  it("flags an overlay price the catalogue cannot support", () => {
    const m = manifest({
      overlays: [{ text: "R450 a night", startMs: 120, endMs: 2_700, preset: "hook" }],
    });
    expect(codes(validateManifest(m, catalogue))).toContain("UNSUPPORTED_CLAIM");
  });
});

describe("validateConcept", () => {
  const concept = ConceptSchema.parse({
    id: "cpt_001",
    title: "The cabin nobody expects to find here",
    angleType: "hidden_discovery",
    hook: { overlayText: "This one is in the Cederberg", openingShotId: "sht_reveal" },
    targetDurationMs: 17_200,
    structure: [
      { role: "hook", shotId: "sht_reveal", momentIndex: 0, suggestedMs: 1_550 },
      { role: "payoff", shotId: "sht_interior", suggestedMs: 4_000 },
    ],
    strengthScore: { hook: 24, visualNovelty: 20, storyPayoff: 18, pacing: 13, clarity: 7, brandFit: 7 },
    why: "The reveal proves the premise immediately.",
  });

  it("passes a grounded concept", () => {
    expect(validateConcept(concept, catalogue)).toEqual({ ok: true, issues: [] });
  });

  it("rejects a hook pointing at a shot that does not exist", () => {
    const bad = { ...concept, hook: { ...concept.hook, openingShotId: "sht_ghost" } };
    expect(codes(validateConcept(bad, catalogue))).toContain("UNKNOWN_SHOT");
  });

  it("rejects a moment index the shot does not have", () => {
    const bad = {
      ...concept,
      structure: [{ ...concept.structure[0]!, momentIndex: 7 }, concept.structure[1]!],
    };
    expect(codes(validateConcept(bad, catalogue))).toContain("UNKNOWN_MOMENT");
  });

  it("flags an unverified price in the hook", () => {
    const bad = { ...concept, hook: { ...concept.hook, overlayText: "Only R450 a night" } };
    expect(codes(validateConcept(bad, catalogue))).toContain("UNSUPPORTED_CLAIM");
  });
});

describe("isRenderable", () => {
  it("treats an unsupported claim as confirmable rather than fatal", () => {
    expect(isRenderable({ ok: false, issues: [{ code: "UNSUPPORTED_CLAIM", path: "x", message: "" }] })).toBe(true);
  });

  it("treats a bad shot reference as fatal", () => {
    expect(isRenderable({ ok: false, issues: [{ code: "UNKNOWN_SHOT", path: "x", message: "" }] })).toBe(false);
  });
});

describe("validateShotMoments", () => {
  it("passes a moment inside its shot", () => {
    expect(validateShotMoments(catalogue.shots[0]!)).toEqual([]);
  });

  it("rejects a moment that escapes its shot", () => {
    const shot = { ...catalogue.shots[0]!, moments: [{ startMs: 9_000, endMs: 11_000, role: "reveal" as const, why: "x", strength: 0.5 }] };
    expect(validateShotMoments(shot).map((i) => i.code)).toEqual(["MOMENT_OUTSIDE_SHOT"]);
  });
});
