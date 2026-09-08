import { detectSceneChanges } from "../ffmpeg";
import type { ShotDetector } from "./types";

/**
 * The default detector: FFmpeg's own frame-difference scene score.
 *
 * It costs nothing extra and keeps the worker in one language. The open question the
 * spike answers is whether it holds up on high-motion drone and vehicle footage, where
 * PySceneDetect's adaptive detector is expected to do better. Swapping in a Python
 * sidecar means implementing this interface — nothing above it changes.
 */
export const ffmpegSceneDetector = (threshold = 0.35): ShotDetector => ({
  name: `ffmpeg-scdet@${threshold}`,
  detect: (videoPath) => detectSceneChanges(videoPath, threshold),
});
