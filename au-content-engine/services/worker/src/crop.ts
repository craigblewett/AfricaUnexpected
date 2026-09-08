/**
 * 9:16 crop geometry. Pure — no FFmpeg, no I/O — so the maths is unit-testable and the
 * filter string is built from numbers this module produced rather than from model output.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * libx264 needs even dimensions; an odd crop silently fails or shifts chroma.
 *
 * Sizes and offsets round differently: a zero-width crop is meaningless, but a zero
 * offset is the common case — a portrait source, or a focus point clamped to the left
 * edge — so forcing a minimum of 2 there would nudge every such frame off-centre.
 */
const evenSize = (n: number): number => Math.max(2, Math.floor(n / 2) * 2);
const evenOffset = (n: number): number => Math.max(0, Math.floor(n / 2) * 2);

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

export const TARGET_ASPECT = 9 / 16;

/**
 * Crop a source frame to 9:16 around a focus point expressed in 0..1 of the frame.
 *
 * The focus point is the model's `crop_hint` or the user's manual correction. It is
 * clamped rather than trusted: a hint of 0.98 on a wide drone shot would otherwise
 * push the crop window off the right edge.
 */
export const cropTo916 = (
  sourceWidth: number,
  sourceHeight: number,
  focusX = 0.5,
  focusY = 0.5,
): Rect => {
  const sourceAspect = sourceWidth / sourceHeight;

  if (sourceAspect > TARGET_ASPECT) {
    // Wider than 9:16 — the crop is limited by height, and we choose an x window.
    const width = evenSize(Math.min(sourceWidth, sourceHeight * TARGET_ASPECT));
    const height = evenSize(sourceHeight);
    const x = clamp(Math.round(focusX * sourceWidth - width / 2), 0, sourceWidth - width);
    return { x: evenOffset(x), y: 0, width, height };
  }

  // Taller than 9:16 (portrait source overshooting) — limited by width, choose a y window.
  const width = evenSize(sourceWidth);
  const height = evenSize(Math.min(sourceHeight, sourceWidth / TARGET_ASPECT));
  const y = clamp(Math.round(focusY * sourceHeight - height / 2), 0, sourceHeight - height);
  return { x: 0, y: evenOffset(y), width, height };
};

export const cropFilter = (r: Rect): string =>
  `crop=${r.width}:${r.height}:${r.x}:${r.y}`;

/**
 * Fallback for compositions a crop would ruin — a wide landscape, several subjects, or
 * readable signage. The frame is fitted whole over a blurred, zoomed copy of itself.
 */
export const fitBlurFilter = (canvasWidth: number, canvasHeight: number): string =>
  [
    `split=2[bg][fg]`,
    `[bg]scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=increase,` +
      `crop=${canvasWidth}:${canvasHeight},gblur=sigma=40[blurred]`,
    `[fg]scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=decrease[fitted]`,
    `[blurred][fitted]overlay=(W-w)/2:(H-h)/2`,
  ].join(";");
