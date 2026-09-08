import { describe, expect, it } from "vitest";
import { detectClaims, isSubstantiated, unsubstantiatedClaims } from "../src/claims";

const kinds = (text: string) => detectClaims(text).map((c) => c.kind);
const texts = (text: string) => detectClaims(text).map((c) => c.text);

describe("detectClaims", () => {
  it("finds rand written without a separator", () => {
    expect(texts("Only R950 a night")).toContain("R950");
  });

  it("finds rand written with a space separator", () => {
    expect(texts("R1 200 for the whole cabin")).toContain("R1 200");
  });

  it("finds rand written with a comma separator", () => {
    expect(texts("R1,200 for the whole cabin")).toContain("R1,200");
  });

  it("finds travel time", () => {
    expect(kinds("This is less than 2 hours from Cape Town")).toContain("travel_time");
  });

  it("finds distance", () => {
    expect(texts("Just 45km off the N7")).toContain("45km");
  });

  it("finds superlatives", () => {
    expect(kinds("The best cabin in the Cederberg")).toContain("superlative");
  });

  it("returns nothing for copy that states no fact", () => {
    expect(detectClaims("We did not expect this view")).toEqual([]);
  });

  it("returns claims in the order they appear", () => {
    const found = detectClaims("R950 a night, 2 hours from Cape Town");
    expect(found.map((c) => c.kind)).toEqual(["currency", "travel_time"]);
  });

  it("does not leak regex state between calls", () => {
    const once = detectClaims("R950");
    const twice = detectClaims("R950");
    expect(twice).toEqual(once);
  });
});

describe("isSubstantiated", () => {
  const facts = ["R950 per night", "Cederberg"];

  it("accepts a claim contained in a longer fact", () => {
    const [claim] = detectClaims("R950");
    expect(isSubstantiated(claim!, facts)).toBe(true);
  });

  it("ignores separator differences", () => {
    const [claim] = detectClaims("R1 200");
    expect(isSubstantiated(claim!, ["R1,200 per night"])).toBe(true);
  });

  it("rejects a claim absent from the facts", () => {
    const [claim] = detectClaims("R450");
    expect(isSubstantiated(claim!, facts)).toBe(false);
  });
});

describe("unsubstantiatedClaims", () => {
  const facts = ["R950 per night", "Cederberg"];

  it("passes a price that matches the verified fact", () => {
    expect(unsubstantiatedClaims("Ours cost R950", facts)).toEqual([]);
  });

  it("flags a price that does not", () => {
    const flagged = unsubstantiatedClaims("Ours cost R450", facts);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ kind: "currency", text: "R450" });
  });

  it("flags a travel-time claim with no supporting fact", () => {
    const flagged = unsubstantiatedClaims("Less than 2 hours from Cape Town", facts);
    expect(flagged.map((c) => c.kind)).toContain("travel_time");
  });
});
