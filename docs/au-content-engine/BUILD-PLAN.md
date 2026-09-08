# AU Content Engine — Build Plan

Response to *Africa Unexpected | AU Content Engine — Product Requirements & Technical
Specification v1.0* (8 September 2026).

This document answers two questions: **which repository**, and **what I would change
about the plan before writing code**. It assumes the PRD as the baseline and only
records deltas and additions.

---

## 1. Repository verdict: start a new one

**Recommendation: build AU Content Engine in a new repo. Keep `AfricaUnexpected` as
the website CMS, and wire it in as a read-only facts source.**

### What `AfricaUnexpected` actually is

| | |
|---|---|
| Stack | Strapi 5.12.7, TypeScript, SQLite by default |
| History | 3 commits, last `7874315` (May 2025) |
| Content types | `Stay`, `Itinerary`, `Challange`, `Tool`, plus `ChallengeOld` / `Testing Type` leftovers |
| Purpose | Membership website backend — tiers `free` / `spark` / `live` / `wild` |

It is a healthy little CMS for the AU site. It is the wrong host for the Content Engine:

1. **Different runtime.** The engine's heavy half is Python + FFmpeg + PySceneDetect
   in a container with pinned codec dependencies. Strapi is a long-running Node
   service with a plugin/admin model that has no use for any of that.
2. **Different deploy shape.** Strapi is one always-on process. The engine is a web
   app plus media workers that must scale, restart and fail independently.
3. **Blast radius.** The CMS backs a paying membership site. An experimental render
   worker should not be able to take it down, and a Strapi upgrade should not be
   able to stall a render queue.
4. **Different data.** Strapi owns published editorial content. The engine owns raw
   footage, shot catalogues, embeddings, manifests and metric snapshots — an order of
   magnitude more rows, with `pgvector`, and a schema that will churn weekly during
   Phase 1.

### But do not treat them as unrelated

The `Stay` content type already carries `title`, `location`, `priceRange`,
`bestSeason`, `recommendedStay` and `affiliateUrl`. Those are precisely the fields
the PRD's grounding rules (§6.8) demand before a Reel may state a price, a location
or a distance as fact. See **D3**.

**Proposed repos**

| Repo | Owns |
|---|---|
| `AfricaUnexpected` (existing) | Website CMS. Unchanged, except it becomes the source of verified facts. |
| `au-content-engine` (new) | Monorepo: `apps/web` (Next.js), `services/worker` (Python), `packages/schemas` (shared JSON Schema / types), `infra`, `eval`. |

---

## 2. Eight changes to the PRD

The spec is strong and I would follow most of it as written. These are the places I
would deviate, with reasons.

### D1 — Cut the service count. Drop Redis; use Postgres as the queue.

The PRD (§8.1) specifies web app + application API + Redis-backed durable queue +
Python worker + Postgres + object storage. That is five deployables for a tool with
two users and, realistically, tens of jobs per day.

**Instead:**

| Piece | Choice |
|---|---|
| Web + API | Next.js (route handlers). One deployable. |
| Database | Postgres with `pgvector`. Supabase is fine; so is any managed Postgres. |
| Queue | **Postgres.** A `jobs` table with `SELECT … FOR UPDATE SKIP LOCKED`, a lease column and a heartbeat. Or `pgmq`. |
| Worker | Python container. FFmpeg, PySceneDetect, provider adapters. One deployable. |
| Storage | Cloudflare R2. Free egress matters — previews get scrubbed repeatedly. |

Two deployables, two managed services. Redis buys throughput AU will never reach,
and costs an extra piece of infrastructure to run, monitor and back up. A Postgres
queue is durable, transactional with the domain writes, and — the underrated part —
inspectable with SQL when something is stuck at 2am.

This keeps every requirement in §8.4: idempotency keys, leases, heartbeats,
progress events, safe recovery of abandoned jobs. It just doesn't need Redis to
get them.

*Revisit if:* render volume ever exceeds a few hundred jobs/day, or you need
fan-out across many workers.

### D2 — Replace the Phase 0 vendor bake-off with a one-week quality spike.

The PRD's Phase 0 (§20.1) asks for OpusClip, Vizard and Klap API integrations across
10–20 projects before committing. That is real engineering — auth, upload, polling,
result normalisation — for code that gets thrown away.

The binding risk is not *"is OpusClip good?"*. It is **"can a multimodal model
produce concepts Craig and Nicky would actually post, from AU's own footage?"** If
the answer is no, no amount of Next.js rescues it. If yes, the vendor comparison is
a footnote.

**Instead — Week 1, CLI only. No UI, no database, no queue:**

```
au ingest   ./cederberg-trip/     ->  assets.json   (ffprobe + proxies + thumbs)
au shots    assets.json           ->  shots.json    (PySceneDetect + Gemini analysis)
au concepts shots.json            ->  concepts.json (planner -> critic -> diversity)
au render   concepts.json --pick 2 -> out.mp4       (manifest -> FFmpeg)
```

Run it over five real projects spanning the range in §3.2 — accommodation reveal,
wildlife, drone/scenic, a talking-to-camera piece, and a deliberately weak folder.
Craig and Nicky rate every concept on the §2.2 rubric. **Gate: at least three of the
five projects produce one concept worth generating.**

For the vendor comparison, buy one month of OpusClip and paste the same five folders
in by hand. An afternoon, no code, same answer.

This is the PRD's own advice in §23.3 — I am just making it literally the first
sprint, and every line of it survives into the real worker as the adapter layer.

### D3 — Ground factual claims in the Strapi CMS.

The PRD's single largest creative risk is hallucinated facts (§22), and it is most
dangerous exactly where AU's best content lives: accommodation. "Less than 2 hours
from Cape Town", "R950 a night", "in the Cederberg" — a model must never infer any
of these from pixels.

The CMS already knows them. Add a provider:

```
VerifiedFactsProvider.for_project(project) -> VerifiedFacts
```

backed by the Strapi REST API. When a project is tagged to a `Stay`, its `location`,
`priceRange`, `bestSeason` and `recommendedStay` enter the planner prompt as
`verified_facts` and nothing else may be stated as fact. Three consequences worth
having:

- The Reel and the website page cannot contradict each other.
- `affiliateUrl` becomes the natural CTA for the caption — the engine starts
  earning, not just costing.
- Facts arrive as data, so the "Needs confirmation" flag in §5.4 fires on genuinely
  unverified claims instead of on everything.

Read-only, over HTTP, behind an adapter. No shared database, no coupling of deploys.

### D4 — Pull a thin, read-only monitor forward and run it in parallel.

The brief for this work says *"create reels **and monitor and manage** our videos"*.
The PRD defers all analytics to Phase 2 (§13), gated on Phase 1 quality.

I would keep the gate for the *learning* system (§13.3's causal questions genuinely
need Phase 1 volume) but ship a read-only monitor from week two, as **Track B**,
because:

- It touches none of the media pipeline. Different code, different risk, genuinely
  parallelisable.
- YouTube Data + Analytics API is a couple of days' work and gives Craig something
  useful on day 10, while the creative engine is still rough.
- **Metric history cannot be backfilled.** §24.1 needs snapshots at 1h / 6h / 24h /
  72h / 7d / 28d. Every week Track B is deferred is a week of matched-age history
  that never exists. This is the argument that actually decides it.

Scope, deliberately narrow: connect YouTube and the Instagram professional account,
snapshot metrics on the §24.1 schedule into append-only `metric_snapshots`, and one
dashboard page — what we posted, how it is doing, at matched ages. **No publishing,
no scheduling, no competitor data.** Those stay where the PRD put them.

### D5 — Add `moments` inside shots. A shot is the wrong unit for a Reel beat.

PySceneDetect returns shot boundaries. A shot can run eight seconds; the beat that
belongs in the Reel is the 1.2 seconds where the giraffe turns its head. If the edit
planner may only choose whole shots, cuts land slack and the pacing component of the
Reel Strength Score is capped by the scene detector.

Extend the analysis schema (§9, Appendix A.1) so each shot carries candidate
sub-ranges:

```json
"moments": [
  {"start_ms": 13100, "end_ms": 14300, "role": "reveal",
   "why": "giraffe turns toward camera", "strength": 0.91}
]
```

The edit planner then selects moments, not shots, and the validator checks each
moment is inside its parent shot, which is inside its asset. Same trust boundary,
finer granularity, and it makes "make the first 3 seconds stronger" a real operation
instead of a shot swap.

### D6 — Captions in ASS/libass. Not `drawtext`, not Remotion.

Word-level captions are the visual signature of the format and the place FFmpeg
work usually goes bad. Chaining one `drawtext` filter per word is unmaintainable;
adding Remotion means a Node render service, a browser and a second rendering model
this early.

Generate an **ASS subtitle file** and burn it in one `subtitles` pass. libass gives
styled text, outlines, shadows, positioning, safe-area margins and `\k` karaoke
timing for word highlighting. It is one text file per render — which means caption
styling is a diffable artifact, testable without decoding a frame, and a brand
preset (§FR-016) is just a style block.

Keep Remotion behind the flag the PRD already suggests, for animated graphics later.

### D7 — Render in two stages, with a segment cache.

AU footage is mixed by nature: portrait phone at 60fps, 4K drone at 30, action cam,
a finished YouTube export. Concatenating those directly is the most common source of
black frames, audio drift and rotation bugs — exactly the §21.2 render-correctness
gate.

**Stage 1** — render each segment independently to a normalised intermediate: target
fps, `1080x1920`, same pixel format, same timebase, crop and audio gain applied.
Key the output on `hash(asset_checksum, in_ms, out_ms, crop, audio_db, renderer_version)`.
**Stage 2** — concat the intermediates, burn captions and overlays, encode once.

The cache is what makes the constrained editor feel fast. Change the hook text and
stage 1 is entirely cached — you re-run one overlay pass, not seventeen seconds of
video. Reorder shots: also fully cached. This turns §FR-012's "regenerate this
section" from a full re-render into a few seconds.

### D8 — Ship one crop mode plus manual override. Measure before building focus tracking.

§7.3 lists five crop policies including `animated_focus`, which needs per-frame
subject detection — a real subsystem.

Phase 1 ships three: `smart_9x16` from the model's single static `crop_hint`,
`manual_focus` (drag the box, stored as an editable parameter), and
`fit_blur_background` as the fallback for wide compositions. Then instrument the
crop-correction rate the PRD already asks for in §11.5, and let it decide whether
`animated_focus` is worth building. If Craig corrects 5% of crops, it is not.

---

## 3. Architecture

```
                 ┌──────────────────────────────┐
  browser  ────► │  apps/web  (Next.js + TS)    │
                 │  upload · concepts · editor  │
                 │  monitor dashboard           │
                 └───────┬──────────────┬───────┘
                         │              │
              signed PUT │              │ SQL
                         ▼              ▼
              ┌────────────────┐  ┌──────────────────────────┐
              │ R2 / S3        │  │ Postgres + pgvector      │
              │ originals      │  │ domain tables            │
              │ proxies        │  │ jobs (SKIP LOCKED queue) │
              │ renders        │  │ metric_snapshots         │
              └────────┬───────┘  └────────────┬─────────────┘
                       │                       │
                       │      claim / heartbeat│
                       ▼                       ▼
              ┌──────────────────────────────────────────────┐
              │ services/worker  (Python, containerised)     │
              │  ffprobe · FFmpeg · PySceneDetect · libass   │
              │  ┌────────────────── adapters ─────────────┐ │
              │  │ VideoUnderstanding · Transcription      │ │
              │  │ Embedding · StoryModel                  │ │
              │  │ VerifiedFacts (Strapi) · Analytics      │ │
              │  └─────────────────────────────────────────┘ │
              └──────────────────────────────────────────────┘
                       │                       │
                       ▼                       ▼
               AI providers            Strapi CMS (read-only)
                                       YouTube / IG (read-only)
```

Every PRD adapter interface from §8.3 is preserved. `VerifiedFactsProvider` is new
(D3). The trust boundary from §10.1 is unchanged and absolute: **the model returns
schema-validated JSON; domain code validates ownership, ranges and file references;
renderer code builds FFmpeg arguments from the validated structure. No model output
ever reaches a shell.**

---

## 4. Build sequence

Two tracks. Track A is the PRD's Phase 1. Track B is D4.

| # | Track A — Creative engine | Gate |
|---|---|---|
| 0 | **Spike (D2).** CLI: ingest → shots → concepts → render. Five real projects, human-rated. | 3 of 5 projects yield a concept worth generating. **Stop here if not met.** |
| 1 | Repo, CI, migrations, single workspace, auth. Project CRUD. | Project persists and reopens. |
| 2 | Resumable multipart upload to R2. Asset records, checksum, ffprobe, state machine. | 50 files survive a dropped connection. |
| 3 | Job table, claim/lease/heartbeat, retry, progress events, job dashboard. | Kill a worker mid-render; it recovers, no duplicates. |
| 4 | Proxies, thumbnails, audio derivatives, shot detection. | Shot grid renders from proxies, correct rotation. |
| 5 | Transcription + multimodal analysis adapters. Moments (D5). Embeddings + semantic search. | "elephants close to the car" returns the right shots. |
| 6 | Playbook v1, planner, critic, diversity + grounding validators, Reel Strength Score, concept gallery. Verified facts from Strapi (D3). | 3–5 distinct grounded concepts; zero invalid shot refs. |
| 7 | Manifest schema + validator. Two-stage renderer with segment cache (D7). ASS captions (D6). Crop modes (D8). Preview. | Fixture suite passes §21.2 render gates. |
| 8 | Constrained editor: trim, reorder, replace, overlay text, regenerate section. Versioning. | Any edit creates a recoverable version. |
| 9 | Final 1080×1920 export. Eval regression suite. Telemetry. Hardening. | Full §21.1 acceptance test passes. |

| # | Track B — Channel monitor (parallel, from stage 2) | Gate |
|---|---|---|
| B1 | YouTube OAuth, channel + video metadata, Analytics API pull. | Real AU numbers on screen. |
| B2 | `metric_snapshots` append-only, scheduled capture at §24.1 windows. | Matched-age history accumulating. |
| B3 | Instagram professional account insights. | Reels metrics landing. |
| B4 | One dashboard: posts, matched-age comparison, outlier score (§24.2) with sample size shown. | Craig can answer "how is last week doing?" without opening four apps. |

Rough shape for one focused developer: spike in week 1, Track A stages 1–4 in weeks
2–4, 5–6 in weeks 5–7, 7 in weeks 8–9, 8–9 in weeks 10–12. Track B fits in the gaps
and is roughly a week of work in total. Call it **three months to the PRD's
Definition of Done**, and treat that as aggressive rather than padded.

---

## 5. Data model additions

On top of §9:

| Table | Change |
|---|---|
| `jobs` | New. `id, kind, idempotency_key UNIQUE, payload_json, state, attempts, lease_until, heartbeat_at, progress_json, error_json`. The queue (D1). |
| `shots` | Add `moments_json` (D5). |
| `render_segments` | New. Segment cache (D7): `cache_key UNIQUE, storage_key, renderer_version, created_at, last_used_at`. |
| `verified_facts` | New. Snapshot of the Strapi record used at generation time (D3): `project_id, source ('strapi_stay'), source_ref, facts_json, captured_at`. Snapshot, not a live lookup — so a render is reproducible even after the CMS changes. |
| `ai_runs` | Add `cost_usd`, `input_tokens`, `output_tokens`. Cost is a first-class field, not a log line. |

Everything else — the future analytics and competitor tables — I would create as
migrations now and leave empty, exactly as §23 recommends.

---

## 6. Decisions needed

| # | Question | Why it matters now |
|---|---|---|
| 1 | New repo `au-content-engine`, or force it into `AfricaUnexpected`? | Blocks stage 1. Recommendation above. |
| 2 | Where does this run? | Vercel + a worker host (Fly/Railway/Render), or one VPS with Docker Compose. The second is cheaper and simpler for two users; the first is less to operate. |
| 3 | Is there a Google Cloud / Gemini API account? | Blocks the week-1 spike. |
| 4 | Are the Instagram accounts **Professional** (Business or Creator)? | Insights are unavailable on personal accounts. Blocks B3, and the conversion takes minutes. |
| 5 | Roughly how many hours of footage per month, and how much archive? | Sizes storage and the analysis budget. §19 suggests analysis is cheap; storage of originals may not be. |
| 6 | Where does footage live today — Drive, a NAS, LucidLink, SD cards? | If it is already in Drive, "import from Drive" may beat browser upload as the primary path. Changes stage 2. |
| 7 | Is there an existing caption/brand style to match? | Feeds the ASS style block in D6. A screenshot of a recent Reel is enough. |

---

## 7. What I would do first

Concretely, the next commit after this document is agreed:

1. Create `au-content-engine`, monorepo skeleton, `docker-compose` with Postgres +
   pgvector + MinIO for local development.
2. `packages/schemas`: `shot.v1`, `concept.v1`, `manifest.v1` as JSON Schema, with the
   validator and the time-range maths under unit test. This is the trust boundary
   (§10.1) and it is worth writing before anything that produces or consumes it.
3. `services/worker`: the D2 CLI, hitting real files and a real model, no database.
4. Run it on five real AU projects and put the ratings in `eval/`.

Then hold the gate honestly: if the concepts are not good, the fix is the playbook,
the analysis schema and the critic — not the product surface around them.

---

## Appendix: PRD constraints carried forward unchanged

For the avoidance of doubt, none of the deltas above relax these (§23.2, Appendix D):

- No model-generated shell commands.
- No invented location, price, distance or factual claims.
- No invalid shot or time references.
- No permanent public URLs for private source media.
- No vendor model name hardcoded into domain logic.
- The heuristic Reel Strength Score is not, and is never labelled, a virality prediction.
- No social publishing in Phase 1.
- Originals are immutable; crops and proxies never overwrite source.
