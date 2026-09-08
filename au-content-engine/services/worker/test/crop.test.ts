import { describe, expect, it } from "vitest";
import { cropFilter, cropTo916, fitBlurFilter } from "../src/crop";

describe("cropTo916", () => {
  it("crops a 4K landscape drone frame to a centred 9:16 window", () => {
    const r = cropTo916(3840, 2160, 0.5, 0.5);
    expect(r.height).toBe(2160);
    expect(r.width).toBe(1214); // 2160 * 9/16 = 1215, rounded down to even
    expect(r.x).toBe(1312);
  });

  it("shifts the window toward the focus point", () => {
    const centred = cropTo916(3840, 2160, 0.5, 0.5);
    const right = cropTo916(3840, 2160, 0.75, 0.5);
    expect(right.x).toBeGreaterThan(centred.x);
  });

  it("clamps a focus point that would push the window off the right edge", () => {
    const r = cropTo916(3840, 2160, 0.99, 0.5);
    expect(r.x + r.width).toBeLessThanOrEqual(3840);
    expect(r.x).toBeGreaterThanOrEqual(0);
  });

  it("clamps a focus point that would push the window off the left edge", () => {
    const r = cropTo916(3840, 2160, 0.01, 0.5);
    expect(r.x).toBe(0);
  });

  it("leaves a portrait phone frame at full width", () => {
    const r = cropTo916(1080, 1920, 0.5, 0.5);
    expect(r).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
  });

  it("trims height on a source taller than 9:16", () => {
    const r = cropTo916(1080, 2400, 0.5, 0.5);
    expect(r.width).toBe(1080);
    expect(r.height).toBe(1920);
    expect(r.y).toBeGreaterThan(0);
  });

  it("always returns even dimensions, which libx264 requires", () => {
    for (const [w, h] of [[1921, 1081], [3840, 2160], [1079, 1919], [720, 1281]]) {
      const r = cropTo916(w!, h!, 0.5, 0.5);
      expect(r.width % 2).toBe(0);
      expect(r.height % 2).toBe(0);
      expect(r.x % 2).toBe(0);
      expect(r.y % 2).toBe(0);
    }
  });

  it("never exceeds the source frame", () => {
    for (const fx of [0, 0.25, 0.5, 0.75, 1]) {
      const r = cropTo916(1920, 1080, fx, 0.5);
      expect(r.x + r.width).toBeLessThanOrEqual(1920);
      expect(r.y + r.height).toBeLessThanOrEqual(1080);
    }
  });
});

describe("filters", () => {
  it("renders crop in FFmpeg's w:h:x:y order", () => {
    expect(cropFilter({ x: 100, y: 0, width: 608, height: 1080 })).toBe("crop=608:1080:100:0");
  });

  it("builds a fit-with-blur chain ending at the canvas size", () => {
    const chain = fitBlurFilter(1080, 1920);
    expect(chain).toContain("gblur");
    expect(chain).toContain("overlay=(W-w)/2:(H-h)/2");
  });
});
