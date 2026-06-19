# Aerospace-RCA — Public-Release Handoff

This doc is the pick-up brief for the three open tracks. Written **2026-06-19**
at the end of the session that hardened the workflow-studio wizard and tagged
v1.8.7-ce. Subsequent sessions should read this first, then dive into whichever
track they're working on.

Owner of all three: future Claude Code sessions. Cross-link to the canonical
tasks (#413, #414, #416) in the aidb project's task list.

---

## State at the moment of handoff

- **Engine:** v1.8.7-ce released (linux + docker via run 27823625202, mac Phase 2
  dispatched separately). New SQL surface this release: `json_object()` helper
  + GENERATE options bag (max_tokens / temperature / top_p / top_k /
  repeat_penalty / seed / system / grammar / grammar_triggers /
  response_format). All documented in `AIDB_SQL_MANUAL.md`,
  `crates/aidb-mcp-server/src/tools/sql_manual.rs`, and the homepage SQL
  reference.
- **Docker image:** `synapcores/community:latest` → v1.8.7.
- **Workflow-studio:** v0.1.0-alpha.3 (wizard hardened, alpha frozen per user
  directive). Commit `28c6abb` on `feat/workflow-studio`. Not running by
  default; the wizard work informed the build-with-ai post-processor but is
  unrelated to aerospace.
- **Aerospace-rca app:** README cleaned (`bf001b1`). `.env.example` now defaults
  to `http://127.0.0.1:28080` (canonical Docker port). Stale `v1.8.1-ce` /
  `v1.8.2-ce` / port `8081` references removed. The dead "MATCH [r:TYPE]
  gotcha" framework gap is dropped (verified against v1.8.6+). The
  `SQL_MAX_ROW_COUNT` pagination workaround is replaced with the
  per-request `max_rows: 5000` note.
- **Public repo target:** `SynapCores/synapcores-aerospace-rca` exists as
  private + empty. Description: *"AIDB vertical demo: aerospace anomaly
  investigation memory + DCU telemetry detection. Private — under review
  before OSS flip."*
- **Telemetry-bridge:** `apps/telemetry-bridge` in synapcores-apps. Currently
  reads from an in-browser Web Worker simulator. Runs real z-score / step /
  debounce detection — the bridge itself is not a mock, only its current
  upstream is.

---

## Track A — Docker compose bundle (Task #413)

**Goal:** `git clone && docker compose up && open localhost:3005/demo` is the
entire onboarding for a prospect.

### Architecture

3 services. Pull `synapcores/community:latest` (now v1.8.7) for the engine, two
local Dockerfiles for the app + bridge.

```yaml
# docker-compose.yml (sketch)
services:
  engine:
    image: synapcores/community:latest
    ports: ["28080:28080"]
    volumes: ["./aidb_data:/opt/synapcores/aidb_data"]
    environment:
      - SQL_MAX_ROW_COUNT=5000   # so the bridge's 3000-channel load doesn't truncate
    healthcheck:
      test: ["CMD", "curl", "-f", "http://127.0.0.1:28080/health"]
      interval: 10s
      retries: 30

  bridge:
    build: { context: ./telemetry-bridge }
    depends_on:
      engine: { condition: service_healthy }
    environment:
      - SYNAPCORES_URL=http://engine:28080
      - SYNAPCORES_ADMIN_API_KEY=${SYNAPCORES_ADMIN_API_KEY:-dev-jwt}
    ports: ["4005:4005"]

  app:
    build: { context: ./aerospace-rca }
    depends_on:
      engine: { condition: service_healthy }
    environment:
      - SYNAPCORES_URL=http://engine:28080
      - SYNAPCORES_ADMIN_API_KEY=${SYNAPCORES_ADMIN_API_KEY:-dev-jwt}
      - NEXT_PUBLIC_BRIDGE_URL=ws://localhost:4005
    ports: ["3005:3005"]
    command: >
      sh -c "node bin/bootstrap.mjs &&
             node bin/seed-demo.mjs --bulk --hold-today &&
             node server.js"
```

### Steps

1. **Extract the public repo skeleton.** The target is empty.
   `apps/aerospace-rca/` and `apps/telemetry-bridge/` live inside the
   `synapcores-apps` monorepo and depend on the framework package
   `@synapcores/app-framework`. Three sub-options:
   - **a. Vendor the framework into the public repo** — copy the framework
     code into a `packages/app-framework/` folder. Pros: self-contained.
     Cons: vendored copy will drift.
   - **b. Publish the framework to npm** (`@synapcores/app-framework`) and
     `npm install` it in the public repo. Pros: clean. Cons: requires
     publishing the framework which we haven't done.
   - **c. Vendor only the bits aerospace actually uses** — auth helpers,
     UI shells, Zustand store conventions. Pros: smaller surface. Cons: hand
     work to identify what's needed.
   **Recommend (a)** for the first cut. Vendor it. The framework isn't
   moving fast and aerospace can re-sync later.

2. **Write the two Dockerfiles.**
   - `aerospace-rca/Dockerfile`: Next.js standalone build (`output: 'standalone'`
     in `next.config.ts`). Multi-stage: deps → build → runtime. ~150 MB final.
   - `telemetry-bridge/Dockerfile`: Node 20 alpine, copy bridge sources, expose
     4005. ~80 MB.

3. **Write the `docker-compose.yml`** as sketched above. Add a `.env.example`
   covering `SYNAPCORES_ADMIN_API_KEY` (the bundled demo JWT works, mint a
   24h one).

4. **Write the entry script** that idempotently bootstraps + seeds + serves.
   Test it on a clean machine.

5. **Write the public README** — `/README.md` at the repo root. Re-use the
   existing `apps/aerospace-rca/README.md` content as a base; trim
   internal-only sections.

6. **Push to `SynapCores/synapcores-aerospace-rca`** main branch.

7. **Decide:** stay private during a dry-run period, then flip to public
   with user sign-off. Do NOT flip without user approval — per the
   `feedback_no_unapproved_releases` rule, this counts as a public surface
   change.

### Files to write

```
synapcores-aerospace-rca/
├── README.md                  # outward-facing, derived from apps/aerospace-rca/README.md
├── HANDOFF.md                 # (move this doc here)
├── docker-compose.yml
├── .env.example
├── aerospace-rca/             # (or apps/aerospace-rca/ — match the existing structure)
│   ├── Dockerfile
│   └── ... copy from monorepo
├── telemetry-bridge/
│   ├── Dockerfile
│   └── ... copy from monorepo
├── packages/
│   └── app-framework/         # vendored, option (a)
└── docs/
    ├── STORYBOARD.md          # already exists
    └── REAL-TELEMETRY.md      # Track B
```

### Open questions

- Should the engine's `aidb_data/` be a named volume so demo data persists
  across `docker compose down`? Probably yes.
- Should we ship a `cosmos` profile in compose (track C) that uses COSMOS as
  the upstream instead of the Web Worker?
- Bundled JWT — currently we ship one tied to the demo tenant. For a public
  Docker, mint a fresh JWT on first run via a bootstrap step? Or accept that
  the bundled one is fine for an outreach demo?

---

## Track B — Cinematic recording (Task #412)

**Goal:** ~70-second MP4 walking the 15-act STORYBOARD, suitable for the
homepage and outreach email.

### Pattern to reuse

`~/scratch/wf-demo/record-demo.mjs` was built for workflow-studio and is the
template. Key infra: Playwright `recordVideo`, session-cookie injection
(bypasses the form-action issue), `document.fonts.ready` wait, visible-cursor
DOM injection, slow-mo per action so the demo reads on tape.

### Aerospace differences from the studio recording

1. **Two entry points:**
   - `/demo` — the 5-act U1 playback (Kick Off → Act 5 export). The "Run
     Again" button at the end makes this idempotent.
   - `/dcu` — the U6 live telemetry surface. Click **Start Test** and let
     the BE-4 fault profile run for ~90s before the alert fires (Act 2).
2. **Cross-page transition.** Act 6 (per STORYBOARD.md) navigates from the
   `/dcu` alert into `/anomalies/ANM-LIVE-BE4-027-XXXXXX`. The recording
   must follow this hop. Either let Playwright follow it via the in-app
   button, or split into two takes and stitch in post.
3. **Agent prose timing.** The Act 4 agent finding has a deterministic
   answer plus optional LLM prose. The deterministic part lands in <1s; the
   prose lands in 30-60s. The recording should NOT wait for prose — it
   produces a coherent take with deterministic-only, and if prose lands it
   appears in the next replay.
4. **Run length.** The STORYBOARD says 70s reliable. With slow-mo for tape
   that's probably ~110s of raw recording → ~80s of final cut.

### Steps

1. **Run the demo end-to-end manually first** against the v1.8.7 engine to
   make sure the storyboard still lands. The 5-act `/demo` is the highest
   risk — agent finding + cosine similarity + force-graph all in 70s.
2. **Adapt `record-demo.mjs`:**
   - Change `STUDIO_URL` → aerospace URL (`http://localhost:3005`)
   - Change `STUDIO_PASSWORD` / synthetic session → use the bundled demo
     session (aerospace has no login per its README intentional cut)
   - Change the modal/wizard selectors → the `Run Demo` / `Start Test`
     buttons on `/demo` and `/dcu`
   - Add the `/dcu → /anomalies/...` navigation hop
3. **Record two takes:** `/demo` 5-act (highest-value) and `/dcu` live
   detection → `/anomalies` Act 6 deep-link (the U6 story).
4. **Post-process:** ffmpeg concat + add the same kind of cinematic
   storyboard captions (see `~/scratch/wf-demo/STORYBOARD.md` for the
   pattern). Aerospace's `docs/STORYBOARD.md` already has the act timeline.
5. **Drop the MP4** at `synapcores-aerospace-rca/docs/demo.mp4` (or upload
   to the homepage CDN and link).

### Smoke test before the real take

```bash
# In one terminal:
pnpm --filter @synapcores/telemetry-bridge dev   # ws://localhost:4005

# In another:
pnpm --filter @synapcores/aerospace-rca dev      # http://localhost:3005

# Open the app, click through the storyboard manually.
# If anything in act 2 (live alert) doesn't fire, fix that first.
```

### Open questions

- Do we want subtitles burned in (broadly accessible) or open captions
  (cleaner for marketing)?
- Music bed? The studio recording had a music cue plan in the storyboard.
- Single MP4 or split (one per surface)? Single is the safer marketing pick.

---

## Track C — OpenC3 COSMOS adapter (Task #416)

**Goal:** the bridge ingests telemetry from OpenC3 COSMOS instead of (or
alongside) the in-browser Web Worker. Positions the demo as a real aerospace
integration story, not a toy. Marketing value: *"plugs into the same
packet-based stack Ball Aerospace ships."*

### What COSMOS is

[OpenC3 COSMOS](https://openc3.com) — Apache 2.0, spun out of Ball Aerospace
COSMOS, packet-based command-and-control platform. Active project. Used in
real aerospace work.

Relevant surfaces:
- **Mission Database (MDB)** — packet definitions in YAML. Each telemetry
  packet has a name, source target, and a list of items with bit ranges and
  data types.
- **WebSocket API** — `/script-api/ws` streams telemetry packets in JSON.
- **Simulator targets** — COSMOS ships an `EXAMPLE` target with simulated
  telemetry. Plus a `INST` (Instrument) example. Easy to write a `BE4`
  target with bearing-race-fault profile.

### Adapter design

```
+------------------------+        WebSocket JSON          +-------------------+
| OpenC3 COSMOS          |  -------------------------->   | telemetry-bridge  |
| (target=BE4)           |       packet stream            |  + COSMOS adapter |
+------------------------+                                +---------+---------+
                                                                    |
                                                                    | unchanged
                                                                    v
                                                          +--------------------+
                                                          | aerospace_telemetry|
                                                          | + alerts INSERT    |
                                                          | + EMBED on anomaly |
                                                          +--------------------+
```

The bridge's internal stream shape stays the same. The adapter is a thin
translator from COSMOS packet → bridge's internal sample.

### Steps

1. **Read the COSMOS WebSocket docs.**
   - Start here: <https://docs.openc3.com/docs/development/scripting-api/>
     and <https://docs.openc3.com/docs/configuration/telemetry>.
   - The packet stream comes from `/script-api/streams/telemetry_stream`.
     Subscribe by `target/packet/item` triple.

2. **Decide the BE-4 packet shape.** Something like:
   ```yaml
   TELEMETRY BE4 TURBOPUMP BIG_ENDIAN "Turbopump telemetry"
     APPEND_ITEM BEARING_TEMP_C 32 FLOAT
     APPEND_ITEM VIBRATION_RMS  32 FLOAT
     APPEND_ITEM SHAFT_RPM      32 FLOAT
     APPEND_ITEM CHAMBER_PSI    32 FLOAT
   ```
   Plus a few hundred other items to match the demo's 3000-channel scale.
   The demo's anomaly is bearing-race-carbon-deposit so the meaningful
   channels are `BEARING_TEMP_C`, `VIBRATION_RMS`, `SHAFT_RPM`.

3. **Write the COSMOS sim target** that emits a steady-state profile + a
   ramp-up bearing-fault profile. Looks like a Ruby script under
   `targets/BE4/lib/be4_sim.rb`. Reference: COSMOS's `EXAMPLE` and `INST`
   targets.

4. **Write the adapter in the bridge** (`apps/telemetry-bridge/src/cosmos.ts`):
   ```ts
   import WebSocket from 'ws';
   import type { BridgeSample } from './types';

   export function startCosmosAdapter(cosmosWsUrl: string, onSample: (s: BridgeSample) => void) {
     const ws = new WebSocket(cosmosWsUrl);
     ws.on('message', (raw) => {
       const packet = JSON.parse(raw.toString());
       // Translate COSMOS item layout → BridgeSample
       onSample({
         ts: Date.now(),               // or packet.received_time_seconds
         channel: packet.target + '.' + packet.packet,
         value: packet.value,          // pick the item the bridge cares about
         metadata: { ... },
       });
     });
   }
   ```

5. **Add a `BRIDGE_SOURCE` env var** in the bridge config:
   - `BRIDGE_SOURCE=mock` (default) — uses the existing Web Worker
   - `BRIDGE_SOURCE=cosmos` — uses the COSMOS adapter; requires
     `COSMOS_WS_URL=ws://cosmos:7777/script-api/streams/telemetry_stream`

6. **Add a `cosmos` profile to docker-compose** that brings up:
   - OpenC3 COSMOS (their official `docker.openc3.com/openc3-cosmos`)
   - The bridge with `BRIDGE_SOURCE=cosmos`
   - The aerospace app
   ```yaml
   # docker-compose.cosmos.yml
   services:
     cosmos:
       image: docker.openc3.com/openc3-cosmos:latest
       # ... config
     bridge:
       environment:
         - BRIDGE_SOURCE=cosmos
         - COSMOS_WS_URL=ws://cosmos:7777/script-api/streams/telemetry_stream
   ```

7. **Document the integration pattern** in
   `synapcores-aerospace-rca/docs/REAL-TELEMETRY.md` (this also satisfies
   Track 2 / Task #414).

### Open questions

- Auth: COSMOS has its own auth. The bridge needs credentials baked into
  env, or a service-account token.
- Sample rate: COSMOS packet rates are typically 1-10 Hz, the demo's
  Web Worker mock does 100 Hz. The bridge handles either; document the
  COSMOS-typical rate.
- Which COSMOS image — open-source `openc3-cosmos` or their hosted
  Enterprise edition? Use OSS for the integration.
- Does COSMOS rate-limit subscriptions? Check before committing to a
  3000-channel subscribe.

---

## Cross-cutting notes

### The `apps/telemetry-bridge` is real, the simulator is a Web Worker

When marketing positions the aerospace demo, do NOT call the bridge a
mock. The bridge runs real z-score / step / debounce detection on a real
WebSocket stream. The mock is the *upstream* of that stream — currently an
in-browser simulator, in Track C it becomes COSMOS. Keep this distinction
in the public README.

### Memory rules in play during release

- `feedback_no_unapproved_releases` — even flipping the
  `synapcores-aerospace-rca` repo from private to public counts as a
  public-surface change, needs sign-off.
- `feedback_release_docs_gate` — every release with new SQL surface must
  be in `sql_manual.rs` + `AIDB_SQL_MANUAL.md` + homepage before build.
  Satisfied for v1.8.7.
- `feedback_test_config_path_not_env` — when smoke-testing, use the
  documented `gateway.toml` config, not env shortcuts.

### Useful paths

| What | Where |
|---|---|
| Engine source | `/home/devops/IP/GPT/aidb` (worktree) and `/home/devops/scratch/aidb-v187-genai` |
| Aerospace app | `/home/devops/IP/GPT/synapcores-apps/apps/aerospace-rca` |
| Telemetry bridge | `/home/devops/IP/GPT/synapcores-apps/apps/telemetry-bridge` |
| App framework | `/home/devops/IP/GPT/synapcores-apps/packages/app-framework` |
| Homepage | `/home/devops/work/synapcores-homepage` |
| Workflow-studio recorder | `/home/devops/scratch/wf-demo/record-demo.mjs` |
| Release-CE skill | `/home/devops/IP/GPT/aidb/.claude/skills/release-ce/SKILL.md` |
| Tasks tracker | aidb project task list (#412, #413, #414, #416) |

### Things NOT to do (per memory + this session)

- Don't touch the workflow-studio wizard further. It's frozen at v0.1.0-alpha.3.
- Don't release without per-tag sign-off.
- Don't build mac on every dispatch (`-f targets=linux-…` is mandatory).
- Don't trust HTTP-200 smoke as canary; require state-asserting canary.
