import type { Concept } from "@au/schemas";
import type { Critique } from "./types";

/**
 * The diversity filter. Pure, so the selection rule is testable without a model.
 *
 * The PRD asks for 3-5 concepts that differ in angle rather than wording, and caps any
 * one angle at two. Ranking happens first so that when an angle is capped, it is the
 * weaker duplicate that is dropped.
 */
export const critiqueTotal = (c: Critique): number =>
  c.scores.hook + c.scores.visualSupport + c.scores.coherence + c.scores.distinctness + c.scores.grounding;

export const selectDiverse = (
  concepts: readonly Concept[],
  critiques: readonly Critique[],
  { maxPerAngle = 2, min = 3, max = 5 } = {},
): Concept[] => {
  const byId = new Map(critiques.map((c) => [c.conceptId, c]));

  const ranked = [...concepts]
    .map((concept) => ({ concept, critique: byId.get(concept.id) }))
    .filter((x) => x.critique !== undefined)
    .sort((a, b) => critiqueTotal(b.critique!) - critiqueTotal(a.critique!));

  const take = (pool: typeof ranked): Concept[] => {
    const perAngle = new Map<string, number>();
    const chosen: Concept[] = [];
    for (const { concept } of pool) {
      if (chosen.length >= max) break;
      const used = perAngle.get(concept.angleType) ?? 0;
      if (used >= maxPerAngle) continue;
      perAngle.set(concept.angleType, used + 1);
      chosen.push(concept);
    }
    return chosen;
  };

  const kept = take(ranked.filter((x) => x.critique!.keep));

  // A critic that rejects everything must not return an empty gallery — fall back to the
  // best-ranked candidates and let the user see the critique rather than nothing.
  return kept.length >= min ? kept : take(ranked);
};
