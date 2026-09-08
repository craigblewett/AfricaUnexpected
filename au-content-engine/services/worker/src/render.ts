import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Asset, ReelManifest, Segment } from "@au/schemas";
import { ffmpeg } from "./ffmpeg";
import { cropFilter, cropTo916, fitBlurFilter } from "./crop";

/**
 * Two-stage renderer.
 *
 * Stage 1 normalises every segment independently to one canvas, frame rate, pixel format
 * and timebase. Stage 2 concatenates and encodes once. Doing it in two stages is what
 * stops mixed sources — 60fps phone, 30fps drone, an action cam, a finished export —
 * producing black frames and drifting audio when concatenated directly.
 *
 * The cache key covers everything that changes a segment's pixels. Editing the hook text
 * changes no key, so every segment is a hit and only stage 2 re-runs.
 */

/** Bump when a change to stage 1 alters output for identical inputs; it invalidates the cache. */
export const RENDERER_VERSION = "1";

export interface Canvas {
  width: number;
  height: number;
  fps: number;
}

export const segmentCacheKey = (
  segment: Segment,
  assetChecksum: string,
  canvas: Canvas,
  rendererVersion = RENDERER_VERSION,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        assetChecksum,
        segment.sourceInMs,
        segment.sourceOutMs,
        segment.crop,
        segment.sourceAudioDb,
        canvas,
        rendererVersion,
      ]),
    )
    .digest("hex")
    .slice(0, 32);

const videoFilter = (segment: Segment, asset: Asset, canvas: Canvas): string => {
  const scaleAndFormat = [
    `scale=${canvas.width}:${canvas.height}`,
    "setsar=1",
    `fps=${canvas.fps}`,
    "format=yuv420p",
  ];

  if (segment.crop.mode === "fit_blur_background") {
    // The blur chain ends at the canvas size already, so no further scale is needed.
    return [fitBlurFilter(canvas.width, canvas.height), `fps=${canvas.fps}`, "setsar=1", "format=yuv420p"].join(",");
  }

  const [focusX, focusY] = segment.crop.focus;
  const rect = cropTo916(asset.width, asset.height, focusX, focusY);
  return [cropFilter(rect), ...scaleAndFormat].join(",");
};

export interface NormaliseResult {
  path: string;
  cacheHit: boolean;
}

export const normaliseSegment = async (
  segment: Segment,
  asset: Asset,
  sourcePath: string,
  canvas: Canvas,
  cacheDir: string,
): Promise<NormaliseResult> => {
  await mkdir(cacheDir, { recursive: true });
  const key = segmentCacheKey(segment, asset.checksum, canvas);
  const output = path.join(cacheDir, `${key}.mp4`);

  if (existsSync(output)) return { path: output, cacheHit: true };

  const args = [
    // -ss and -to before -i seek on the input, which is far faster than decoding the
    // whole file; accuracy is frame-exact in modern FFmpeg for these formats.
    "-ss", (segment.sourceInMs / 1000).toFixed(3),
    "-to", (segment.sourceOutMs / 1000).toFixed(3),
    "-i", sourcePath,
  ];

  if (!asset.hasAudio) {
    // Every intermediate must carry an audio track or concat drops the stream partway,
    // which desynchronises everything after the first silent clip.
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-shortest");
  }

  args.push(
    "-vf", videoFilter(segment, asset, canvas),
    "-af", `volume=${segment.sourceAudioDb}dB,aresample=48000`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k",
    "-video_track_timescale", "90000",
    output,
  );

  await ffmpeg(args);
  return { path: output, cacheHit: false };
};

export interface AssembleOptions {
  canvas: Canvas;
  assPath?: string;
  crf?: number;
}

export const assemble = async (
  intermediatePaths: readonly string[],
  outputPath: string,
  { canvas, assPath, crf = 20 }: AssembleOptions,
): Promise<void> => {
  const listPath = `${outputPath}.concat.txt`;
  // Single quotes are escaped for the concat demuxer's own parser. These paths are ours —
  // cache filenames are hex digests — but the escape keeps the invariant local.
  await writeFile(
    listPath,
    intermediatePaths.map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join("\n"),
    "utf8",
  );

  const args = ["-f", "concat", "-safe", "0", "-i", listPath];

  if (assPath) {
    args.push("-vf", `ass=${assPath}`, "-c:v", "libx264", "-preset", "medium", "-crf", String(crf));
  } else {
    // Nothing touches the pixels, so the normalised streams copy through untouched.
    args.push("-c:v", "copy");
  }

  args.push("-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputPath);
  await ffmpeg(args);
};

export interface RenderReport {
  outputPath: string;
  segments: number;
  cacheHits: number;
  durationMs: number;
}

export const renderManifest = async (
  manifest: ReelManifest,
  assets: readonly Asset[],
  sourcePaths: ReadonlyMap<string, string>,
  outputPath: string,
  cacheDir: string,
  assPath?: string,
): Promise<RenderReport> => {
  const canvas = manifest.canvas;
  const byId = new Map(assets.map((a) => [a.id, a]));
  const intermediates: string[] = [];
  let cacheHits = 0;

  for (const segment of manifest.segments) {
    const asset = byId.get(segment.assetId);
    const source = sourcePaths.get(segment.assetId);
    if (!asset || !source) {
      throw new Error(`Segment ${segment.id} references asset ${segment.assetId}, which was not supplied.`);
    }
    const result = await normaliseSegment(segment, asset, source, canvas, cacheDir);
    if (result.cacheHit) cacheHits++;
    intermediates.push(result.path);
  }

  await assemble(intermediates, outputPath, { canvas, ...(assPath ? { assPath } : {}) });

  return {
    outputPath,
    segments: manifest.segments.length,
    cacheHits,
    durationMs: manifest.durationMs,
  };
};
