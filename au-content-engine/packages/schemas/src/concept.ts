import { z } from "zod";


/**
 * Angle types exist so the diversity filter can reject five variations of one idea.
 * The PRD's rule is at most two candidates sharing a primary angle.
 */
export const AngleTypeSchema = z.enum([
  "location_disbelief",
  "price_value",
  "hidden_discovery",
  "unexpected_wildlife",
  "problem_failure",
  "before_reveal",
  "human_reaction",
  "cinematic_atmosphere",
  "question_participation",
]);

export const StrengthScoreSchema = z.object({
  hook: z.number().min(0).max(25),
  visualNovelty: z.number().min(0).max(20),
  storyPayoff: z.number().min(0).max(20),
  pacing: z.number().min(0).max(15),
  clarity: z.number().min(0).max(10),
  brandFit: z.number().min(0).max(10),
});

export const ConceptBeatSchema = z.object({
  role: z.string().min(1),
  shotId: z.string().min(1),
  /** Index into the shot's `moments`. Null means the planner offered no finer beat. */
  momentIndex: z.number().int().min(0).nullable().default(null),
  suggestedMs: z.number().int().positive(),
});

export const ConceptSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  angleType: AngleTypeSchema,
  hook: z.object({
    overlayText: z.string(),
    openingShotId: z.string().min(1),
  }),
  targetDurationMs: z.number().int().positive(),
  structure: z.array(ConceptBeatSchema).min(2),
  strengthScore: StrengthScoreSchema,
  why: z.string().min(1),
  /** Populated by the validator, not by the model — the model does not get to clear its own flags. */
  verificationFlags: z.array(z.string()).default([]),
});

export type Concept = z.infer<typeof ConceptSchema>;
export type StrengthScore = z.infer<typeof StrengthScoreSchema>;

/**
 * Total is derived, never taken from the model — an LLM asked for components and a
 * total will happily return a total that does not match its own components.
 */
export const scoreTotal = (s: StrengthScore): number =>
  s.hook + s.visualNovelty + s.storyPayoff + s.pacing + s.clarity + s.brandFit;
