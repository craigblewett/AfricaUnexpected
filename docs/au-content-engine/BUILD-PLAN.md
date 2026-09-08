# AU Content Engine — Build Plan

Response to *Africa Unexpected | AU Content Engine — Product Requirements & Technical
Specification v1.0* (8 September 2026), rewritten against the existing house stack.

**Revision 2.** The first draft was written before reading the other repositories and
got two things wrong: it treated the Strapi CMS as the live Africa Unexpected backend
(it isn't — see §1), and it proposed a Python worker and a hand-picked stack without
knowing one had already been settled (see §2). Both are corrected below.

British English throughout, per the house convention in `jarvis/docs/CLAUDE.md`.

---

## 1. Repository verdict

**Recommendation: a new repo, `au-content-engine`, built on the jarvis stack, sharing
the `africa-unexpected` Supabase project.**

### The Strapi repo is superseded, three times over

| Repo | Last push | What it is |
|---|---|---|
| `AfricaUnexpected` | May 2025 | Strapi 5, 3 commits, SQLite. The one this work was pointed at. |
| `africa-unexpected-cms` | Sep 2025 | Strapi |
| `africa-unexpected-strapi` | Jan 2026 | Strapi |
| **`africa-unexpected`** | **Aug 2026** | **React 18 + Vite + Supabase, with a custom block-based admin at `/admin`. The live site.** |

The current site does not use Strapi at all. It uses Supabase — Postgres, Auth,
Storage, RLS — with a purpose-built admin CMS and `au_`-prefixed tables. So the
first draft's proposal to read verified facts out of the Strapi `Stay` content type
was aimed at a dead repo. The correction is in **D2**, and it is a simpler design
than the one it replaces.

### Why not build inside `africa-unexpected` either

That repo is a static-hosted Vite SPA with no server tier. The Content Engine needs
long-running background workers and a private media bucket. Putting render workers
in the public website repo couples two very different deploy cadences and risk
profiles. Separate repo, **same Supabase project**.

### Why the same Supabase project

The site's README says the `au_` prefix exists so its tables "live alongside the
existing project tables without conflict" — one project already hosts several apps.
Following that:

- Engine tables take the `aue_` prefix.
- **Verified facts become a SQL join, not an HTTP integration.** `au_hotels`,
  `au_regions` and `au_posts` are already there.
- **`au_videos` already exists** as the published YouTube library. Track B writes
  metric snapshots against rows that are already in the database.
- Same Auth, same RLS model, same `au_admins` allowlist. No second login.

---

## 2. The stack, settled

Taken from `jarvis/docs/architecture.md`, `jarvis/docs/CLAUDE.md`, `jarvis/AGENTS.md`
and `jarvis/docs/STATUS.md`. These are not proposals — they are the house standard,
and the working agreement in `CLAUDE.md` is explicit that core stack pieces are not
to be swapped without flagging trade-offs first. Where the PRD assumed something
different, the house choice wins.

| Layer | House choice | PRD assumed |
|---|---|---|
| Web framework | Next.js 16 App Router + TypeScript | Next.js — ✔ agrees |
| Database | Supabase Postgres + pgvector | Postgres + pgvector — ✔ agrees |
| ORM | Drizzle; migrations applied via the Supabase MCP | unspecified |
| Auth | Supabase Auth | "workspace/user ownership from the start" — ✔ |
| AI abstraction | Vercel AI SDK, everything through `lib/ai/router.ts` | provider adapters — ✔ same idea, existing implementation |
| AI providers | Anthropic primary; `GEMINI_API_KEY` already provisioned | Gemini default for video — fits `router.ts` per-task config |
| Schema validation | **Zod at every boundary**, incl. AI structured outputs | JSON Schema |
| UI | shadcn/ui + Tailwind + Tremor + Framer Motion | "Tailwind + small component library" — ✔ |
| Server state | TanStack Query; Zustand only when needed | unspecified |
| Testing | Vitest; pure functions extracted and unit-tested | unit + integration tests — ✔ |
| Package manager | pnpm | unspecified |
| Media/AI service | **TypeScript** (see 2.2) | Python + FastAPI |
| Queue | see 2.1 | Redis-backed durable queue |
| Storage | Supabase Storage (see 2.3) | S3-compatible / R2 |

Three conventions matter more than the table, and the engine should adopt all three
unchanged:

- **`integrations/<name>/{auth,fetch,summarise,actions,types}.ts`** — one folder per
  external system. `architecture.md` already lists `youtube` and `instagram` as
  future members. Track B is literally this pattern.
- **`lib/db/*` for all database access.** No raw Drizzle in route handlers.
- **`lib/approvals/*` for every external side effect.** Phase 1 has none, but the
  moment publishing appears in Phase 5 it routes through here, which is exactly the
  PRD's "publishing remains user-approved" principle with an existing implementation.

Also inherited: `lib/ai/router.ts` already does per-task provider config, spend
logging and monthly caps. The first draft proposed adding cost columns to `ai_runs`
as a new idea. It already exists — reuse it.

### 2.1 Hosting and background jobs — the one real deviation

`architecture.md` specifies Railway web + worker with Trigger.dev v3, and explicitly
rejects Vercel because "function timeouts (10s/60s) kill long AI runs; no long-lived
workers". But `STATUS.md` records what actually shipped: **Vercel**, with **GitHub
Actions cron** hitting `/api/cron/*` endpoints behind a bearer secret. `src/trigger/`
contains only a README; Trigger.dev was never installed, and Phase 1's Railway deploy
is still listed as outstanding.

That divergence is fine for jarvis. Every job it runs — mailbox sync, briefing
generation, alert scan — finishes in seconds, so serverless was never the constraint
and Railway was never needed.

**Video is the workload that row was written for.** An hour of multimodal analysis
and a mixed-source 1080×1920 render do not finish inside a Vercel function's ceiling,
which is measured in minutes rather than tens of minutes; and GitHub Actions' five-
minute minimum interval is a scheduler, not a job queue. So:

| | |
|---|---|
| Web app | **Vercel** — matches what you actually run, keeps the auto-deploy and PWA setup |
| Media worker | **One Railway service**, long-running, FFmpeg pinned in the image |
| Queue | An `aue_jobs` table in Supabase, polled by the worker with `FOR UPDATE SKIP LOCKED`, a lease column and a heartbeat |

The queue table satisfies every requirement in PRD §8.4 — idempotency keys, leases,
progress events, safe recovery of abandoned jobs — with no new infrastructure, which
matches the way jarvis actually operates today. **Trigger.dev v3 is the sanctioned
alternative** and is already written into `architecture.md`; if you would rather adopt
it here than hand-roll, that is a reasonable call and the worker code barely changes.
This is a decision for you, not for me — it is question 3 in §6.

### 2.2 The worker is TypeScript, not Python

The PRD assumes Python + FastAPI. Every repository here is TypeScript or Node, and
`course-dev-agent` already carries `ffmpeg-static` as a dependency. FFmpeg and
ffprobe are subprocesses — the calling language is irrelevant, and the PRD's hard
rule is that arguments are constructed from validated structures rather than model
output either way.

The only genuinely Python-shaped dependency in the spec is **PySceneDetect**.
FFmpeg's own `scdet` filter emits scene-change timestamps and covers the same job;
the open question is whether it holds up on AU's high-motion drone and vehicle
footage, which is precisely where PySceneDetect's `AdaptiveDetector` earns its place.

So: put shot detection behind a `ShotDetector` interface, ship `scdet` first, and
**measure it during the week-one spike** against hand-marked boundaries. Add a small
Python sidecar only if it loses. One language, one deploy pipeline, and the Python
question becomes a measured decision instead of an architectural commitment.

### 2.3 Storage

Supabase Storage is bundled, RLS-aware, already in use by the site for seven buckets,
and supports resumable uploads — which covers NFR-001 without extra work. Start there,
behind a `StorageProvider` interface.

Video is nonetheless the one asset class where the bundled choice may not hold:
originals are large and previews get scrubbed repeatedly, and Cloudflare R2's free
egress is a real advantage at archive scale. The interface makes that a config change
later rather than a migration. Sizing depends on question 5 in §6.

---

## 3. Deltas to the PRD

With the stack settled, what remains are creative and engineering judgements about
the spec itself.

### D1 — Replace the vendor bake-off with a one-week quality spike

Phase 0 asks for OpusClip, Vizard and Klap API integrations across 10–20 projects:
auth, upload, polling and result normalisation, for code that is then discarded.

The binding risk is not *"is OpusClip good?"*. It is **"can a multimodal model produce
concepts Craig and Nicky would actually post, from AU's own footage?"** If the answer
is no, no amount of Next.js rescues it.

Week one is a CLI in the worker package. No UI, no tables, no queue:

```
au ingest   ./cederberg-trip/       ->  assets.json
au shots    assets.json             ->  shots.json
au concepts shots.json              ->  concepts.json
au render   concepts.json --pick 2  ->  out.mp4
```

Five real projects spanning PRD §3.2 — accommodation reveal, wildlife, drone/scenic,
talking-to-camera, and a deliberately weak folder. Craig and Nicky rate every concept
on the §2.2 rubric. **Gate: three of the five yield a concept worth generating.**

Two things ride along at no extra cost: the `scdet`-versus-PySceneDetect measurement
from §2.2, and the first entries in `eval/`. For the vendor comparison, buy one month
of OpusClip and paste the same five folders in by hand — an afternoon, no code.

This is the PRD's own §23.3 advice, made literally the first sprint. Every line
survives into the worker as the adapter layer.

### D2 — Verified facts come from `au_hotels`, in the same database

*(This supersedes the first draft's Strapi proposal.)*

The largest creative risk is hallucinated fact, and it bites hardest where AU's best
content lives. *"Less than two hours from Cape Town." "R950 a night." "In the
Cederberg."* A model must never infer any of those from pixels.

The site database already holds them — `au_hotels`, `au_regions`, and the `au_posts`
body copy. Because the engine lives in the same Supabase project, this is a query
through `lib/db/*`, not an integration:

```
getVerifiedFacts(projectId) -> { hotel, region, sourcePost }
```

When a project is linked to an `au_hotels` row, those fields enter the planner prompt
as `verified_facts` and **nothing outside that set may be stated as fact**. Three
consequences worth having: a Reel and its journal post cannot contradict each other;
the hotel's affiliate link becomes the natural caption CTA, so the engine earns rather
than only costs; and because facts arrive as data, the *"Needs confirmation"* flag
fires on genuinely unverified claims instead of on everything.

Snapshot the facts used into `aue_verified_facts` at generation time, so a render
stays reproducible after the site content changes.

### D3 — Pull a read-only monitor forward, as `integrations/youtube/`

The brief asked to create reels **and monitor and manage** our videos. The PRD defers
all analytics to Phase 2. Keep that gate for the *learning* system — the causal
questions in §13.3 genuinely need volume — but ship a read-only monitor from week two,
in parallel, because:

- It reuses an existing pattern verbatim. `architecture.md` names `youtube` and
  `instagram` as future `integrations/*` members with the
  `{auth,fetch,summarise,actions,types}` shape already defined.
- `au_videos` already exists. There is a published-video registry to write against
  on day one.
- **Metric history cannot be backfilled.** §24.1 wants snapshots at 1h, 6h, 24h, 72h,
  7d and 28d. Every week deferred is matched-age history that never exists. This is
  the argument that actually decides it.

Scope it narrowly: connect YouTube and the Instagram professional account, snapshot
into an append-only `aue_metric_snapshots`, one Tremor dashboard. **No publishing, no
scheduling, no competitor data** — those stay where the PRD put them. Snapshot capture
can run on the existing GitHub Actions cron; it is a seconds-long job, so it needs
none of the Railway worker.

### D4 — Add `moments` inside shots

PySceneDetect (or `scdet`) returns shot boundaries. A shot can run eight seconds; the
beat that belongs in the Reel is the 1.2 seconds where the giraffe turns its head. If
the edit planner may only choose whole shots, cuts land slack and the pacing component
of the Reel Strength Score is capped by the scene detector.

Extend the analysis schema so each shot carries candidate sub-ranges:

```json
"moments": [
  {"start_ms": 13100, "end_ms": 14300, "role": "reveal",
   "why": "giraffe turns toward camera", "strength": 0.91}
]
```

The planner selects moments; the Zod validator checks each moment sits inside its
parent shot, which sits inside its asset. Same trust boundary, finer grain — and it
turns *"make the first three seconds stronger"* into a real operation rather than a
shot swap.

### D5 — Captions in ASS/libass

Word-level captions are the visual signature of the format and where FFmpeg work
usually goes bad. One `drawtext` filter per word is unmaintainable; Remotion means a
second rendering model and a headless browser.

Generate an ASS subtitle file and burn it in a single `subtitles` pass. libass gives
styled text, outlines, shadows, positioning, safe-area margins and `\k` karaoke timing
for word highlighting. One text file per render — so caption styling is a diffable
artefact, testable without decoding a frame, and a brand preset is just a style block.

### D6 — Two-stage render with a segment cache

AU footage is mixed by nature: portrait phone at 60fps, 4K drone at 30, an action cam,
a finished YouTube export. Concatenating those directly is the most common source of
black frames, audio drift and rotation bugs — precisely the §21.2 render gate.

Normalise each segment independently to the target canvas, frame rate, pixel format
and timebase with crop and audio gain applied; key the intermediate on
`hash(checksum, in_ms, out_ms, crop, gain, renderer_version)`; then concat, burn
captions and overlays, and encode once.

The cache is what makes the constrained editor feel fast. Change the hook text and
every segment is a hit, so one overlay pass re-runs instead of seventeen seconds of
video. Reordering shots is also fully cached. This turns §FR-012's "regenerate this
section" from a full re-render into a few seconds.

### D7 — Two crop modes and a fallback; measure before building tracking

§7.3 lists five crop policies including `animated_focus`, which needs per-frame subject
detection — a real subsystem. Phase 1 ships `smart_9x16` from the model's static crop
hint, `manual_focus` as a draggable box stored as an editable parameter, and
`fit_blur_background` for wide compositions.

Then instrument the crop-correction rate the PRD already asks for in §11.5 and let it
decide. If Craig corrects five per cent of crops, focus tracking is not worth building.

---

## 4. Build sequence

Two tracks. Track A is the PRD's Phase 1. Track B is D3.

| # | Track A — Creative engine | Gate |
|---|---|---|
| 0 | **Quality spike (D1).** Worker CLI: ingest → shots → concepts → render. Five real projects, human-rated. Measures `scdet` vs hand-marked boundaries. | 3 of 5 yield a concept worth generating. **Stop here if not met.** |
| 1 | Repo, pnpm workspace, CI, Drizzle schema, Supabase Auth reusing `au_admins`. Project CRUD. | A project persists and reopens. |
| 2 | Resumable upload to Supabase Storage. Asset records, checksum, ffprobe, state machine. | 50 files survive a dropped connection. |
| 3 | `aue_jobs` table, Railway worker, claim/lease/heartbeat, retry, progress events, job view. | Kill the worker mid-render: it recovers, nothing duplicates. |
| 4 | Proxies, thumbnails, audio derivatives, shot detection behind `ShotDetector`. | Shot grid renders from proxies, rotation correct. |
| 5 | Transcription and multimodal analysis through `lib/ai/router.ts`. Moments (D4). Embeddings + pgvector search. | "Elephants close to the car" returns the right shots. |
| 6 | Playbook v1, planner, critic, diversity and grounding validators, Reel Strength Score, concept gallery, verified facts (D2). | 3–5 distinct grounded concepts. Zero invalid shot references. |
| 7 | Zod manifest schema and validator. Two-stage renderer with segment cache (D6). ASS captions (D5). Crop modes (D7). Preview. | Fixture suite passes every §21.2 render gate. |
| 8 | Constrained editor: trim, reorder, replace, overlay text, regenerate section. Versioning. | Any edit creates a recoverable version. |
| 9 | Final 1080×1920 export. Eval regression suite. Telemetry. Hardening. | Full §21.1 acceptance test passes. |

| # | Track B — Channel monitor (parallel, from stage 2) | Gate |
|---|---|---|
| B1 | `integrations/youtube/` — OAuth, channel and video metadata, Analytics API. Joined to `au_videos`. | Real AU numbers on screen. |
| B2 | Append-only `aue_metric_snapshots`, capture at the §24.1 windows on the existing GitHub Actions cron. | Matched-age history accumulating. |
| B3 | `integrations/instagram/` — professional account insights. | Reels metrics landing. |
| B4 | One Tremor dashboard: posts, matched-age comparison, outlier score with its sample size shown. | "How is last week doing?" without opening four apps. |

Shape for one focused developer: spike in week one, stages 1–4 in weeks two to four,
5–6 in five to seven, 7 in eight and nine, 8–9 in ten to twelve. Track B fits in the
gaps at roughly a week in total. **Three months to the PRD's Definition of Done**, and
that is aggressive rather than padded.

---

## 5. Data model

New tables take the `aue_` prefix and live beside the site's `au_` tables. Drizzle
schema, migrations applied through the Supabase MCP, RLS on everything, audit tables
append-only — all per house convention.

| Table | Purpose |
|---|---|
| `aue_projects` | Project, context, status. Optional FK to `au_hotels` for D2. |
| `aue_assets` | Source media: storage key, checksum, ffprobe metadata, ingest status. |
| `aue_asset_derivatives` | Proxies, thumbnails, keyframes, analysis audio. |
| `aue_shots` | Boundaries, analysis JSON, **`moments`** (D4), embedding. |
| `aue_transcript_segments` | Time-linked speech, word timing where available. |
| `aue_concepts` / `aue_concept_shots` | Concept cards, scores, verification flags, supporting shots. |
| `aue_reels` / `aue_reel_versions` | Manifest per version, parent version, change reason. |
| `aue_renders` | Preview and final outputs, codec details, job reference. |
| `aue_jobs` | The queue (§2.1): idempotency key, state, attempts, lease, heartbeat, progress. |
| `aue_render_segments` | Segment cache (D6): cache key, storage key, renderer version, last used. |
| `aue_verified_facts` | Snapshot of the `au_hotels` / `au_regions` row used at generation time (D2). |
| `aue_feedback_events` | Concept selections, shot replacements, crop corrections — the §11.5 metrics. |
| `aue_metric_snapshots` | Append-only platform metrics, joined to `au_videos` (D3). |

**Reused rather than rebuilt:** `au_hotels`, `au_regions`, `au_posts`, `au_videos`,
`au_admins`, and `lib/ai/router.ts`'s existing spend logging and monthly caps. Per
`AGENTS.md`: search for and reuse before writing new code.

The PRD's future analytics and competitor tables get migrations now and stay empty,
as §23 recommends.

---

## 6. Decisions needed

Questions 3 and 4 from the first draft are answered: hosting is settled in §2.1, and
`GEMINI_API_KEY` is already provisioned in the jarvis environment.

| # | Question | Why it matters |
|---|---|---|
| 1 | Confirm the new repo — `au-content-engine`? | Blocks stage 1. |
| 2 | Same Supabase project as `africa-unexpected`, or its own? | Blocks the schema. Recommendation: same, so D2 and D3 are joins rather than integrations. |
| 3 | Hand-rolled `aue_jobs` queue, or adopt Trigger.dev v3 now? | Blocks stage 3. `architecture.md` already sanctions Trigger.dev; the table needs no new service. Your call. |
| 4 | Are the Instagram accounts **Professional** — Business or Creator? | Insights do not exist on personal accounts. Blocks B3; converting takes minutes. |
| 5 | Roughly how many hours of footage a month, and how large is the archive? | Decides Supabase Storage versus R2 (§2.3). Analysis is cheap; storing originals may not be. |
| 6 | Where does footage live today — Drive, a NAS, LucidLink, SD cards? | If it is already in Drive, "import from Drive" may beat browser upload as the primary path. Changes stage 2. |
| 7 | Is there a caption and brand style to match? | Feeds the ASS style block (D5). A screenshot of a recent Reel is enough. |

---

## 7. First commits

1. `au-content-engine` as a pnpm workspace: `apps/web` (Next.js 16), `services/worker`,
   `packages/schemas`, `eval`. `docs/` seeded with `STATUS.md`, `ROADMAP.md`,
   `architecture.md` and `CLAUDE.md` in the jarvis shape.
2. `packages/schemas`: `shot`, `concept` and `manifest` as **Zod** schemas, with the
   validator and time-range maths as pure functions under Vitest. This is the trust
   boundary — write it before anything that produces or consumes it.
3. `services/worker`: the D1 spike CLI, against real files and real models, no database.
4. Run it on five real AU projects; ratings into `eval/`.

Then hold the gate honestly. If the concepts are not good, the fix is the playbook,
the analysis schema and the critic — not the product surface around them.

---

## Appendix: constraints carried forward

None of the above relaxes any of these (PRD §23.2, Appendix D), and the first four
also restate house rules already in force:

- No model-generated shell commands. FFmpeg arguments are built from validated structures.
- No invented location, price, distance or factual claim.
- No invalid shot or time references — zero, not few.
- No permanent public URLs for private source media.
- No vendor model name in domain logic; everything through `lib/ai/*`.
- The Reel Strength Score is heuristic and is never called a virality prediction.
- No social publishing in Phase 1; when it comes, it routes through `lib/approvals/*`.
- Originals are immutable; crops and proxies never overwrite source.
