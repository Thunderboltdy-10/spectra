# P4 — The AI Plane

**Goal:** the AI operates the whole workspace on the right targets, with honest reporting, visible (or politely invisible) choreography, and output quality that justifies the product (Pablo's decision: quality machinery is first-class). The durable run substrate is kept; the monolith's shape, targeting, and context are replaced.

**Prerequisites:** P3.I1–I3 accepted (tools derive from the IR). **Architecture:** ARCHITECTURE-AI (all), ARCHITECTURE-CAPABILITIES. **Findings absorbed:** Part XI wholesale (AI-1..15, PL-1), UX-12, the choreography dead layer (AI-11..13).

**Difficulty (PROCESS §4):** I1, I2, I4, V1 = Hard / GPT 5.6 Sol xhigh. I3, I5 = Medium-thinking / Grok 4.6 High.

## P4.I1 — Agent loop extraction (H)

`run/route.ts` (14k lines) decomposes into the loop modules (intake/plan/resolve/gather/act/verify/report) orchestrated by the **unchanged** run engine (leases, NDJSON, dock, confirmations). Extraction is behavior-preserving first (golden transcript tests on existing flows), then the loop lands. The six regex fast-paths are re-based on the loop (resolution included) or deleted. Business logic leaves the route file; the route becomes thin.

## P4.I2 — Targeting + workspace context (H)

Per ARCHITECTURE-AI §1–§2 — this closes the "edited the wrong artifact twice" family at the root: focused-repair deleted; resolution step with candidates + confidence; disambiguation tools registered and wired to the dock's required-input rail; workspace index in every packet (focused-mutation starvation removed); structural serialization for every type including presentations; narration names resolved targets by title; thread-attachment defaults demoted to priors. Acceptance includes a wrong-target adversarial suite: N similar-named artifacts, one open, prompts referencing others — zero misdirected mutations, clarifying questions where genuinely ambiguous.

**Owns P0.V2 SYSTEMIC** AI target/context legibility (Live Dock title vs focus). Not a P1 unit.

## P4.I3 — Honest execution + authority enforcement (MT)

Verify-phase confirmation before success claims (native persistence included); one failure humanizer; run-level revert exposed (change groups exist); durable audit events for authority decisions; `notify` consumed (visible non-blocking notice), local-file effects confirm with counts (AI-7), settings-change navigation hijack removed; truthful `actorKind` attribution (AI-8); metering per execution (AI-15); fallback-model config fixed. Dock cards name target + show diff summary; touch users get Stop/Retry (UX-12).

## P4.I4 — Quality machinery (H)

ARCHITECTURE-AI §3: presentation layout/template system + deck rubric + critique pass; sheets analysis patterns (formulas-not-literals, real charts, recalculability) + rubric; document structure-aware editing + rubric; rubrics shared with L3 verification. Acceptance is graded output: the verifier (P4.V1) scores generated decks/sheets/docs against the rubrics — "it ran" is not the bar; "you would present this" is.

## P4.I5 — Choreography wiring (MT)

App coordinator + performer mounted; Follow AI single-actor with `followedActorId` actually set; window-level input-disengage; claim TTLs; reveal robustness (no dropped one-shots); reduced-motion respected; navigation settle-before-act; background runs never steal viewport (D38 end-to-end). Artifact-level beats (already real) integrate with IR choreography primitives from P3.

## P4.V1 — AI adversarial + quality verification (H)

Wrong-target suite (multi-artifact, similar names, cross-type, thread-attached); honesty suite (kill Bridge mid-materialize → run must report failure; network loss mid-run; confirm-then-reject paths); quality grading against rubrics on standardized briefs ("make a 12-slide presentation on X from this outline", "analyze this CSV"); choreography journeys with Follow on/off; authority cards (settings ask; file-effects confirm with counts; prohibited stays prohibited). Sequence evidence; findings triaged R12.

**Model: GPT 5.6 Sol xhigh.** Trust it at least as much as the implementers.

## Exit gate

Wrong-target suite zero-miss in its owning verification unit; honesty suite green; rubric scores at or above the bar Pablo sets on V1's first grading round; choreography journeys PASS; Pablo pass (including his original two-artifact repro, which must now resolve correctly or ask).

### P4.I1 implementation log (2026-08-28)

- Kept the durable run substrate intact: leases, heartbeats, NDJSON, confirmations, retry/resume, cards, and scheduled callbacks remain in `runtime.ts`.
- Reduced `run/route.ts` from 14,073 lines to an eight-line transport boundary.
- Moved business logic into `loop/{intake,plan,resolve,gather,act,verify,report}.ts` with shared contracts and Convex I/O adapters.
- Added the mounted `AgentLoopExecution` boundary in canonical intake → plan → resolve → gather → act → verify → report order.
- Kept the current bounded context packet as intake input; the loop adopts it at gather, while P4.I2 owns breadth-first indexing plus post-resolution depth.
- Early answer/refusal/confirmation paths record skipped stages explicitly; confirmation resumes start at act without replaying intake or planning.
- Existing focused regex fast paths remain behavior-compatible but now traverse resolve, gather, act, verify, and report like model plans.
- Added route-level golden transcripts for full mutation, immediate answer, and focused fast-path mutation, plus a structural extraction contract.
- Focused Vitest: 7 files / 67 tests passed. Scoped ESLint: 0 warnings. Capability ghost gate passed.
- Secret scan passed across 2,131 tracked files; `git diff --check` passed.
- Full `tsc --noEmit` retained only recorded repository blockers; no P4.I1 file failed.
- Architecture check retained seven pre-existing global-event findings; no P4.I1 path was named.
- Status: IMPLEMENTED. No acceptance claimed; P4.V1 remains independent.

### P4.I2 implementation log (2026-08-28)

- Deleted silent focused-artifact repair and the first-three-artifacts clarification fallback.
- Every existing artifact mutation target now resolves through permissioned candidates, scored evidence, confidence, and an explicit target role.
- Visible focus and thread attachment are priors only; named targets win, unresolved targets fail safely, and genuine ambiguity produces bounded canonical choices with no raw IDs.
- `request_context_target` and `ask_user_choice` now have typed schemas, are agent-visible, and persist through the existing Live Dock required-input rail.
- Every packet carries a bounded shallow workspace index; Agent titles remain discoverable without exposing Agent instructions.
- Resolved existing targets are permission-re-read, live-Yjs hydrated, and structurally reconciled before any mutation is recorded or applied.
- Added bounded serializers for all ten blueprints, including presentation slides, object geometry, and speaker notes.
- Gated focused regex/model shortcuts on an explicit focus reference; named-other prompts receive only shallow focus context.
- Progress, previews, provenance, and final narration use resolved titles; created-artifact link dependencies retain their authored titles.
- Reused the established dense Dock choice rail after the required frontend-design/design-taste audit; no parallel UI surface was added.
- Adversarial coverage includes 12 similar names, cross-type update/archive, duplicate titles, deictic focus, thread attachment, two-ended links, created dependencies, and correct-target document canonicalization.
- Focused Vitest: 6 files / 64 tests. Scoped ESLint: 0 warnings. Capability ghost gate, secret scan (2,131 tracked files), and diff check passed.
- `tsc --noEmit` retained only recorded repository blockers; no P4.I2 path failed. Architecture retained seven recorded global events; no P4.I2 path was named.
- `check:copy` still stops on the deleted `artifacts-shell.tsx`; P6.I3 owns that stale checker path. The full repository sweep remains deferred until paired verification.
- Status: IMPLEMENTED. No acceptance claimed; P4.V1 remains independent.

### P4.I4 implementation log (2026-08-28)

- Extracted one presentation layout vocabulary and realization engine shared by Studio, commands, target resolution, generated creates, and quality checks.
- Generated presentations now author semantic objects plus `layoutId`; raw geometry is optional in the create transport and the shared template realizes bounds, hierarchy, text fitting, and reading order.
- Deck grading uses one shared rubric for narrative structure, template completeness, density/overflow, pacing/variation, contrast, accessibility, and source coverage.
- Incomplete layout roles and long repetitive text-only decks are blockers, so document-shaped decks cannot pass by accumulating unrelated points.
- Sheets grading requires formula-backed outputs, automatic recalculation, error-free references, honest populated chart ranges, labeled units, conclusions, and readable sizing.
- Document grading classifies create/append/rewrite/restructure intent, preserves stable structure, rejects placeholders, checks heading flow, and requires verified citations only for explicit research/source requests.
- The run loop injects the rubric before authoring, realizes generated decks before validation, rejects failed critiques through the repair path, and caps quality critique failures at two per run.
- Verify re-reads saved creates through the same rubric; the fallback model resolver also refuses to reuse the active primary route.
- Focused Vitest: 9 files / 122 tests passed, including eight P4.I4 quality tests.
- Scoped ESLint: 0 errors; nine existing presentation-studio design warnings. Capability ghost gate, secret scan (2,132 tracked files), and diff check passed.
- Architecture retained seven recorded global-event findings; no P4.I4 path was named.
- `tsc --noEmit` retained only recorded repository blockers; no P4.I4 path failed.
- Signed-in Playwright smoke showed all nine shared layouts in the Presentation Design menu with zero console errors; evidence: `.shots/reformation/P4.I4/presentation-layout-menu.png`.
- Status: IMPLEMENTED. No acceptance claimed; P4.V1 owns independent generated-output grading.

### P4.I3 implementation log (2026-08-28)

- Verify now re-reads local replica truth: error or failed cloud-to-local writes fail the run; pending queued writes stay honest.
- Native materialize no longer skips when a local Office replica exists and the live document cannot be read.
- One humanizer: `formatPlanApplicationPublicError` last-resort is `humanizePublicFailure`; SNAKE_CASE never names Word.
- `notify` is consumed: dock progress/status sentence plus durable `ai.authority.*` audit; not a second Apply card.
- Library rename/move/link with local replicas is `local_file` confirm with counts; `create_folder` stays tree notify.
- Settings change applies in place; `settings.change` no longer `router.push`s. Explicit `navigate_spectra` still opens Settings.
- Sync-policy journals `actorKind: "ai"`; model meters key by `runId:executionId` on any terminal status.
- Run-level Undo restores change-group `baseSnapshot` for `artifact.update`; later human edits block with a sentence.
- Live Dock: Stop/Retry are always-visible tab icons; Apply cards name targets; writing copy no longer implies a local model.
- Taste: Undo only when a snapshot exists; 0-file sync policy still confirms with an honest zero-file sentence.
- Focused Vitest: 9 files / 107 tests (`honest-execution` 8, plus live-dock/application-tools/plan-diagnostics/wave4/run-route).
- Scoped ESLint: 0 errors on new logic; existing dock/shell token warnings unchanged. Capability ghost gate passed.
- Secret scan 2,135 tracked files; `git diff --check` passed.
- Playwright: `.shots/reformation/P4.I3/01-workspace-composer.png`, `02-settings-writing.png`, `03-live-dock-stop.png`, `04-live-dock-stop-running.png`.
- Status: IMPLEMENTED. No acceptance claimed; P4.V1 owns the honesty suite. P4.I5 owns Follow-AI.

### P4.I5 implementation log (2026-08-28)

- Mounted `AppChoreographyCoordinator` + `AiPerformer` in `AppChoreographyMount`; `ui_event` enqueues when `runId` is present.
- Follow AI is single-actor: `followAiActor` locks the run; `ai:runId:op:…` client ids parse to that run.
- Toggling Follow on locks the most recent attributed actor; unattributed events after lock do not navigate.
- Window-level pointer/key/wheel disengage; `[data-spectra-follow-control]` is ignored so the toggle does not cancel itself.
- Claims expire at 8s; navigation settle-before-act is 280ms (0 when reduced motion).
- Reveal retries until the control mounts; reduced motion uses instant scroll; AiPerformer jumps to the last frame.
- IR choreography primitives prepend a pointer beat when the diff does not already approach the control.
- Dock Follow is a Crosshair `dock-tab-icon`; thread Follow AI and presence AI chips call `followAiActor`; AI presence rows collapse by run.
- Taste: the client performer does not republish awareness (server frames remain the visible body). Background runs never navigate unless followed.
- Focused Vitest: 9 files / 87 tests. Scoped ESLint: 0 errors on new logic; existing dock token warnings unchanged.
- Capability ghost gate passed. Secret scan 2,138 tracked files. `git diff --check` passed.
- Playwright: `.shots/reformation/P4.I5/02-live-dock.png`, `04-thread-follow.png`, `08-dock-follow-pressed.png`, `09-thread-follow-locked.png`.
- Status: IMPLEMENTED. No acceptance claimed; P4.V1 owns choreography journeys.
