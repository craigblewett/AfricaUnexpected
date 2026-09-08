import { describe, expect, it } from "vitest";
import { AU_DEFAULT_STYLE, buildAss, escapeAssText, groupIntoLines, toAssColour, toAssTime } from "../src/ass";

describe("toAssColour", () => {
  it("swaps RGB into ASS's BGR order", () => {
    // #FFD54A is amber; naive RGB would emit &H00FFD54A and render blue-ish.
    expect(toAssColour("#FFD54A")).toBe("&H004AD5FF");
  });

  it("handles white and black without reordering artefacts", () => {
    expect(toAssColour("#FFFFFF")).toBe("&H00FFFFFF");
    expect(toAssColour("#000000")).toBe("&H00000000");
  });

  it("encodes alpha in the leading byte", () => {
    expect(toAssColour("#000000", 128)).toBe("&H80000000");
  });
});

describe("toAssTime", () => {
  it.each([
    [0, "0:00:00.00"],
    [120, "0:00:00.12"],
    [2_700, "0:00:02.70"],
    [61_500, "0:01:01.50"],
    [3_661_230, "1:01:01.23"],
  ])("%i ms -> %s", (ms, expected) => {
    expect(toAssTime(ms)).toBe(expected);
  });

  it("floors to centiseconds rather than rounding past the second", () => {
    expect(toAssTime(1_999)).toBe("0:00:01.99");
  });
});

describe("escapeAssText", () => {
  it("neutralises braces, which are override syntax", () => {
    expect(escapeAssText("a {b} c")).toBe("a \\{b\\} c");
  });

  it("converts newlines to ASS line breaks", () => {
    expect(escapeAssText("one\ntwo")).toBe("one\\Ntwo");
  });
});

describe("groupIntoLines", () => {
  const words = Array.from({ length: 9 }, (_, i) => ({
    text: `w${i}`, startMs: i * 300, endMs: i * 300 + 280,
  }));

  it("caps words per line", () => {
    const lines = groupIntoLines(words, 4);
    expect(lines.map((l) => l.words.length)).toEqual([4, 4, 1]);
  });

  it("breaks a line that would run too long even under the word cap", () => {
    const slow = [
      { text: "a", startMs: 0, endMs: 1_000 },
      { text: "b", startMs: 1_000, endMs: 2_000 },
      { text: "c", startMs: 2_000, endMs: 3_000 },
    ];
    expect(groupIntoLines(slow, 10, 2_500).length).toBeGreaterThan(1);
  });

  it("returns nothing for no words", () => {
    expect(groupIntoLines([])).toEqual([]);
  });
});

describe("buildAss", () => {
  const lines = groupIntoLines([
    { text: "This", startMs: 120, endMs: 400 },
    { text: "is", startMs: 400, endMs: 600 },
    { text: "the", startMs: 600, endMs: 800 },
    { text: "Cederberg", startMs: 800, endMs: 1_600 },
  ]);

  it("emits a parsable header with the canvas resolution", () => {
    const ass = buildAss(lines, 1080, 1920);
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toContain("[V4+ Styles]");
    expect(ass).toContain("[Events]");
  });

  it("writes one Dialogue event per line, not per word", () => {
    const ass = buildAss(lines, 1080, 1920);
    expect(ass.match(/^Dialogue:/gm)?.length).toBe(1);
  });

  it("carries karaoke timing for every word", () => {
    const ass = buildAss(lines, 1080, 1920);
    expect(ass.match(/\\k\d+/g)?.length).toBe(4);
  });

  it("spans the line from its first word to its last", () => {
    const ass = buildAss(lines, 1080, 1920);
    expect(ass).toContain("0:00:00.12,0:00:01.60");
  });

  it("names the style consistently in the style block and the event", () => {
    const ass = buildAss(lines, 1080, 1920, AU_DEFAULT_STYLE);
    expect(ass).toContain(`Style: ${AU_DEFAULT_STYLE.name},`);
    expect(ass).toContain(`,${AU_DEFAULT_STYLE.name},,0,0,0,,`);
  });

  it("keeps captions clear of the platform UI via a bottom margin", () => {
    expect(buildAss(lines, 1080, 1920)).toContain(",320,1");
  });

  it("skips empty lines rather than emitting a malformed event", () => {
    expect(buildAss([{ words: [] }], 1080, 1920).match(/^Dialogue:/gm)).toBeNull();
  });
});
