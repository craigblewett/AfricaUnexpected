/**
 * Model IDs and prices live here, never in domain logic.
 *
 * Both change often — the PRD is explicit that pricing must be configuration rather than
 * a hardcoded assumption. Verify against the provider's current pricing page before any
 * cost figure is quoted to anyone.
 */
export interface ModelConfig {
  id: string;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
}

export const MODELS = {
  /** Long-video understanding: accepts video directly and returns structured output. */
  videoAnalysis: {
    id: process.env.AU_VIDEO_MODEL ?? "gemini-3-flash",
    inputUsdPerMillionTokens: Number(process.env.AU_VIDEO_IN_PRICE ?? 0.75),
    outputUsdPerMillionTokens: Number(process.env.AU_VIDEO_OUT_PRICE ?? 3.0),
  },
  /** Concept planning and critique: text-only, run over the shot catalogue. */
  story: {
    id: process.env.AU_STORY_MODEL ?? "gemini-3-pro",
    inputUsdPerMillionTokens: Number(process.env.AU_STORY_IN_PRICE ?? 1.25),
    outputUsdPerMillionTokens: Number(process.env.AU_STORY_OUT_PRICE ?? 10.0),
  },
} satisfies Record<string, ModelConfig>;

export const costOf = (
  config: ModelConfig,
  inputTokens: number,
  outputTokens: number,
): number =>
  (inputTokens / 1_000_000) * config.inputUsdPerMillionTokens +
  (outputTokens / 1_000_000) * config.outputUsdPerMillionTokens;
