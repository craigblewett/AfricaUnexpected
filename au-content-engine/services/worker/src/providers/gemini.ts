import { readFile } from "node:fs/promises";
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { MODELS, costOf } from "./model-config";
import type { ShotAnalysisRequest, UsageSink, VideoUnderstandingProvider } from "./types";

export const SHOT_ANALYSIS_PROMPT_VERSION = "shot-analysis.v1";

/**
 * The response shape. Passing this to generateObject makes the schema the contract:
 * the model is forced into it and retried on mismatch, so malformed output never
 * reaches the catalogue. This is the same Zod-at-every-boundary rule the web app uses.
 */
const AnalysisSchema = z.object({
  visualDescription: z.string().describe("Only what is visible. No inferred facts."),
  subjects: z.array(z.string()),
  settingTags: z.array(z.string()),
  shotType: z.string(),
  cameraMotion: z.string(),
  noveltyScore: z.number().min(0).max(1),
  storyRoles: z.array(z.string()),
  cropHint: z
    .object({ focusX: z.number().min(0).max(1), focusY: z.number().min(0).max(1), confidence: z.number().min(0).max(1) })
    .nullable(),
  moments: z.array(
    z.object({
      startMs: z.number().int().min(0),
      endMs: z.number().int().min(0),
      role: z.enum(["hook", "setup", "context", "proof", "transition", "reveal", "reaction", "payoff", "cta"]),
      why: z.string(),
      strength: z.number().min(0).max(1),
    }),
  ),
  requiresFactCheck: z.boolean(),
});

const buildPrompt = (r: ShotAnalysisRequest): string => `
You are cataloguing one shot from Africa Unexpected travel footage so it can later be
selected for a short vertical Reel.

SHOT: ${r.range.startMs}ms to ${r.range.endMs}ms of "${r.asset.filename}"
(${r.asset.width}x${r.asset.height}, ${r.asset.hasAudio ? "has audio" : "silent"}).

PROJECT CONTEXT (may be empty):
${r.projectContext || "(none supplied)"}

VERIFIED FACTS — the only facts that may be treated as true:
${r.verifiedFacts.length ? r.verifiedFacts.map((f) => `- ${f}`).join("\n") : "(none)"}

RULES
- Describe evidence, not inference. Say what is visible.
- Never state a location, price, distance or travel time unless it is in VERIFIED FACTS.
  If the shot appears to depend on such a fact, set requiresFactCheck true.
- noveltyScore is how visually unusual this shot is within ordinary travel footage.
- moments are candidate beats INSIDE this shot, in absolute milliseconds within the
  range above. Return the specific seconds worth cutting to, not the whole shot. A shot
  with no standout beat returns an empty array.
- cropHint marks the primary subject for a 9:16 crop, as fractions of the frame.
`.trim();

export const geminiVideoUnderstanding = (usage: UsageSink): VideoUnderstandingProvider => ({
  name: `google:${MODELS.videoAnalysis.id}`,

  async analyse(request) {
    const startedAt = performance.now();

    // Analysis runs against the 720p proxy, not the original — the PRD's cost-control
    // rule, and quality is indistinguishable for shot semantics.
    const video = await readFile(request.proxyPath);

    const { object, usage: tokens } = await generateObject({
      model: google(MODELS.videoAnalysis.id),
      schema: AnalysisSchema,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildPrompt(request) },
            { type: "file", data: video, mediaType: "video/mp4" },
          ],
        },
      ],
    });

    const inputTokens = tokens?.inputTokens ?? 0;
    const outputTokens = tokens?.outputTokens ?? 0;
    usage.record({
      provider: "google",
      model: MODELS.videoAnalysis.id,
      promptVersion: SHOT_ANALYSIS_PROMPT_VERSION,
      inputTokens,
      outputTokens,
      costUsd: costOf(MODELS.videoAnalysis, inputTokens, outputTokens),
      latencyMs: Math.round(performance.now() - startedAt),
    });

    // Moments are clamped to the shot rather than trusted: the model reasons about the
    // clip it was shown, and drifts by a few hundred milliseconds at the edges.
    const moments = object.moments
      .map((m) => ({
        ...m,
        startMs: Math.max(request.range.startMs, Math.min(m.startMs, request.range.endMs)),
        endMs: Math.min(request.range.endMs, Math.max(m.endMs, request.range.startMs)),
      }))
      .filter((m) => m.endMs > m.startMs);

    return { ...object, moments };
  },
});
