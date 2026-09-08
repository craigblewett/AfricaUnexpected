import type { Catalogue, Shot } from "./catalogue";
import type { Concept } from "./concept";
import { scoreTotal } from "./concept";
import { type ReelManifest, timelineRangeOf } from "./manifest";
import { unsubstantiatedClaims } from "./claims";
import { contains, findContiguityBreaks, isWellFormed, totalDuration } from "./time";

/**
 * Grounding validation — the half of the trust boundary Zod cannot express.
 *
 * Zod proves a payload has the right shape. Only the catalogue can prove the shot IDs
 * are real, the ranges are executable and the claims are backed. Both must pass before
 * anything reaches the renderer, and nothing here ever repairs a payload: an invalid
 * plan is rejected so the model is corrected rather than silently patched.
 */

export type IssueCode =
  | "UNKNOWN_ASSET"
  | "UNKNOWN_SHOT"
  | "SHOT_ASSET_MISMATCH"
  | "INVERTED_RANGE"
  | "RANGE_OUTSIDE_ASSET"
  | "RANGE_OUTSIDE_SHOT"
  | "MOMENT_OUTSIDE_SHOT"
  | "UNKNOWN_MOMENT"
  | "TIMELINE_GAP"
  | "TIMELINE_OVERLAP"
  | "TIMELINE_NOT_AT_ZERO"
  | "DURATION_MISMATCH"
  | "OVERLAY_OUT_OF_BOUNDS"
  | "UNSUPPORTED_CLAIM"
  | "SCORE_OUT_OF_RANGE";

export interface ValidationIssue {
  code: IssueCode;
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const result = (issues: ValidationIssue[]): ValidationResult => ({
  ok: issues.length === 0,
  issues,
});

const indexBy = <T extends { id: string }>(xs: readonly T[]): Map<string, T> =>
  new Map(xs.map((x) => [x.id, x]));

export const validateShotMoments = (shot: Shot): ValidationIssue[] =>
  shot.moments.flatMap((m, i) =>
    contains(shot, m)
      ? []
      : [
          {
            code: "MOMENT_OUTSIDE_SHOT" as const,
            path: `shots.${shot.id}.moments[${i}]`,
            message: `Moment ${m.startMs}-${m.endMs}ms falls outside shot ${shot.startMs}-${shot.endMs}ms.`,
          },
        ],
  );

export const validateManifest = (
  manifest: ReelManifest,
  catalogue: Catalogue,
): ValidationResult => {
  const issues: ValidationIssue[] = [];
  const assets = indexBy(catalogue.assets);
  const shots = indexBy(catalogue.shots);

  manifest.segments.forEach((seg, i) => {
    const path = `segments[${i}]`;
    const source = { startMs: seg.sourceInMs, endMs: seg.sourceOutMs };

    if (!isWellFormed(source)) {
      issues.push({
        code: "INVERTED_RANGE",
        path,
        message: `Source range ${seg.sourceInMs}-${seg.sourceOutMs}ms is not a positive integer range.`,
      });
      return; // Every downstream check would be meaningless on a malformed range.
    }

    const asset = assets.get(seg.assetId);
    if (!asset) {
      issues.push({
        code: "UNKNOWN_ASSET",
        path,
        message: `Asset "${seg.assetId}" is not in the catalogue.`,
      });
      return;
    }

    if (!contains({ startMs: 0, endMs: asset.durationMs }, source)) {
      issues.push({
        code: "RANGE_OUTSIDE_ASSET",
        path,
        message: `Source range ${seg.sourceInMs}-${seg.sourceOutMs}ms exceeds asset duration ${asset.durationMs}ms.`,
      });
    }

    if (seg.shotId !== null) {
      const shot = shots.get(seg.shotId);
      if (!shot) {
        issues.push({
          code: "UNKNOWN_SHOT",
          path,
          message: `Shot "${seg.shotId}" is not in the catalogue.`,
        });
      } else if (shot.assetId !== seg.assetId) {
        issues.push({
          code: "SHOT_ASSET_MISMATCH",
          path,
          message: `Shot "${seg.shotId}" belongs to asset "${shot.assetId}", not "${seg.assetId}".`,
        });
      } else if (!contains(shot, source)) {
        issues.push({
          code: "RANGE_OUTSIDE_SHOT",
          path,
          message: `Source range ${seg.sourceInMs}-${seg.sourceOutMs}ms falls outside shot ${shot.startMs}-${shot.endMs}ms.`,
        });
      }
    }
  });

  const timeline = manifest.segments.map(timelineRangeOf);
  for (const b of findContiguityBreaks(timeline)) {
    const code =
      b.kind === "gap"
        ? "TIMELINE_GAP"
        : b.kind === "overlap"
          ? "TIMELINE_OVERLAP"
          : "TIMELINE_NOT_AT_ZERO";
    issues.push({
      code,
      path: `segments[${b.index}].timelineInMs`,
      message: `Expected timeline position ${b.expectedMs}ms, found ${b.actualMs}ms.`,
    });
  }

  const declared = manifest.durationMs;
  const actual = totalDuration(timeline);
  if (declared !== actual) {
    issues.push({
      code: "DURATION_MISMATCH",
      path: "durationMs",
      message: `Manifest declares ${declared}ms but its segments total ${actual}ms.`,
    });
  }

  const factValues = catalogue.verifiedFacts.map((f) => f.value);
  manifest.overlays.forEach((o, i) => {
    if (!isWellFormed(o) || o.endMs > actual) {
      issues.push({
        code: "OVERLAY_OUT_OF_BOUNDS",
        path: `overlays[${i}]`,
        message: `Overlay ${o.startMs}-${o.endMs}ms falls outside the ${actual}ms timeline.`,
      });
    }
    for (const claim of unsubstantiatedClaims(o.text, factValues)) {
      issues.push({
        code: "UNSUPPORTED_CLAIM",
        path: `overlays[${i}].text`,
        message: `"${claim.text}" (${claim.kind}) is not backed by a verified fact.`,
      });
    }
  });

  return result(issues);
};

export const validateConcept = (
  concept: Concept,
  catalogue: Catalogue,
): ValidationResult => {
  const issues: ValidationIssue[] = [];
  const shots = indexBy(catalogue.shots);

  const checkShotRef = (shotId: string, path: string): Shot | undefined => {
    const shot = shots.get(shotId);
    if (!shot) {
      issues.push({
        code: "UNKNOWN_SHOT",
        path,
        message: `Shot "${shotId}" is not in the catalogue.`,
      });
    }
    return shot;
  };

  checkShotRef(concept.hook.openingShotId, "hook.openingShotId");

  concept.structure.forEach((beat, i) => {
    const path = `structure[${i}]`;
    const shot = checkShotRef(beat.shotId, `${path}.shotId`);
    if (shot && beat.momentIndex !== null && !shot.moments[beat.momentIndex]) {
      issues.push({
        code: "UNKNOWN_MOMENT",
        path: `${path}.momentIndex`,
        message: `Shot "${beat.shotId}" has ${shot.moments.length} moments; index ${beat.momentIndex} does not exist.`,
      });
    }
  });

  const total = scoreTotal(concept.strengthScore);
  if (total < 0 || total > 100) {
    issues.push({
      code: "SCORE_OUT_OF_RANGE",
      path: "strengthScore",
      message: `Components total ${total}, which is outside 0-100.`,
    });
  }

  const factValues = catalogue.verifiedFacts.map((f) => f.value);
  for (const claim of unsubstantiatedClaims(concept.hook.overlayText, factValues)) {
    issues.push({
      code: "UNSUPPORTED_CLAIM",
      path: "hook.overlayText",
      message: `"${claim.text}" (${claim.kind}) is not backed by a verified fact.`,
    });
  }

  return result(issues);
};

/**
 * A concept with unsupported claims is shown with a "Needs confirmation" badge rather
 * than discarded — the idea may be good and the fact merely absent from the catalogue.
 * An invalid shot reference is different: that concept is not renderable and is dropped.
 */
export const isRenderable = (r: ValidationResult): boolean =>
  r.issues.every((i) => i.code === "UNSUPPORTED_CLAIM");
