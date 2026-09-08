/**
 * ASS subtitle generation for burned-in captions.
 *
 * Chosen over a chain of FFmpeg `drawtext` filters because word-level highlighting needs
 * one filter per word there, and over Remotion because that would mean a headless browser
 * and a second rendering model. libass does styling, outlines, safe-area margins and
 * karaoke timing from one text file — which is also diffable and testable without
 * decoding a frame.
 */

export interface CaptionWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface CaptionLine {
  words: CaptionWord[];
}

export interface AssStyle {
  name: string;
  fontName: string;
  fontSize: number;
  /** Rendered colours, as CSS-style #RRGGBB. Converted to ASS's BGR order below. */
  primaryColour: string;
  highlightColour: string;
  outlineColour: string;
  outlineWidth: number;
  bold: boolean;
  /** Distance from the bottom of the frame, in pixels. Keeps text clear of platform UI. */
  marginVertical: number;
  marginHorizontal: number;
}

export const AU_DEFAULT_STYLE: AssStyle = {
  name: "au_default",
  fontName: "Montserrat",
  fontSize: 64,
  primaryColour: "#FFFFFF",
  highlightColour: "#FFD54A",
  outlineColour: "#000000",
  outlineWidth: 4,
  bold: true,
  // Instagram's caption and action rails sit roughly in the lower sixth of a Reel.
  marginVertical: 320,
  marginHorizontal: 80,
};

/**
 * ASS stores colour as &HAABBGGRR — alpha first, then BLUE, GREEN, RED. Feeding it RGB
 * silently swaps red and blue, which is the classic way branded captions come out wrong.
 */
export const toAssColour = (hex: string, alpha = 0): string => {
  const clean = hex.replace("#", "").padStart(6, "0");
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  const a = alpha.toString(16).padStart(2, "0");
  return `&H${a}${b}${g}${r}`.toUpperCase();
};

/** ASS timestamps are H:MM:SS.cc — centiseconds, and the hour is not zero-padded. */
export const toAssTime = (ms: number): string => {
  const safe = Math.max(0, Math.round(ms));
  const cs = Math.floor(safe / 10) % 100;
  const s = Math.floor(safe / 1000) % 60;
  const m = Math.floor(safe / 60_000) % 60;
  const h = Math.floor(safe / 3_600_000);
  const p2 = (n: number) => n.toString().padStart(2, "0");
  return `${h}:${p2(m)}:${p2(s)}.${p2(cs)}`;
};

/** Braces and newlines are ASS override syntax; leaving them raw lets text become markup. */
export const escapeAssText = (text: string): string =>
  text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\N");

const styleBlock = (s: AssStyle): string => {
  const bold = s.bold ? -1 : 0;
  return [
    `Style: ${s.name},${s.fontName},${s.fontSize},`,
    `${toAssColour(s.primaryColour)},${toAssColour(s.highlightColour)},`,
    `${toAssColour(s.outlineColour)},${toAssColour("#000000", 128)},`,
    `${bold},0,0,0,100,100,0,0,1,${s.outlineWidth},0,2,`,
    `${s.marginHorizontal},${s.marginHorizontal},${s.marginVertical},1`,
  ].join("");
};

/**
 * `\k` takes a duration in centiseconds and highlights each word for that long, so a line
 * is one Dialogue event rather than one per word. Gaps between words are absorbed into
 * the preceding word's duration to keep the highlight continuous.
 */
const karaokeText = (words: readonly CaptionWord[]): string =>
  words
    .map((w, i) => {
      const next = words[i + 1];
      const endMs = next ? Math.max(w.endMs, next.startMs) : w.endMs;
      const cs = Math.max(1, Math.round((endMs - w.startMs) / 10));
      return `{\\k${cs}}${escapeAssText(w.text)}`;
    })
    .join(" ");

export const buildAss = (
  lines: readonly CaptionLine[],
  canvasWidth: number,
  canvasHeight: number,
  style: AssStyle = AU_DEFAULT_STYLE,
): string => {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${canvasWidth}`,
    `PlayResY: ${canvasHeight}`,
    // WrapStyle 2 disables automatic wrapping, so line breaks stay where the planner put them.
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    styleBlock(style),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events = lines
    .filter((l) => l.words.length > 0)
    .map((line) => {
      const first = line.words[0]!;
      const last = line.words[line.words.length - 1]!;
      return `Dialogue: 0,${toAssTime(first.startMs)},${toAssTime(last.endMs)},${style.name},,0,0,0,,${karaokeText(line.words)}`;
    });

  return [...header, ...events, ""].join("\n");
};

/** Group words into readable lines. Reels rarely hold more than a few words legibly. */
export const groupIntoLines = (
  words: readonly CaptionWord[],
  maxWordsPerLine = 4,
  maxLineMs = 2_500,
): CaptionLine[] => {
  const lines: CaptionLine[] = [];
  let current: CaptionWord[] = [];

  for (const word of words) {
    const wouldExceedWords = current.length >= maxWordsPerLine;
    const wouldExceedTime =
      current.length > 0 && word.endMs - current[0]!.startMs > maxLineMs;
    if (wouldExceedWords || wouldExceedTime) {
      lines.push({ words: current });
      current = [];
    }
    current.push(word);
  }
  if (current.length > 0) lines.push({ words: current });

  return lines;
};
