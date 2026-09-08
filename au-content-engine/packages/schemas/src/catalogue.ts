import { z } from "zod";

/** Integer milliseconds, never negative. Reused everywhere a source time appears. */
const Ms = z.number().int().min(0);

const UnitInterval = z.number().min(0).max(1);

/**
 * A candidate beat inside a shot.
 *
 * Scene detection returns shot boundaries, but a shot can run eight seconds while the
 * beat worth cutting is the 1.2s where the animal turns. Without moments the edit
 * planner can only choose whole shots, and pacing is capped by the detector.
 */
export const MomentSchema = z.object({
  startMs: Ms,
  endMs: Ms,
  role: z.enum([
    "hook",
    "setup",
    "context",
    "proof",
    "transition",
    "reveal",
    "reaction",
    "payoff",
    "cta",
  ]),
  why: z.string().min(1),
  strength: UnitInterval,
});

export const CropHintSchema = z.object({
  focusX: UnitInterval,
  focusY: UnitInterval,
  confidence: UnitInterval,
});

export const ShotSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  startMs: Ms,
  endMs: Ms,
  visualDescription: z.string().default(""),
  subjects: z.array(z.string()).default([]),
  settingTags: z.array(z.string()).default([]),
  shotType: z.string().default("unknown"),
  cameraMotion: z.string().default("unknown"),
  noveltyScore: UnitInterval.default(0),
  storyRoles: z.array(z.string()).default([]),
  cropHint: CropHintSchema.nullable().default(null),
  moments: z.array(MomentSchema).default([]),
  requiresFactCheck: z.boolean().default(false),
});

export const AssetSchema = z.object({
  id: z.string().min(1),
  filename: z.string().min(1),
  durationMs: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  hasAudio: z.boolean(),
  checksum: z.string().min(1),
});

/**
 * A verified fact is a claim the system is allowed to state, carried with its origin
 * so the planner can be told where it came from and a reviewer can check it.
 */
export const VerifiedFactSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
  source: z.enum(["au_hotels", "au_regions", "au_posts", "transcript", "user"]),
  sourceRef: z.string().min(1),
});

export type Moment = z.infer<typeof MomentSchema>;
export type Shot = z.infer<typeof ShotSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type VerifiedFact = z.infer<typeof VerifiedFactSchema>;

export interface Catalogue {
  assets: readonly Asset[];
  shots: readonly Shot[];
  verifiedFacts: readonly VerifiedFact[];
}
