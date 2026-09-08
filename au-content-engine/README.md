# AU Content Engine

Turns Africa Unexpected footage into grounded, distinct Reel concepts and an editable
9:16 video. See [`../docs/au-content-engine/BUILD-PLAN.md`](../docs/au-content-engine/BUILD-PLAN.md)
for the full plan, and the AU Content Engine PRD v1.0 for the product specification.

> **This directory is a transplant.** It lives in the Strapi repo only because that is
> the branch this work was scoped to. It is self-contained and has no dependency on
> anything above it except the plan document — move it wholesale into
> `craigblewett/au-content-engine` once that repo exists.

## Why this package exists before anything else

`packages/schemas` is the trust boundary the PRD describes in §10.1: **the model returns
schema-validated JSON, domain code validates ownership and ranges, and only then does
renderer code build FFmpeg arguments.** No model output ever reaches a shell.

It is written first because everything downstream — the analysis adapters, the concept
planner, the edit planner, the renderer — either produces or consumes these shapes.

Validation is two layers, and both must pass:

| Layer | Proves | Implementation |
|---|---|---|
| Zod schemas | The payload has the right shape: integer milliseconds, focus points inside the frame, audio gain that cannot clip | `src/{catalogue,concept,manifest}.ts` |
| Grounding validator | The references are real and the ranges executable: the shot exists, belongs to that asset, and the range sits inside both; the timeline is gapless from zero; claims are backed by verified facts | `src/validate.ts` |

Zod cannot express the second layer — only the catalogue knows whether `sht_reveal`
exists. Nothing here ever repairs a payload: an invalid plan is rejected so the model
gets corrected rather than silently patched.

### Claim detection

`src/claims.ts` scans overlay and hook copy for prices, distances, travel times and
superlatives, and flags any that no verified fact supports. It is deliberately
over-eager — a false positive costs a "Needs confirmation" badge, a false negative puts
a wrong price on a published Reel. It flags claims for checking; it never decides one
is true.

The distinction that makes this usable: an unsupported claim is *confirmable*, so the
concept is still shown, badged. An invalid shot reference is *fatal*, so the concept is
dropped. That is what `isRenderable()` encodes.

## Layout

```
packages/schemas/          the trust boundary — Zod shapes + grounding validator
  src/time.ts              time-range maths in integer milliseconds
  src/catalogue.ts         Asset, Shot, Moment, VerifiedFact
  src/concept.ts           Concept, angle types, Reel Strength Score
  src/manifest.ts          ReelManifest — what the renderer executes
  src/claims.ts            price / distance / travel-time / superlative detection
  src/validate.ts          grounding validation against the catalogue
```

## Commands

```bash
pnpm install
pnpm -r test        # 59 tests
pnpm -r typecheck
```

## Still to come

`services/worker` — the spike CLI from D1 of the plan:

```
au ingest   ./cederberg-trip/       ->  assets.json
au shots    assets.json             ->  shots.json
au concepts shots.json              ->  concepts.json
au render   concepts.json --pick 2  ->  out.mp4
```

That needs `ffmpeg` and `ffprobe` on PATH and a Gemini key, neither of which is
available in the environment this was written in — so it runs on your machine, not here.
