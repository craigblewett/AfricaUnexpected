import { z } from "zod";

const Ms = z.number().int().min(0);
const UnitInterval = z.number().min(0).max(1);

export const CropSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("smart_9x16"), focus: z.tuple([UnitInterval, UnitInterval]) }),
  z.object({ mode: z.literal("manual_focus"), focus: z.tuple([UnitInterval, UnitInterval]) }),
  z.object({ mode: z.literal("fit_blur_background") }),
]);

export const SegmentSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  /** Optional, but when present the source range must sit inside this shot. */
  shotId: z.string().min(1).nullable().default(null),
  sourceInMs: Ms,
  sourceOutMs: Ms,
  timelineInMs: Ms,
  role: z.string().min(1),
  crop: CropSchema,
  /** Gain in dB. Negative attenuates; the renderer never hard-clips. */
  sourceAudioDb: z.number().min(-60).max(0).default(0),
});

export const OverlaySchema = z.object({
  text: z.string().min(1),
  startMs: Ms,
  endMs: Ms,
  preset: z.string().min(1),
});

export const ReelManifestSchema = z.object({
  version: z.literal(1),
  canvas: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
  }),
  durationMs: z.number().int().positive(),
  segments: z.array(SegmentSchema).min(1),
  overlays: z.array(OverlaySchema).default([]),
  captions: z.object({
    enabled: z.boolean(),
    preset: z.string().min(1),
  }),
  music: z.object({ mode: z.enum(["none", "licensed"]) }).default({ mode: "none" }),
});

export type Segment = z.infer<typeof SegmentSchema>;
export type Overlay = z.infer<typeof OverlaySchema>;
export type ReelManifest = z.infer<typeof ReelManifestSchema>;

/** The timeline range a segment occupies, derived from its source duration. */
export const timelineRangeOf = (s: Segment) => ({
  startMs: s.timelineInMs,
  endMs: s.timelineInMs + (s.sourceOutMs - s.sourceInMs),
});
