import { writeFile } from "node:fs/promises";
import path from "node:path";
import { isRenderable, validateConcept, type Catalogue, type Concept } from "@au/schemas";
import { selectDiverse } from "../providers/select";
import type { Critique, StoryModel } from "../providers/types";

export interface ConceptsResult {
  concepts: (Concept & { needsConfirmation: string[] })[];
  rejected: { id: string; title: string; reason: string }[];
  candidateCount: number;
  model: string;
}

export const generateConcepts = async (
  catalogue: Catalogue,
  projectContext: string,
  story: StoryModel,
  workDir: string,
  candidateCount = 10,
): Promise<ConceptsResult> => {
  const candidates = await story.generateConcepts({ catalogue, projectContext, candidateCount });
  process.stderr.write(`  planner returned ${candidates.length} candidates\n`);

  const rejected: ConceptsResult["rejected"] = [];
  const grounded: Concept[] = [];
  const flags = new Map<string, string[]>();

  for (const concept of candidates) {
    const validation = validateConcept(concept, catalogue);
    if (validation.ok) {
      grounded.push(concept);
      continue;
    }
    if (isRenderable(validation)) {
      // Unsupported claims are confirmable, not fatal — the idea may be good and the
      // fact merely missing from the catalogue. It is shown badged.
      flags.set(concept.id, validation.issues.map((i) => i.message));
      grounded.push(concept);
      continue;
    }
    rejected.push({
      id: concept.id,
      title: concept.title,
      reason: validation.issues.map((i) => `${i.code} ${i.path}`).join(", "),
    });
  }

  if (rejected.length > 0) {
    process.stderr.write(`  ${rejected.length} rejected for invalid references\n`);
  }

  let critiques: Critique[] = [];
  if (grounded.length > 0) {
    critiques = await story.critiqueConcepts(grounded, catalogue);
    const culled = critiques.filter((c) => !c.keep).length;
    process.stderr.write(`  critic kept ${critiques.length - culled} of ${critiques.length}\n`);
  }

  const selected = selectDiverse(grounded, critiques);

  const result: ConceptsResult = {
    concepts: selected.map((c) => ({ ...c, needsConfirmation: flags.get(c.id) ?? [] })),
    rejected,
    candidateCount: candidates.length,
    model: story.name,
  };
  await writeFile(path.join(workDir, "concepts.json"), JSON.stringify(result, null, 2), "utf8");
  return result;
};

/**
 * Turn a chosen concept into a manifest.
 *
 * Deliberately deterministic rather than a second model call: the concept already names
 * its shots, moments and durations, so laying them onto a timeline is arithmetic. A model
 * here would only add a chance of inventing a range.
 */
export const conceptToManifest = (
  concept: Concept,
  catalogue: Catalogue,
  canvas = { width: 1080, height: 1920, fps: 30 },
) => {
  const shots = new Map(catalogue.shots.map((s) => [s.id, s]));
  const segments = [];
  let timelineInMs = 0;

  for (const [index, beat] of concept.structure.entries()) {
    const shot = shots.get(beat.shotId);
    if (!shot) continue;

    const moment = beat.momentIndex !== null ? shot.moments[beat.momentIndex] : undefined;
    const sourceInMs = moment?.startMs ?? shot.startMs;
    // The beat's suggested length wins, but never beyond what the source actually holds.
    const available = (moment?.endMs ?? shot.endMs) - sourceInMs;
    const sourceOutMs = sourceInMs + Math.min(beat.suggestedMs, available);
    if (sourceOutMs <= sourceInMs) continue;

    const hint = shot.cropHint;
    segments.push({
      id: `seg_${String(index + 1).padStart(3, "0")}`,
      assetId: shot.assetId,
      shotId: shot.id,
      sourceInMs,
      sourceOutMs,
      timelineInMs,
      role: beat.role,
      crop: hint
        ? { mode: "smart_9x16" as const, focus: [hint.focusX, hint.focusY] as [number, number] }
        : { mode: "fit_blur_background" as const },
      sourceAudioDb: beat.role === "hook" ? -12 : -6,
    });
    timelineInMs += sourceOutMs - sourceInMs;
  }

  return {
    version: 1 as const,
    canvas,
    durationMs: timelineInMs,
    segments,
    overlays: concept.hook.overlayText
      ? [{ text: concept.hook.overlayText, startMs: 120, endMs: Math.min(2_700, timelineInMs), preset: "hook" }]
      : [],
    captions: { enabled: true, preset: "au_default" },
    music: { mode: "none" as const },
  };
};
