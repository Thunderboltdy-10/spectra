# Spectra — engineering overview

This is the one entry point for engineers. It describes what Spectra is, how the code is laid out, how to run and test it, which cross-system contracts are binding, and which launch risks are still open. Everything else under `docs/` is either the live launch audit (`docs/spectra-launch-audit/`) or history (`docs/archive/`).

Two specs are binding for all new work, ahead of anything older in this file:

- [`docs/design/`](design/README.md): the design language, shell, island, motion and editors. Read it before building any UI.
- [`docs/ai/HARNESS.md`](ai/HARNESS.md): how Spectra's AI works. Read it before touching the AI run, tools, skills or thread.

The redesign is being carried out through the plan in [`docs/spectra-launch-audit/REDESIGN-PLAN.md`](spectra-launch-audit/REDESIGN-PLAN.md).

Going to the cloud follows [`docs/LAUNCH.md`](LAUNCH.md): Convex, the collaboration gateway, Vercel and the Bridge, in that order.

## What Spectra is

Spectra is an AI-native school workspace. Students and teachers are peers: they keep their work (documents, spreadsheets, presentations, flashcard decks, quizzes, plans, timetables, whiteboards, code projects and agents) in workspaces and a library, and they edit it together in real time. They can also ask an AI to read and change that work. Schools are provisioned by a superadmin, invite their members, and can sync classes and resources from ManageBac.

Four properties shape almost every module:

- **Real-time collaboration.** Artifact content is a Yjs document. It is served by a collaboration gateway and made durable in Convex.
- **Native Office files.** DOCX, XLSX and PPTX work can be linked to a file on the student's computer through the Spectra Bridge, a Rust/Tauri desktop app. The bytes of the native file are the synchronization truth for linked work (CANON R1).
- **AI that edits real work.** The AI goes through the same typed operations, authorization, history and receipts as a person (CANON R6). It must never claim a result it did not durably achieve (D26).
- **Truthful state.** Every state a run, replica, write or conflict can enter has a mechanical exit (R2). The UI says what actually happened: saved, queued for native sync, verified in the file, or failed with a next step.

## Architecture map

| Area | Path | What lives there | Boundary |
| --- | --- | --- | --- |
| Web app | `src/app/` | Next.js 16 App Router pages (`workspace`, `library`, `chat`, `calendar`, `timetable`, `school`, `admin`, `superadmin`, `join`, `public` shares, `landing`) and `error.tsx`. | Pages compose feature modules; they do not talk to Convex tables directly. |
| Server routes | `src/app/api/` | `spectra/route.ts` (the action router for artifact and workspace commands), `spectra/run/` (the AI run loop: `runtime.ts`, `loop/`), `spectra/collaboration/` (gateway tokens), `spectra/managebac/`, `spectra/native/` (Bridge), `spectra/content`, `imports`, `assets`, `public`, `webhooks/clerk`, `health`. | Authenticated with Clerk. Server-to-Convex calls that carry trust use the signed bridge keys (`SPECTRA_*_BRIDGE_KEY`). |
| Product features | `src/features/spectra/` | One directory per subsystem. The main ones are listed below this table. | Client code reaches the server through `data/request.ts` (`requestSpectra`) and `data/api.ts`. Semantic UI events go through `spectraBus`, never `window` events (enforced by `check:architecture`). |
| Backend | `convex/` | The schema (`schema.ts`), about 200 function modules (identity, schools, memberships, catalog, artifacts, versions and history, collaboration persistence, native write operations, runs and receipts, metering, account erasure, ManageBac), crons and generated types. | The authorization and durability boundary. Reads are bounded (D42/R10). `_generated/api.d.ts` must list every module (guarded by `module-graph.test.ts`). |
| Shared contracts | `shared/` | Code imported by the web app, Convex, the gateway and scripts: durable-content and native-AI-commit contracts, collaboration framing and recovery, intake integrity and limits, sync and retry policy, region-claim policy, human formatting. | No React, Next.js or Convex function imports. `convex/values` validators are the one exception (`artifact-embed.ts`). |
| Collaboration gateway | `scripts/collaboration-gateway.mjs`, `scripts/serve-collaboration-gateway.mjs`, `scripts/collaboration-*.mjs` | The Hocuspocus/Yjs server. Rooms are held in memory, persisted to Convex as an append-only log with checkpoints and compaction, and projected to native files. | Deployed from `deploy/collaboration-gateway/` (Dockerfile, `fly.toml`, `railway.toml`, `compose.yml`). |
| Cloudflare realtime (opt-in) | `workers/collaboration/` | An alternative Durable Object realtime provider, enabled only by `NEXT_PUBLIC_SPECTRA_CLOUDFLARE_REALTIME`. | Off by default. It does not yet give AI writes an admission receipt (see open risks). |
| Spectra Bridge | `bridge/` | `bridge-core` (file watching, journal, sync protocol, retry) and `bridge-app` (the Tauri desktop shell, release notes in `RELEASE.md`). Built by `.github/workflows/bridge-desktop.yml`. | It talks to the web app's native routes. Windows and macOS are launch platforms. |
| Tooling | `scripts/` | The `check:*` gates, local stack (`scripts/local/`), fidelity harnesses, the classroom load test, the P8 verification harness (`scripts/final-verification/`), and fixtures. | Scripts named in `package.json` are the supported entry points. |

The main subsystems in `src/features/spectra/`:

- **Runs and AI:**
  - `ai/` is the client run hook and the model-facing contracts.
  - `runs/` holds the Live Dock, streaming and background runs.
  - `tools/` holds the tool registry and execution.
  - `operations/` is the typed operation IR, plan validation and write policy.
  - `context/`, `sources/` and `references/` build the model's context and do retrieval.
- **Artifacts:**
  - `artifacts/` holds the studios for each format.
  - `editor/`, `presentation/`, `sheets/`, `flashcards/`, `quiz/`, `plan/`, `timetable/`, `whiteboard/` and `code/` are the format-specific models and UI.
  - `work/` holds work models, the work registry and sessions.
  - `capabilities/` is the capability catalog: one source for what each surface can do (`check:capabilities`).
- **Native Office:**
  - `lenses/` holds the DOCX, XLSX and PPTX lenses: projection, materialization, readback, three-way merge and preservation proofs.
  - `bridge/` is the web side of Bridge pairing and sync.
  - `compute/` holds the in-browser engines (formula, autocomplete, file tools).
- **Collaboration:**
  - `collaboration/` holds the Yjs models, the Hocuspocus transport, region controllers and AI UI events.
  - `realtime/` and `comments/` build on it.
- **Workspace and organization:**
  - `organization/` covers the library tree and imports.
  - `components/` holds the shell, conversation surface and kbar.
  - `administration/` is school admin.
  - `calendar/`, `reminders/`, `settings/` and `integrations/` (ManageBac) cover the rest.
- **Shared plumbing:**
  - `data/` is the request and API client.
  - `events/` is `spectraBus` (`events/bus.ts`).
  - `copy/` holds the user-facing wording, enforced by `check:copy`.
  - `motion/` and `hooks/` are shared UI helpers.
  - `core/` is shared low-level code.

## Run and test

Node and dependencies come from `package.json`. Copy `.env.example` or `.env.local.example` to `.env.local`. Spectra has no built-in model: `SPECTRA_MODEL_ID`, `SPECTRA_REASONING_PROFILE` and `SPECTRA_MODEL_PROVIDER` (plus the optional fallback and judge settings documented in `.env.example`) choose the model, reasoning level and provider. `src/features/spectra/ai/model-config.ts` throws when they are missing, and `check:deploy-env` fails a production build without them. The Convex deployment's own environment is listed in `docs/spectra-launch-audit/reports/P2-OPS-PERFORMANCE.md` ("Deploy checklist").

| Task | Command |
| --- | --- |
| Web and gateway in development | `npm run dev` (web through `scripts/dev-web.mjs`, gateway through `serve-collaboration-gateway.mjs --supervise`) |
| Full local stack | `npm run local:start` / `local:status` / `local:stop` / `local:reset` (`scripts/local/stack.mjs`) |
| Convex in development | `npm run convex:dev` |
| Unit and integration tests | `npx vitest run <files>` for a focused run, `npm run test:run` for Node tests plus the full Vitest suite |
| Cloudflare realtime tests | `npm run test:realtime` |
| Types | `npx tsc --noEmit -p tsconfig.json` |
| Lint | `npm run lint` (zero warnings) |
| Gates (also run in `prebuild`) | `npm run check:architecture`, `check:copy`, `check:design-tokens`, `check:capabilities`, `check:secrets`, `check:deploy-env` |
| Office fidelity | `npm run fidelity:docx`, `fidelity:office`, `fidelity:seam` |
| Classroom load | `npm run collaboration:classroom-load` (config example in `scripts/collaboration-classroom-load.example.json`) |
| Bridge | `cargo build` / `cargo test` in `bridge/`; release notes in `bridge/bridge-app/RELEASE.md` |

Notes:

- Convex-backed tests use `convex-test` with in-memory fixtures. Some lifecycle suites need a larger timeout under a full parallel run.
- `next build` needs a real `node_modules`. It fails in a worktree whose `node_modules` is a junction.

## Binding cross-system contracts

These decisions come from `docs/spectra-launch-audit/S11-INTEGRATION.md` ("Cross-system decisions"). They bind every subsystem. The detailed atomic AI/native contract is `docs/spectra-launch-audit/reports/S11-DURABLE-AI-NATIVE-CONTRACT.md`.

1. **Native reconciliation.** Native reconciliation uses the durable log, history and projection, with an exact canonical and room-sequence compare-and-swap, immutable native ancestry and an idempotent receipt.
   - A stale retry must truly merge.
   - Open rooms must learn of direct native commits before any stale projection or compaction.
   - There is no second storage engine.
2. **Full-wipe and archive approval.** The approval binds the run, attempt and operation, the input digest, the base identity and the result digest. It is re-checked at the first-effect sinks in the same transaction. A UI acknowledgement grants no authority.
3. **Choreography.** Choreography extends the semantic action, command and run-event identity.
   - Visible actions must line up with real writes.
   - Follow mode reveals the actual targets.
   - A crashed observer can never block durable work.
4. **Initial AI context.** The initial context is a compact, authorized orientation. The model chooses retrieval and skills: there is no keyword dispatch and no mandatory planning JSON. A run's completion accounts for the whole request.
5. **Atomic AI and native writes.** The AI write is prepared, read back and uploaded as an immutable package. Then one signed internal mutation appends the Yjs update, history, native outbox and receipt. A claimable native request is never created before canonical admission.

The product decisions in the archived canons are still binding:

- `docs/archive/spectra-nova/CANON.md` holds D1–D44, which include HQ D1–D23.
- `docs/archive/spectra-reformation/CANON.md` holds R1–R21, which amend D26, D33, D37 and D42.

The launch audit replaced the old process rituals, not these decisions.

## Launch audit: where the reports live

- `docs/spectra-launch-audit/START-HERE.md` is the audit charter and audience decisions. `STATE.md` is the running state. `S11-INTEGRATION.md` and `S11-CLOSEOUT.md` hold the integrated S11 decisions.
- `docs/spectra-launch-audit/reports/` has one report per task:
  - waves `W1`–`W9`, `V7`–`V9`, and sessions `S6`–`S11`;
  - Phase 2 hardening, `P2-*.md`: security-privacy, ops-performance, experience, write-paths, account lifecycle, outcomes, scale, code health, AI quality, residuals and sync-resume;
  - Phase 3 launch work, `P3-*.md`: Bridge/Lens, UI system, AI engine, editors, editors-2, sync durability, AI context, workspace flows, surfaces-2, client performance and Convex errors.
- Each P2 and P3 report ends with a findings ledger ("Reported, not fixed" included) and a "Needs live verification" script: actions and expected results. Those scripts are the browser verification plan. Run the P3 scripts first, because they cover the newest code. `docs/spectra-launch-audit/LIVE-VERIFICATION-PROMPTS.md` has the two prompts for running them: a verifier that only documents issues, and a fixer that works the resulting `LIVE-ISSUES.md` ledger.

## Open launch risks

This list reflects main after Phase 3 (`853e4a12`). A tag in brackets names the report with file and line detail. Everything fixed by a later lane has been removed.

**Needs live proof before launch**

- **Convex errors in production.** Worded errors now cross the function boundary as `ConvexError` (`convex/functions.ts`, `shared/convex-error.mjs`). Only a production deployment redacts, so confirm on one that a stale calendar tab gets 409 and reloads, and that `/join` with a spent invitation shows the final copy. [P3-CONVEX-ERRORS]
- **Gateway deploy drain.** A deploy during active editing must log "drained … 0 room(s) not durable" within the 30 s kill timeout. [P3-SYNC-DURABILITY]
- **Gateway capacity.** One Fly machine (2 GB, `hard_limit = 200` sockets, rooms in memory). Load-test a classroom. Scaling out needs room-affinity routing. [OPS-PERFORMANCE, SCALE]
- **Native Office round trip.** Word, Excel and PowerPoint edits through a paired Bridge on Windows, including cloud-drive folders and files open in Office. [P3-BRIDGE-LENS, P3-SYNC-DURABILITY]
- **Two-browser collaboration.** Concurrent list edits, undo that keeps peers' edits, and imports during peer edits in every editor. [P3-EDITORS, P3-EDITORS-2]
- **Calendar across the 25 October 2026 clock change** in Europe/Madrid. [P3-WORKSPACE-FLOWS]
- **Earlier environment checks:** the Clerk deletion webhook, the Vercel production env check, and `npx convex codegen` showing no diff (P3-CONVEX-ERRORS hand-edited `api.d.ts`). [ACCOUNT-LIFECYCLE, OPS-PERFORMANCE]

**Operator steps at deploy**

- Complete internal `spectraArtifacts:backfillSummaries` on each deployment that lacks the current `catalog-artifact-summaries` completion marker: start with `{cursor:null,limit:10}`, then use each returned cursor until `done`. Agent and artifact catalogs require this complete, versioned traversal; partial tail repairs do not certify readiness. The existing migration caps each page at 25 rows and 2 MB. [S10-CONVEX]
- `npx convex run metering:backfillSchoolUsageTotals '{}'` once, so school usage ceilings start from real totals. [RESIDUALS]
- Check that Fly `kill_timeout 30s`, Railway `drainingSeconds 30` and Compose `stop_grace_period 30s` are accepted. [P3-SYNC-DURABILITY]

**Product decisions (not blocking)**

- Erasure retains billing, audit, shared-work and some operational rows by design. A DPO must confirm the retained set. [ACCOUNT-LIFECYCLE]
- There is no UI yet to choose an embed's context policy, and an editor text selection cannot yet be sent to the AI as context. [P3-CONTEXT]
- The chat continuation toast makes no explicit choice on "Keep current" or on timeout. [P3-UI-SYSTEM]

**Known residuals (Low/Medium, listed in the reports)**

- **Keep off:** the Cloudflare realtime provider has no admission receipt. [WRITE-PATHS]
- **Bridge:** a delete it has already carried out cannot be undone by a Library restore. [P3-SURFACES-2 X2]
- **Editors:** a sheet save still forces one full rebuild, kept deliberately until a "no foreign update since the last rebuild" guard exists. [P3-CLIENT-PERF 1]
- **Office viewers:** slide backgrounds, the theme's text colour, table styles, freeform shapes and Word's first-page headers are not drawn yet. [R-D4e-OFFICE-DEPTH]
- **Search anchors:** a thread result opens the conversation, not the message. [R-L6-ANCHORS]
- **Surfaces:**
  - the "Not reached" surfaces are `/agents/[id]`, `/analytics` and most of `/superadmin`.
  - [P3-SURFACES-2]

## History

- `docs/archive/` holds the superseded campaigns, kept for provenance:
  - `spectra-hq`, `spectra-nova`, `spectra-reformation`, `spectra-rebuild`, `spectra-definitive` and `spectra-landing`;
  - `SPECTRA-ISSUE-COMPENDIUM.md`;
  - `root-snapshots/`, the old audit YAML snapshots.
- Markdown inside the archive still links to its pre-archive paths. Read those links as relative to `docs/archive/`.
- The order was HQ, then Nova, then Reformation (the P0–P8 phases, whose verification harness is now `scripts/final-verification/`), then the launch audit (waves W1–W9, sessions S6–S11), then Phase 2 hardening.
- Git history is the authoritative record. Report files name the merge commits that shipped each fix.
