#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ReelManifestSchema,
  VerifiedFactSchema,
  validateManifest,
  type Catalogue,
  type VerifiedFact,
} from "@au/schemas";
import { ingest, type IngestResult } from "./commands/ingest";
import { buildShots, type ShotsResult } from "./commands/shots";
import { conceptToManifest, generateConcepts, type ConceptsResult } from "./commands/concepts";
import { ffmpegSceneDetector } from "./providers/ffmpeg-scenes";
import { geminiVideoUnderstanding } from "./providers/gemini";
import { geminiStoryModel } from "./providers/story";
import { collectUsage } from "./providers/types";
import { renderManifest } from "./render";

/**
 * The D1 spike CLI.
 *
 * Its whole purpose is to answer one question before any product surface is built: can a
 * multimodal model produce Reel concepts Craig and Nicky would actually post, from Africa
 * Unexpected's own footage? Four commands, files between them, no database and no queue.
 */

const USAGE = `
au — AU Content Engine spike

  au ingest   <folder> [--work DIR]
  au shots             [--work DIR] [--context TEXT] [--facts FILE] [--threshold N]
  au concepts          [--work DIR] [--context TEXT] [--candidates N]
  au render            [--work DIR] [--pick N] [--out FILE]

Options
  --work DIR        working directory for intermediates (default ./au-work)
  --context TEXT    project context: trip, place, what happened
  --facts FILE      JSON array of {key,value,source,sourceRef} the model may state as fact
  --threshold N     scene-detection sensitivity, 0-1 (default 0.35)
  --candidates N    concepts to generate before critique (default 10)
  --pick N          which concept to render, 1-based (default 1)

Requires ffmpeg and ffprobe on PATH, and GOOGLE_GENERATIVE_AI_API_KEY in the environment.
`.trim();

interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string>;
}

const parseArgs = (argv: readonly string[]): Args => {
  const [command = "", ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token.startsWith("--")) {
      const next = rest[i + 1];
      // A bare flag before another flag is a boolean; anything else consumes a value.
      if (next === undefined || next.startsWith("--")) flags[token.slice(2)] = "true";
      else { flags[token.slice(2)] = next; i++; }
    } else {
      positional.push(token);
    }
  }
  return { command, positional, flags };
};

const readJson = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(file, "utf8")) as T;

const loadFacts = async (file: string | undefined): Promise<VerifiedFact[]> => {
  if (!file) return [];
  const raw = await readJson<unknown[]>(file);
  return raw.map((f) => VerifiedFactSchema.parse(f));
};

const catalogueOf = (shots: ShotsResult, assets: IngestResult, facts: VerifiedFact[]): Catalogue => ({
  assets: assets.assets,
  shots: shots.shots,
  verifiedFacts: facts,
});

const main = async (): Promise<number> => {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  const workDir = path.resolve(flags.work ?? "au-work");
  const context = flags.context ?? "";
  await mkdir(workDir, { recursive: true });

  const usage = collectUsage();
  const reportSpend = () => {
    const total = usage.totalUsd();
    if (total > 0) process.stderr.write(`\n  model spend: $${total.toFixed(4)} across ${usage.all().length} calls\n`);
  };

  switch (command) {
    case "ingest": {
      const folder = positional[0];
      if (!folder) { process.stderr.write("ingest needs a folder\n"); return 2; }
      process.stderr.write(`Ingesting ${folder}\n`);
      const result = await ingest(path.resolve(folder), workDir);
      process.stdout.write(
        `${result.assets.length} assets, ${result.skipped.length} skipped -> ${path.join(workDir, "assets.json")}\n`,
      );
      return 0;
    }

    case "shots": {
      const assets = await readJson<IngestResult>(path.join(workDir, "assets.json"));
      const facts = await loadFacts(flags.facts);
      process.stderr.write(`Detecting and analysing shots across ${assets.assets.length} assets\n`);
      const result = await buildShots(
        assets,
        workDir,
        ffmpegSceneDetector(Number(flags.threshold ?? 0.35)),
        geminiVideoUnderstanding(usage),
        facts,
        context,
      );
      reportSpend();
      process.stdout.write(`${result.shots.length} shots -> ${path.join(workDir, "shots.json")}\n`);
      return 0;
    }

    case "concepts": {
      const [assets, shots, facts] = await Promise.all([
        readJson<IngestResult>(path.join(workDir, "assets.json")),
        readJson<ShotsResult>(path.join(workDir, "shots.json")),
        loadFacts(flags.facts),
      ]);
      const catalogue = catalogueOf(shots, assets, facts);
      process.stderr.write(`Generating concepts from ${catalogue.shots.length} shots\n`);
      const result = await generateConcepts(
        catalogue,
        context,
        geminiStoryModel(usage),
        workDir,
        Number(flags.candidates ?? 10),
      );
      reportSpend();

      process.stdout.write(`\n${result.concepts.length} concepts:\n\n`);
      result.concepts.forEach((c, i) => {
        const score = Object.values(c.strengthScore).reduce((a, b) => a + b, 0);
        process.stdout.write(`  ${i + 1}. [${score}/100] ${c.title}\n`);
        process.stdout.write(`     angle: ${c.angleType} | ${c.structure.length} beats | ${Math.round(c.targetDurationMs / 1000)}s\n`);
        process.stdout.write(`     hook: "${c.hook.overlayText}"\n`);
        if (c.needsConfirmation.length > 0) {
          process.stdout.write(`     NEEDS CONFIRMATION: ${c.needsConfirmation.join("; ")}\n`);
        }
        process.stdout.write("\n");
      });
      return 0;
    }

    case "render": {
      const [assets, shots, concepts, facts] = await Promise.all([
        readJson<IngestResult>(path.join(workDir, "assets.json")),
        readJson<ShotsResult>(path.join(workDir, "shots.json")),
        readJson<ConceptsResult>(path.join(workDir, "concepts.json")),
        loadFacts(flags.facts),
      ]);

      const index = Number(flags.pick ?? 1) - 1;
      const concept = concepts.concepts[index];
      if (!concept) { process.stderr.write(`No concept at position ${index + 1}\n`); return 2; }

      const catalogue = catalogueOf(shots, assets, facts);
      const manifest = ReelManifestSchema.parse(conceptToManifest(concept, catalogue));

      // The trust boundary. Nothing reaches FFmpeg until the plan is proven executable
      // against the real catalogue — not merely well-shaped.
      const validation = validateManifest(manifest, catalogue);
      if (!validation.ok) {
        process.stderr.write("Manifest rejected:\n");
        for (const issue of validation.issues) {
          process.stderr.write(`  ${issue.code} at ${issue.path}: ${issue.message}\n`);
        }
        return 1;
      }

      await writeFile(path.join(workDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

      const output = path.resolve(flags.out ?? path.join(workDir, "out.mp4"));
      process.stderr.write(`Rendering "${concept.title}" — ${manifest.segments.length} segments\n`);
      const report = await renderManifest(
        manifest,
        assets.assets,
        new Map(Object.entries(assets.sourcePaths)),
        output,
        path.join(workDir, "segment-cache"),
      );

      process.stdout.write(
        `${report.outputPath}\n  ${report.segments} segments (${report.cacheHits} cached), ${Math.round(report.durationMs / 1000)}s\n`,
      );
      return 0;
    }

    default:
      process.stdout.write(`${USAGE}\n`);
      return command ? 2 : 0;
  }
};

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  },
);
