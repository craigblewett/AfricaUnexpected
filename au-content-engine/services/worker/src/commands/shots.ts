import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ShotSchema, type Shot, type VerifiedFact } from "@au/schemas";
import { validateShotMoments } from "@au/schemas";
import { extractFrame } from "../ffmpeg";
import { buildShotRanges, keyframeTimes } from "../shots";
import type { IngestResult } from "./ingest";
import type { ShotDetector, VideoUnderstandingProvider } from "../providers/types";

export interface ShotsResult {
  shots: Shot[];
  detector: string;
  analyser: string;
  /** Raw boundaries per asset, kept so the spike can score the detector against hand marks. */
  rawBoundaries: Record<string, number[]>;
}

export const buildShots = async (
  ingested: IngestResult,
  workDir: string,
  detector: ShotDetector,
  analyser: VideoUnderstandingProvider,
  verifiedFacts: readonly VerifiedFact[],
  projectContext: string,
): Promise<ShotsResult> => {
  const frameDir = path.join(workDir, "keyframes");
  await mkdir(frameDir, { recursive: true });

  const shots: Shot[] = [];
  const rawBoundaries: Record<string, number[]> = {};
  const factStrings = verifiedFacts.map((f) => `${f.key}: ${f.value}`);

  for (const asset of ingested.assets) {
    const proxyPath = ingested.proxyPaths[asset.id]!;
    const boundaries = await detector.detect(proxyPath, asset.durationMs);
    rawBoundaries[asset.id] = boundaries;

    const ranges = buildShotRanges(boundaries, asset.durationMs);
    process.stderr.write(`  ${asset.filename}: ${boundaries.length} cuts -> ${ranges.length} shots\n`);

    for (const [index, range] of ranges.entries()) {
      const id = `sht_${asset.id.slice(4)}_${String(index).padStart(3, "0")}`;

      for (const [k, atMs] of keyframeTimes(range).entries()) {
        await extractFrame(proxyPath, atMs, path.join(frameDir, `${id}_${k}.jpg`));
      }

      const analysis = await analyser.analyse({
        proxyPath,
        asset,
        range,
        verifiedFacts: factStrings,
        projectContext,
      });

      const shot = ShotSchema.parse({ id, assetId: asset.id, ...range, ...analysis });

      // The model was clamped already; this asserts the invariant rather than trusting it.
      const issues = validateShotMoments(shot);
      if (issues.length > 0) {
        process.stderr.write(`  WARNING ${id}: ${issues.map((i) => i.message).join("; ")}\n`);
        shot.moments = [];
      }

      shots.push(shot);
    }
  }

  const result: ShotsResult = { shots, detector: detector.name, analyser: analyser.name, rawBoundaries };
  await writeFile(path.join(workDir, "shots.json"), JSON.stringify(result, null, 2), "utf8");
  return result;
};
