import type { Catalogue } from "../src/catalogue";
import type { ReelManifest, Segment } from "../src/manifest";

/**
 * A miniature Cederberg project: one drone asset and one handheld asset, the shape of
 * source the PRD's §3.2 describes. Small enough to reason about in a failing test.
 */
export const catalogue: Catalogue = {
  assets: [
    {
      id: "ast_drone",
      filename: "DJI_0042.MP4",
      durationMs: 30_000,
      width: 3840,
      height: 2160,
      fps: 30,
      rotation: 0,
      hasAudio: false,
      checksum: "aaa",
    },
    {
      id: "ast_phone",
      filename: "IMG_1181.MOV",
      durationMs: 20_000,
      width: 1080,
      height: 1920,
      fps: 60,
      rotation: 0,
      hasAudio: true,
      checksum: "bbb",
    },
  ],
  shots: [
    {
      id: "sht_reveal",
      assetId: "ast_drone",
      startMs: 10_000,
      endMs: 18_000,
      visualDescription: "Drone rises over a ridge to reveal a cabin below.",
      subjects: ["cabin", "mountain"],
      settingTags: ["outdoor", "accommodation"],
      shotType: "drone",
      cameraMotion: "drone_rise",
      noveltyScore: 0.9,
      storyRoles: ["hook", "reveal"],
      cropHint: { focusX: 0.58, focusY: 0.44, confidence: 0.8 },
      moments: [
        { startMs: 12_400, endMs: 13_950, role: "reveal", why: "cabin enters frame", strength: 0.93 },
      ],
      requiresFactCheck: false,
    },
    {
      id: "sht_interior",
      assetId: "ast_phone",
      startMs: 2_000,
      endMs: 9_000,
      visualDescription: "Interior pan across a wood-panelled room.",
      subjects: ["interior"],
      settingTags: ["indoor", "accommodation"],
      shotType: "medium_wide",
      cameraMotion: "handheld_pan",
      noveltyScore: 0.4,
      storyRoles: ["payoff"],
      cropHint: null,
      moments: [],
      requiresFactCheck: false,
    },
  ],
  verifiedFacts: [
    { key: "price", value: "R950 per night", source: "au_hotels", sourceRef: "au_hotels:17" },
    { key: "region", value: "Cederberg", source: "au_regions", sourceRef: "au_regions:4" },
  ],
};

export const segment = (over: Partial<Segment> = {}): Segment => ({
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

/** Two contiguous segments totalling 5,550ms. */
export const manifest = (over: Partial<ReelManifest> = {}): ReelManifest => {
  const segments = over.segments ?? [
    segment(),
    segment({
      id: "seg_002",
      assetId: "ast_phone",
      shotId: "sht_interior",
      sourceInMs: 3_000,
      sourceOutMs: 7_000,
      timelineInMs: 1_550,
      role: "payoff",
      crop: { mode: "fit_blur_background" },
    }),
  ];
  return {
    version: 1,
    canvas: { width: 1080, height: 1920, fps: 30 },
    durationMs: 5_550,
    segments,
    overlays: [],
    captions: { enabled: true, preset: "au_default" },
    music: { mode: "none" },
    ...over,
  };
};
