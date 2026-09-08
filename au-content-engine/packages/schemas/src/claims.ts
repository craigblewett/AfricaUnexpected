/**
 * Claim detection for grounding.
 *
 * The PRD forbids stating a price, distance or location as fact unless it came from
 * verified data. Detection is deliberately over-eager: a false positive costs a
 * "Needs confirmation" badge, a false negative puts a wrong price on a published Reel.
 *
 * This flags claims for checking. It never decides a claim is true.
 */

export type ClaimKind = "currency" | "distance" | "travel_time" | "superlative";

export interface DetectedClaim {
  kind: ClaimKind;
  text: string;
  index: number;
}

interface Pattern {
  kind: ClaimKind;
  re: RegExp;
}

/**
 * ZAR is written R950, R1 200 and R1,200 interchangeably in South African copy, so the
 * currency pattern tolerates both separators and an optional decimal.
 */
const PATTERNS: readonly Pattern[] = [
  {
    kind: "currency",
    re: /(?:R|ZAR|US\$|\$|£|€)\s?\d{1,3}(?:[ ,]\d{3})*(?:\.\d{2})?\b/gi,
  },
  {
    kind: "distance",
    re: /\b\d+(?:\.\d+)?\s?(?:km|kilometres?|kilometers?|m|metres?|meters?|miles?|mi)\b/gi,
  },
  {
    kind: "travel_time",
    re: /\b(?:less than|under|just|only|about|around)?\s?\d+(?:\.\d+)?\s?(?:min(?:ute)?s?|hours?|hrs?)\b/gi,
  },
  {
    kind: "superlative",
    re: /\b(?:cheapest|most expensive|best|worst|biggest|largest|smallest|highest|lowest|oldest|newest|closest|nearest|first|last|only)\b/gi,
  },
];

export const detectClaims = (text: string): DetectedClaim[] => {
  const found: DetectedClaim[] = [];

  for (const { kind, re } of PATTERNS) {
    // Each pattern is global, so reset lastIndex — the literals are module-level and shared.
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      found.push({ kind, text: match[0].trim(), index: match.index });
    }
  }

  return found.sort((a, b) => a.index - b.index);
};

/** Normalise for comparison: case, whitespace and thousands separators all vary in copy. */
const normalise = (s: string): string =>
  s.toLowerCase().replace(/[\s,]/g, "").replace(/\.00$/, "");

/**
 * A claim counts as substantiated when its text appears in a verified fact's value.
 * Substring rather than equality because a fact reads "R950 per night" while the
 * overlay says "R950".
 */
export const isSubstantiated = (
  claim: DetectedClaim,
  factValues: readonly string[],
): boolean => {
  const needle = normalise(claim.text);
  return factValues.some((v) => normalise(v).includes(needle));
};

export const unsubstantiatedClaims = (
  text: string,
  factValues: readonly string[],
): DetectedClaim[] =>
  detectClaims(text).filter((c) => !isSubstantiated(c, factValues));
