import type { Asset, Catalogue, Concept, Shot, TimeRange } from "@au/schemas";

/**
 * Provider interfaces.
 *
 * Nothing outside this folder imports a vendor SDK. The PRD's rule is that no vendor
 * model name appears in domain logic; the house rule is that every AI call goes through
 * one router. These interfaces are where both are enforced.
 */

export interface ShotDetector {
  readonly name: string;
  /** Scene-change timestamps in milliseconds, relative to the start of the asset. */
  detect(videoPath: string, durationMs: number): Promise<number[]>;
}

export interface ShotAnalysisRequest {
  proxyPath: string;
  asset: Asset;
  range: TimeRange;
  /** Facts the model may state. Anything absent here must not be asserted. */
  verifiedFacts: readonly string[];
  projectContext: string;
}

export interface VideoUnderstandingProvider {
  readonly name: string;
  analyse(request: ShotAnalysisRequest): Promise<Omit<Shot, "id" | "assetId" | "startMs" | "endMs">>;
}

export interface ConceptRequest {
  catalogue: Catalogue;
  projectContext: string;
  /** Candidates to generate before critique. The PRD asks for 8-12. */
  candidateCount: number;
}

export interface Critique {
  conceptId: string;
  scores: { hook: number; visualSupport: number; coherence: number; distinctness: number; grounding: number };
  weaknesses: string[];
  keep: boolean;
}

export interface StoryModel {
  readonly name: string;
  generateConcepts(request: ConceptRequest): Promise<Concept[]>;
  critiqueConcepts(concepts: readonly Concept[], catalogue: Catalogue): Promise<Critique[]>;
}

export interface UsageRecord {
  provider: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

/**
 * Spend is recorded per call rather than logged, because the production system caps
 * monthly cost and cannot do that from log lines.
 */
export interface UsageSink {
  record(usage: UsageRecord): void;
}

export const collectUsage = (): UsageSink & { all(): UsageRecord[]; totalUsd(): number } => {
  const records: UsageRecord[] = [];
  return {
    record: (u) => records.push(u),
    all: () => [...records],
    totalUsd: () => records.reduce((sum, r) => sum + r.costUsd, 0),
  };
};
