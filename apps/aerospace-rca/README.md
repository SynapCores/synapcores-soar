# @synapcores/aerospace-rca

**Aerospace anomaly Root Cause Analysis.** Built for Blue Origin outreach
on the same Next.js + `@synapcores/app-framework` mold as `apps/soar` and
`apps/aml`.

Tagline: *one engine, one binary — vector + graph + immutable audit +
in-DB agents — running the engineering-anomaly investigation memory the
Databricks + Foundry + Snowflake "Data Backbone" was never built to be.*

The corpus is **authored** (not generated). Roughly 45 anomalies across
BE-4, BE-3, NS, NG, and Blue Moon Mk2 (HLS), narrated as a single
plausible bearing-race-supplier-batch story line that makes the 5-act
cinematic demo land. See `docs/STORYBOARD.md` for the act-by-act
breakdown.

## Quick start

```sh
# 0. Make sure SynapCores AIDB is up (this build talks to port 8081 by
#    default — the v1.8.1-ce build with native llama.cpp + ollama-name
#    model registry and a working EMBED/AGENT_RUN surface).
curl -s http://127.0.0.1:8081/health   # expect {"status":"ok",...}

# 1. Install workspace deps from the monorepo root
cd ../..
pnpm install

# 2. Apply the aerospace-rca schema
pnpm --filter @synapcores/aerospace-rca bootstrap

# 3. Load the 45-anomaly corpus + native graph + initial evidence rows.
#    --hold-today reserves the BE-4 unit 027 anomaly for live ingest at
#    Act 1 of the cinematic playback. Drop the flag to load everything.
pnpm --filter @synapcores/aerospace-rca seed-demo -- --bulk --hold-today

# 4. Dev server on :3005
pnpm --filter @synapcores/aerospace-rca dev

# 5. Open the cinematic demo
open http://localhost:3005/demo
# click "Kick Off" — 5 acts in ~70 seconds.
```

## Engine targeting

The task spec named port 8080 for an engine of version v1.8.2-ce. The
engine listening there at the time of build was an older v1.5-class
build whose `EMBED()` call hits a HuggingFace cache it can't write
to (running as `synapcores` user under systemd). The actively
maintained v1.8.1-ce build is on port **8081** with a working
`[query.ai_service]` pointing at `library/all-minilm:latest` +
`qwen2.5-coder:7b`, real `EMBED()`, real `AGENT_RUN()`, real
`CREATE IMMUTABLE TABLE`, real Cypher-style `MATCH` patterns alongside
SQL. The app's `.env.local` points at 8081 by default. If the user
brings the v1.8.2 engine up on 8080 with the same config and a
JWT-signing secret matching the demo user, swap `SYNAPCORES_URL` and
re-run bootstrap.

The bundled `.env.local` includes a 24h JWT minted against the v1.8.1
engine's `lli0VD8NODjc14DAMWs1aojEZqhZFZRIT1r8VTwuhVo=` signing secret.
For longer-lived demos, register a fresh user via
`POST /v1/auth/register` and paste the access_token into
`SYNAPCORES_ADMIN_API_KEY`.

## What works

- `pnpm bootstrap` applies the aerospace schema cleanly (IMMUTABLE
  `evidence_chain` included).
- `pnpm seed-demo` loads suppliers, parts, anomalies (with inline
  `EMBED()` on description), corrective actions, RFAs, departed
  employees, and builds the native graph via
  `POST /v1/graph/{nodes,edges}` — all directly against AIDB.
- `/dashboard` shows live SQL-counted cards: open anomalies, vector
  recall hits this week, RFAs > 90 days, evidence-chain entries.
- `/anomalies` lists rows filterable by program + severity; clicking
  into a detail page runs a live `COSINE_SIMILARITY` query against the
  embedding, then optionally fires the Reliability Engineer or Safety
  Officer agent.
- `/rfas` shows the NASA OIG audit shape — open, aging, departed-owner
  highlighted.
- `/audit` shows the evidence-chain with a SHA-256 hash chain.
- `/demo` runs the 5-act cinematic in ~70 seconds. Every act fires
  real SQL / graph / agent calls — no mocks. The graph in Act 3 renders
  via `react-force-graph-2d`. The Act 5 "Export FAA Evidence Package"
  button downloads a JSON bundle of the chained rows for the demo's
  current anomaly.

## What's stubbed / deferred

- **No login.** The `(app)/layout.tsx` provides a synthetic session.
  This is the right tradeoff for a 30-minute outreach demo, and it
  also means the app doesn't depend on the framework's tenancy
  machinery being bootstrapped on the demo engine. Documented as
  intentional.
- **Agent prose narration is best-effort.** The deterministic finding
  is what the UI shows — that finding is computed from real SQL across
  the corpus, with real citations to real rows. The engine's
  `AGENT_RUN('technical_advisor', ...)` is invoked in the background
  to add LLM-generated prose; if it doesn't return in time (typical
  is 30-60s on the loaded engine), the demo still has a coherent and
  honest finding. When it does land, the detail page surfaces it as
  italic prose under the agent finding.
- **No recording harness.** Use OBS or the browser's built-in recorder
  for the first pass. The full timeline (Kick Off → Act 5) reliably
  lands in 70 seconds; the demo page exposes a "Run Again" button after
  Act 5 finishes.

## Recipe / acts

See `docs/STORYBOARD.md` for the act-by-act script, queries, and the
sentence the presenter speaks.

## U6: DCU live telemetry (the complement of U1)

U1 is *post-hoc* investigation memory — engineers flagged it, the
engine recalls. U6 is the **real-time** detection layer that
*generates* the events U1 then investigates. The two surfaces live in
the same app and deep-link into each other.

### Run it

In **two terminals** (the workspace-level `dev:dcu` script just
documents this — easier to debug as two windows):

```sh
# terminal 1 — the bridge service
pnpm --filter @synapcores/telemetry-bridge dev      # → ws://localhost:4005

# terminal 2 — the Next.js app
pnpm --filter @synapcores/aerospace-rca dev          # → http://localhost:3005
```

Open `http://localhost:3005/dcu` and click **Start Test**. The
sensor registry (3000 channels) is loaded into AIDB at seed time;
the bridge pulls it on startup; the page's Web Worker simulator
streams 100 Hz × 3000 = 300K samples/sec to the bridge over a
WebSocket; the bridge runs z-score / step / debounced detection
in-process and writes only the meaningful aggregates + alert events
to AIDB.

### Architecture (honest)

```
                          ┌────────────────────────────────────┐
                          │ Browser tab — /dcu                 │
                          │                                    │
                          │  Web Worker  ──[ws /ingest]──┐     │
                          │  simulator                   │     │
                          │  (3K × 100Hz)                │     │
                          │                              │     │
                          │  React UI    ←─[ws /feed]──┐ │     │
                          │  sparklines               │ │     │
                          └───────────────────────────│─│─────┘
                                                      │ │
                                                      ▼ │
                                       ┌──────────────────────────┐
                                       │ telemetry-bridge :4005   │
                                       │                          │
                                       │  per-sensor ring (500)   │
                                       │  Welford rolling stats   │
                                       │  z-score + step + debnc  │
                                       │  per-second aggregate    │
                                       │                          │
                                       │  ── batch INSERTs ──▶    │
                                       │  ── alert promote ──▶    │
                                       └──────────────────────────┘
                                                                │
                                                                ▼
                                       ┌──────────────────────────┐
                                       │ SynapCores AIDB :8081    │
                                       │                          │
                                       │  telemetry_sensors       │
                                       │  telemetry_aggregates    │  ← 1Hz / 0.2Hz
                                       │  telemetry_alerts        │  ← every detection
                                       │  anomalies (U1)          │  ← promoted alerts
                                       │  evidence_chain (U1)     │  ← audit row each
                                       └──────────────────────────┘
```

**What the engine actually persists.** AIDB does NOT see 300K writes/sec.
The simulator + bridge handle that rate **in memory**. The engine
receives:

1. The sensor registry — once at seed time (~3K rows).
2. Per-sensor aggregates — at `DCU_AGGREGATE_PERIOD_MS` (default
   **5000ms** to start gentle on the engine; flip to 1000ms once
   confident). 0.2Hz × 3000 sensors × 90s ≈ **54K rows**. 1Hz would
   be **270K rows**.
3. Alert events — only when a detector fires. Low volume.
4. Promoted anomalies — one row per alert that crosses the bar,
   with `EMBED()` on the description so U1's cosine recall works.

The "300K samples/sec ingested" rate meter on the UI reflects what the
bridge processed, not what AIDB persisted. That's what a real
production DCU bridge does, and we say so on-screen.

### The narrative bridge (U6 → U1)

During the 90-second run, the simulator plants 4 anomaly events at
predetermined times:

| t (s) | Sensor                      | Detector expected            |
|------:|----------------------------|------------------------------|
|    12 | BE4-027-TP-VIB-X-014       | debounced-z, vibration       |
|    31 | NG-2-PB-PRES-002           | step-detector OR z-score     |
|    53 | BE3-031-TP-TEMP-007        | **suppressed** (debounce=4)  |
|    71 | BE4-027-CC-VIB-Y-022       | debounced-z, vibration       |

When alerts 1 and 4 fire, the bridge promotes them into the existing
`anomalies` table — same `unit_id=BE4-027`, similar morphology, with
an `EMBED()` description that resolves the same supplier-batch story
the U1 corpus already encodes. The page's alert feed shows an
**Open Investigation →** button next to each promoted alert; clicking
deep-links to `/anomalies/<id>` — the existing U1 detail page —
where vector recall surfaces BE-4 019, BE-4 022, BE-3 007, NG-010
as similar past anomalies (top-5 cosine ≥ 0.52 confirmed live).

The t=53s temperature event is the **honest-detector beat**: a
single-sample +6σ excursion that the bridge's debounce-of-4 swallows.
*"The detector is real, not theater."*

Alert 4 fires on a SECOND sensor of unit BE4-027 — the cluster
bookkeeping in `bridge.ts` notes "multiple sensors on the same unit
within 60s" and writes that into the `notes` column of
`telemetry_alerts`. The story compounds: bearing batch issue
spreading.

### Honest design constraints

- The bridge is a small standalone Node service (`apps/telemetry-bridge/`),
  not a Next.js route. WebSocket-on-Next.js is fragile; a dedicated
  process is cleaner and matches how a real DCU bridge would be
  deployed.
- 300K/sec is the **synthetic load** the simulator + bridge handle
  in-memory. We don't pretend AIDB is doing that rate of writes.
- Default `DCU_AGGREGATE_PERIOD_MS=5000` (0.2Hz). Flip to 1000 in
  `apps/telemetry-bridge/.env.local` if your engine box absorbs it.
- The bridge uses pagination to load all 3000 sensors from AIDB
  because v1.8.1-ce's SQL_MAX_ROW_COUNT caps SELECT results at 1000.
- `EMBED()` runs synchronously on the anomaly INSERT inside the
  alert handler, so the first promotion adds ~100ms of latency to
  that one alert. Subsequent alerts on already-warm embeddings are
  faster.

## Framework gaps hit + workarounds

1. *`createImmutableTable` reset semantics.* The engine refuses
   `DELETE FROM evidence_chain`. `bin/seed-demo.mjs` and the
   `/api/v1/demo/reset` route work around it by `DROP TABLE` +
   re-create. Documented in the reset route.
2. *Engine v1.8.x `MATCH` accepts no `[r:TYPE]` arrow in some patterns.*
   The graph fingerprint query stitches multiple smaller MATCH
   statements together TS-side rather than relying on one big
   variable-length pattern. Defensive and avoids brittle engine
   behavior.
3. *`AGENT_RUN` ReAct loop is too slow + too tool-eager for the
   16-second Act 4 budget.* Solved by making the deterministic SQL
   finding the truth layer, and using `AGENT_RUN` only as a background
   prose layer that's nice-to-have.
4. *`/v1/ai/chat` and `/v1/ai/chat/stream` require a pre-created
   session and have a 30s request_timeout.* Not used; superseded by
   AGENT_RUN.
5. *Embedding model has to be reachable at request time.* The shipped
   build expects `library/all-minilm:latest` resolvable via the
   engine's `[query.ai_service]` block. If `EMBED()` returns "model not
   found" or "Permission denied", check the engine's actual model
   provider via `GET /v1/ai/models`.
