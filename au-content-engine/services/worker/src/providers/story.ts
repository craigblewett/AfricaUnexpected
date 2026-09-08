import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { ConceptSchema, type Catalogue, type Concept } from "@au/schemas";
import { MODELS, costOf } from "./model-config";
import type { ConceptRequest, Critique, StoryModel, UsageSink } from "./types";

export const PLANNER_PROMPT_VERSION = "concept-planner.v1";
export const CRITIC_PROMPT_VERSION = "concept-critic.v1";

/**
 * Two passes, deliberately.
 *
 * Asking one model for five concepts reliably produces five wordings of one idea. The
 * planner is asked for many candidates and told to diversify; a separate critic pass,
 * which has not seen its own reasoning, scores and culls them.
 */

const CandidatesSchema = z.object({
  concepts: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      angleType: z.enum([
        "location_disbelief", "price_value", "hidden_discovery", "unexpected_wildlife",
        "problem_failure", "before_reveal", "human_reaction", "cinematic_atmosphere",
        "question_participation",
      ]),
      hook: z.object({ overlayText: z.string(), openingShotId: z.string() }),
      targetDurationMs: z.number().int().positive(),
      structure: z.array(
        z.object({
          role: z.string(),
          shotId: z.string(),
          momentIndex: z.number().int().min(0).nullable(),
          suggestedMs: z.number().int().positive(),
        }),
      ).min(2),
      strengthScore: z.object({
        hook: z.number().min(0).max(25),
        visualNovelty: z.number().min(0).max(20),
        storyPayoff: z.number().min(0).max(20),
        pacing: z.number().min(0).max(15),
        clarity: z.number().min(0).max(10),
        brandFit: z.number().min(0).max(10),
      }),
      why: z.string(),
    }),
  ),
});

const CritiqueSchema = z.object({
  critiques: z.array(
    z.object({
      conceptId: z.string(),
      scores: z.object({
        hook: z.number().min(0).max(5),
        visualSupport: z.number().min(0).max(5),
        coherence: z.number().min(0).max(5),
        distinctness: z.number().min(0).max(5),
        grounding: z.number().min(0).max(5),
      }),
      weaknesses: z.array(z.string()),
      keep: z.boolean(),
    }),
  ),
});

/** The catalogue is rendered compactly: the model needs shot semantics, not raw metadata. */
const renderCatalogue = (catalogue: Catalogue): string =>
  catalogue.shots
    .map((s) => {
      const moments = s.moments
        .map((m, i) => `      [${i}] ${m.startMs}-${m.endMs}ms ${m.role}: ${m.why} (${m.strength})`)
        .join("\n");
      return [
        `  ${s.id} (${s.assetId}) ${s.startMs}-${s.endMs}ms  ${s.shotType}, ${s.cameraMotion}`,
        `      ${s.visualDescription}`,
        `      subjects: ${s.subjects.join(", ") || "-"} | novelty ${s.noveltyScore} | roles: ${s.storyRoles.join(", ") || "-"}`,
        moments,
      ].filter(Boolean).join("\n");
    })
    .join("\n");

const PLAYBOOK = `
AFRICA UNEXPECTED CREATIVE PLAYBOOK v1
The channel is about discovery in Southern Africa: places, stays and encounters that are
more surprising, closer or stranger than a viewer expects. Recurring angles that work:
- unexpected-location reveal, but only where the location is a verified fact
- price or value curiosity, only where the price is verified and current
- hidden discovery: a beach, campsite, cave, route or stay that reads as a secret
- wildlife proximity: the animal visible immediately, without manufacturing danger
- problem or failure: road, weather, access or a plan that went wrong
- before/reveal: approach, exterior, then the interior or detail that pays it off
- human reaction, where it makes a discovery legible — not forced into every Reel
- cinematic atmosphere, which still needs an opening idea rather than a slow montage
`.trim();

export const geminiStoryModel = (usage: UsageSink): StoryModel => ({
  name: `google:${MODELS.story.id}`,

  async generateConcepts(request: ConceptRequest): Promise<Concept[]> {
    const startedAt = performance.now();
    const validShotIds = request.catalogue.shots.map((s) => s.id);

    const { object, usage: tokens } = await generateObject({
      model: google(MODELS.story.id),
      schema: CandidatesSchema,
      prompt: `
${PLAYBOOK}

SHOT CATALOGUE — the only shots that exist:
${renderCatalogue(request.catalogue)}

VERIFIED FACTS — the only facts that may be stated:
${request.catalogue.verifiedFacts.map((f) => `- ${f.key}: ${f.value}`).join("\n") || "(none)"}

PROJECT CONTEXT:
${request.projectContext || "(none supplied)"}

TASK
Produce ${request.candidateCount} candidate Reel concepts.

HARD RULES
- Every shotId must come from this list: ${validShotIds.join(", ")}
- momentIndex refers to that shot's moments array, or null.
- Never state a location, price, distance or travel time that is not in VERIFIED FACTS.
- Every concept needs a payoff. A montage is not a concept.
- Do not predict views. strengthScore is a creative judgement, not a forecast.

DIVERSITY REQUIREMENT
No more than two candidates may share an angleType. Vary the hook, the structure and
the emotional frame — not merely the wording.
`.trim(),
    });

    const inputTokens = tokens?.inputTokens ?? 0;
    const outputTokens = tokens?.outputTokens ?? 0;
    usage.record({
      provider: "google", model: MODELS.story.id, promptVersion: PLANNER_PROMPT_VERSION,
      inputTokens, outputTokens,
      costUsd: costOf(MODELS.story, inputTokens, outputTokens),
      latencyMs: Math.round(performance.now() - startedAt),
    });

    // verificationFlags is populated by the validator, never by the planner — a model
    // must not be able to clear its own grounding flags.
    return object.concepts.map((c) => ConceptSchema.parse({ ...c, verificationFlags: [] }));
  },

  async critiqueConcepts(concepts, catalogue): Promise<Critique[]> {
    const startedAt = performance.now();

    const { object, usage: tokens } = await generateObject({
      model: google(MODELS.story.id),
      schema: CritiqueSchema,
      prompt: `
You are an adversarial critic. You did not write these concepts and you are not trying
to be encouraging. Africa Unexpected will only shoot and post a handful of Reels, so a
weak concept surviving costs more than a good one being cut.

SHOT CATALOGUE:
${renderCatalogue(catalogue)}

CONCEPTS:
${JSON.stringify(concepts.map(({ id, title, angleType, hook, structure, why }) => ({ id, title, angleType, hook, structure, why })), null, 2)}

Score each 0-5 on:
- hook: would the first second create curiosity, without invented context?
- visualSupport: are these genuinely the strongest available shots for this idea?
- coherence: setup, progression and payoff — or just ordered highlights?
- distinctness: materially different from the other candidates, or a rewording?
- grounding: does it depend on any fact the catalogue does not support?

Set keep=false for anything repetitive, ungrounded, or that resolves into "hidden gem"
with no specific idea. Expect to reject most of them.
`.trim(),
    });

    const inputTokens = tokens?.inputTokens ?? 0;
    const outputTokens = tokens?.outputTokens ?? 0;
    usage.record({
      provider: "google", model: MODELS.story.id, promptVersion: CRITIC_PROMPT_VERSION,
      inputTokens, outputTokens,
      costUsd: costOf(MODELS.story, inputTokens, outputTokens),
      latencyMs: Math.round(performance.now() - startedAt),
    });

    return object.critiques;
  },
});
