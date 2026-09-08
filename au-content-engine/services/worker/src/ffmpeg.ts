import { spawn } from "node:child_process";

/**
 * Every FFmpeg call in the system goes through here.
 *
 * The single rule this file exists to enforce: arguments are passed as an array with
 * `shell: false`, so nothing a model produced can ever be interpreted as a command.
 * Callers pass validated numbers and paths; this module turns them into argv.
 */

export class FfmpegError extends Error {
  constructor(
    readonly bin: string,
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(`${bin} exited ${code}: ${stderr.trim().split("\n").slice(-3).join(" | ")}`);
    this.name = "FfmpegError";
  }
}

const run = (bin: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args as string[], { shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new FfmpegError(bin, code, stderr)),
    );
  });

export const ffmpeg = (args: readonly string[]) => run("ffmpeg", ["-hide_banner", "-y", ...args]);
export const ffprobe = (args: readonly string[]) => run("ffprobe", ["-hide_banner", ...args]);

export interface ProbeResult {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  rotation: 0 | 90 | 180 | 270;
  hasAudio: boolean;
  videoCodec: string;
}

const parseFps = (rate: string | undefined): number => {
  if (!rate) return 0;
  const [num, den] = rate.split("/").map(Number);
  return den ? (num ?? 0) / den : (num ?? 0);
};

/**
 * Rotation reaches us two ways depending on how the camera wrote the file: a display
 * matrix side-data entry on modern phones, or a legacy stream tag. Missing either one
 * renders portrait footage on its side, so both are read.
 */
const parseRotation = (stream: any): 0 | 90 | 180 | 270 => {
  const fromSideData = stream?.side_data_list?.find((s: any) => s.rotation !== undefined)?.rotation;
  const raw = Number(fromSideData ?? stream?.tags?.rotate ?? 0);
  const normalised = ((Math.round(raw) % 360) + 360) % 360;
  return normalised === 90 || normalised === 180 || normalised === 270 ? normalised : 0;
};

export const probe = async (path: string): Promise<ProbeResult> => {
  const { stdout } = await ffprobe([
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    path,
  ]);
  const data = JSON.parse(stdout);
  const video = data.streams?.find((s: any) => s.codec_type === "video");
  if (!video) throw new Error(`No video stream in ${path}`);

  const rotation = parseRotation(video);
  const swap = rotation === 90 || rotation === 270;

  return {
    durationMs: Math.round(Number(data.format?.duration ?? 0) * 1000),
    // Report display dimensions, not stored ones — a rotated 1920x1080 file is portrait.
    width: swap ? Number(video.height) : Number(video.width),
    height: swap ? Number(video.width) : Number(video.height),
    fps: parseFps(video.avg_frame_rate ?? video.r_frame_rate),
    rotation,
    hasAudio: Boolean(data.streams?.some((s: any) => s.codec_type === "audio")),
    videoCodec: String(video.codec_name ?? "unknown"),
  };
};

export const makeProxy = async (input: string, output: string): Promise<void> => {
  await ffmpeg([
    "-i", input,
    // scale=-2 keeps the width even, which libx264 requires; the filter also applies
    // the display matrix, so the proxy is upright and the model sees it as shot.
    "-vf", "scale=-2:720",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
    "-c:a", "aac", "-b:a", "96k",
    "-movflags", "+faststart",
    output,
  ]);
};

export const extractFrame = async (input: string, atMs: number, output: string): Promise<void> => {
  await ffmpeg([
    // -ss before -i seeks by keyframe, which is fast and accurate enough for a thumbnail.
    "-ss", (atMs / 1000).toFixed(3),
    "-i", input,
    "-frames:v", "1",
    "-q:v", "4",
    output,
  ]);
};

export const extractAudio = async (input: string, output: string): Promise<void> => {
  await ffmpeg([
    "-i", input,
    "-vn", "-ac", "1", "-ar", "16000",
    "-c:a", "pcm_s16le",
    output,
  ]);
};

/**
 * Shot boundaries from FFmpeg's own scene score.
 *
 * This is the cheap half of the D1 spike's second question: PySceneDetect's adaptive
 * detector is expected to beat this on drone and vehicle footage, where camera motion
 * pushes the frame-difference score up without a cut. The spike measures the gap
 * against hand-marked boundaries before anyone commits to a Python sidecar.
 */
export const detectSceneChanges = async (
  input: string,
  threshold = 0.35,
): Promise<number[]> => {
  const { stderr } = await ffmpeg([
    "-i", input,
    "-filter:v", `select='gt(scene,${threshold})',metadata=print:file=-`,
    "-an",
    "-f", "null",
    "-",
  ]);

  const times: number[] = [];
  for (const line of stderr.split("\n")) {
    const match = /pts_time:(\d+(?:\.\d+)?)/.exec(line);
    if (match?.[1]) times.push(Math.round(Number(match[1]) * 1000));
  }
  return [...new Set(times)].sort((a, b) => a - b);
};
