# Spectra — engineering overview

This is the one entry point for engineers. It describes what Spectra is, how the code is laid out, how to run and test it, which cross-system contracts are binding, and which launch risks are still open. Everything else under `docs/` is either the live launch audit (`docs/spectra-launch-audit/`) or history (`docs/archive/`).

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

Node and dependencies come from `package.json`. Copy `.env.example` or `.env.local.example` to `.env.local`. The Convex deployment's own environment is listed in `docs/spectra-launch-audit/reports/P2-OPS-PERFORMANCE.md` ("Deploy checklist").

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
  - waves `W1`–`W9`;
  - `V7`–`V9`;
  - sessions `S6`–`S11`;
  - Phase 2 hardening, `P2-*.md`: account lifecycle, experience, ops-performance, outcomes, security-privacy, write-paths and code-health.
- Each P2 report ends with a findings ledger and a "Needs live verification" list. Those lists are the source for the next section.

## Open launch risks

These risks are compiled from the "Reported, not fixed" sections of the Phase 2 reports, as merged at `897c824e`. Items that a later P2 lane fixed are left out. The report named in brackets has the file and line detail.

**High**

- **Gateway capacity and single point of failure.** There is one Fly machine with `hard_limit = 200` sockets and one socket per open document. Rooms are in memory, so scaling out needs room-affinity routing. Load-test before launch. [OPS-PERFORMANCE]
- **School export and purge are unbounded.** `buildLifecycleExport` reads a whole school in one query (`convex/administration.ts`), and some purge tables have no school index. A real school exceeds Convex's read limits. [OPS-PERFORMANCE]

**Medium**

- **ManageBac:**
  - The scheduled sync has no time budget or resumability. A killed request holds the 30-minute lease.
  - `configure` can fall back to the environment's API key.
  - School-level `resolveConflict` patches every projection inline.
  - [OPS-PERFORMANCE]
- **AI cost ceiling.** It is checked only in `beginRun`. Memory, embedding, agent and summary model work may not be gated, and there is no backfill of the rollups. [ACCOUNT-LIFECYCLE L7, L8]
- **Erasure retention.** Erasure keeps billing, audit, shared-work and some operational rows by design. A DPO must confirm the retained set. There is no in-product or admin-initiated erasure. [ACCOUNT-LIFECYCLE L1, L6]
- **Stop and Undo errors.** The toasts print the raw response text, and a signed-out Stop returns 500. [EXPERIENCE R4]
- **Agent governance query.** `agentGovernance` is a reactive admin query that collects every active artifact in the school. [OPS-PERFORMANCE]

**Low or residual**

- **Cloudflare realtime.** AI writes over the opt-in provider still rely on transport acknowledgement, not an admission receipt. Keep it off until it has the same sink. [WRITE-PATHS]
- **Choreography.** The readiness and observation fence described in S11-CHOREO is not built. Nothing consumes it yet. [WRITE-PATHS]
- **Append verification:**
  - A concurrent human append can make an honest AI run fail verification.
  - Resumed runs have no recorded append positions.
  - [WRITE-PATHS, OUTCOMES]
- **Superseded AI writes.** A write superseded by a newer human write stays `native_pending`. Settling it needs a product rule. [OUTCOMES]
- **Restore replica cap.** Restore fails closed above 50 linked replicas, and the error has no friendly copy. [WRITE-PATHS, OUTCOMES]
- **ManageBac DNS rebinding.** The fetch has a DNS-rebinding check-then-use window. It is mitigated by HTTPS-only, no redirects, a timeout and a size cap. [SECURITY-PRIVACY R5]
- **Unbounded run metadata.** `beginRun.messageMetadata` is `v.any()` with no size bound. [SECURITY-PRIVACY R8]
- **Timeouts and bundle.** Some external calls have no per-call timeout, and a zip helper is statically reachable from every page. [OPS-PERFORMANCE]
- **Wording.** Tool registry titles and collaboration labels still say "artifact". [EXPERIENCE R5, R6]
- **Dialogs.** Some hand-built dialogs were not audited for focus. The calendar's "Ask Spectra about this time" button has no handler. [EXPERIENCE R9, OUTCOMES]
- **Code health.** Dead feature chains and duplicated helpers remain; they are listed in P2-CODE-HEALTH. [CODE-HEALTH]

**Still needs live verification.** Each P2 report lists what could not be proven in source or tests. The launch-blocking ones are:

- the Clerk deletion webhook and a staged account erasure;
- the Vercel production environment check and the run route's duration;
- a gateway classroom load test;
- a native Word edit through a paired Bridge;
- the sanitizer payloads in a real browser;
- the owner's "Shared" icon (the EXPERIENCE R2 fix);
- public links after offboarding;
- ManageBac egress blocking;
- `npx convex codegen` showing no diff.

## History

- `docs/archive/` holds the superseded campaigns, kept for provenance:
  - `spectra-hq`, `spectra-nova`, `spectra-reformation`, `spectra-rebuild`, `spectra-definitive` and `spectra-landing`;
  - `SPECTRA-ISSUE-COMPENDIUM.md`;
  - `root-snapshots/`, the old audit YAML snapshots.
- Markdown inside the archive still links to its pre-archive paths. Read those links as relative to `docs/archive/`.
- The order was HQ, then Nova, then Reformation (the P0–P8 phases, whose verification harness is now `scripts/final-verification/`), then the launch audit (waves W1–W9, sessions S6–S11), then Phase 2 hardening.
- Git history is the authoritative record. Report files name the merge commits that shipped each fix.
