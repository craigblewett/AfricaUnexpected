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

---

## The spike CLI

`services/worker` — the D1 gate. Four commands, JSON files between them, no database and
no queue. Its only job is to answer one question before any product surface exists:
**can a multimodal model produce Reel concepts worth posting, from AU's own footage?**

```bash
export GOOGLE_GENERATIVE_AI_API_KEY=...

pnpm --filter @au/worker au ingest ./cederberg-trip --work ./run-01
pnpm --filter @au/worker au shots  --work ./run-01 \
     --context "Two nights near Clanwilliam, Feb 2026" --facts ./facts.json
pnpm --filter @au/worker au concepts --work ./run-01 --candidates 10
pnpm --filter @au/worker au render   --work ./run-01 --pick 2 --out reel.mp4
```

`--facts` takes a JSON array of `{key, value, source, sourceRef}`. Anything not in that
file cannot be stated as fact by the model — the validator flags it and the concept is
shown badged rather than rendered silently.

Requires `ffmpeg` and `ffprobe` on PATH.

### What each stage proves

| Stage | Question it answers |
|---|---|
| `ingest` | Does ffprobe read rotation correctly, and do proxies come out upright? |
| `shots` | Is FFmpeg's `scdet` good enough on drone and vehicle footage, or is PySceneDetect needed? `shots.json` keeps the raw boundaries so they can be scored against hand marks. |
| `concepts` | **The gate.** Three of five projects must yield a concept worth generating. |
| `render` | Does the two-stage cache hold up on mixed 60fps phone and 30fps drone footage? |

### Structure

```
services/worker/
  src/ffmpeg.ts             every FFmpeg call — spawn with an argv array, shell: false
  src/crop.ts               9:16 crop geometry (pure)
  src/ass.ts                ASS caption generation (pure)
  src/shots.ts              scene changes -> shot ranges (pure)
  src/render.ts             two-stage render + segment cache
  src/providers/
    types.ts                ShotDetector, VideoUnderstanding, StoryModel interfaces
    model-config.ts         model IDs and prices — configuration, never domain logic
    ffmpeg-scenes.ts        the default detector
    gemini.ts               shot analysis, schema-forced output
    story.ts                planner + adversarial critic, two passes
    select.ts               diversity filter (pure)
  src/commands/             ingest · shots · concepts
  src/cli.ts                argument parsing and the four subcommands
```

### Notes for whoever runs it first

- **No model output reaches a shell.** `ffmpeg.ts` is the only module that spawns a
  process, and it always passes an argv array with `shell: false`. Filter strings are
  built from numbers this codebase computed.
- **Concept → manifest is deterministic**, not a second model call. The concept already
  names its shots, moments and durations; laying them onto a timeline is arithmetic, and
  a model there would only add a chance of inventing a range.
- **The critic is a separate pass** that has not seen the planner's reasoning. Asking one
  model for five concepts reliably returns five wordings of one idea.
- Check the AI SDK call shape in `providers/gemini.ts` and `providers/story.ts` against
  the installed `node_modules` before the first run — that API moves between versions.
