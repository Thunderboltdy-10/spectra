# S9-AI — complete the user's intent with useful, durable results

Date: 2026-09-14 (Europe/Madrid)
Seat: C-AI+Dock launch-review (`grokbot/launch-review/ai-dock`)
Checkout: `/workspace/ai-school-worktrees/ai-dock`
Status: **OPEN** — dual-gate ACCEPT on source batches; branch squashed to 2 commits on `f7106da` for merge. Never mark S9-AI closed until Profile A live acceptance.

Evidence class: source audit + deterministic Vitest. No live provider run, no localhost stack start, no native Office journey in this seat.

## Source findings (expected vs actual)

1. **Whole-request completion after first tool** — `src/app/api/spectra/run/loop/plan.ts` `isCompleteAfterTool` (~5482).
   - **Actual:** returned true for any successful Calendar mutation, `navigate_spectra`, `setup_bridge`, or `insert_reference` (`needs-ui`) without checking remaining prompt obligations.
   - **Expected:** fast-path only when that tool fulfills the entire request; multi-step prompts must keep the agent loop open.
   - **Fix:** gate application-tool completion through `toolFulfillsEntireRequest` in `resolve.ts`; keep direct focused `propose_operation` staging path.

2. **Keyword Calendar veto on slide edits** — `promptRequestsCalendarAction` in `resolve.ts` (~1268).
   - **Actual:** time signal accepted a bare `\d{1,2}`, so “Move the slide 2 heading…” classified as Calendar.
   - **Expected:** slide/deck ordinal moves stay out of Calendar; wall-clock or weekday signals required.
   - **Fix:** exclude slide/deck-only prompts without real time tokens; require `HH:MM` / am-pm / weekday / relative day for numeric times.

3. **Planner update blocked during update-then-schedule** — `assertCalendarActionContract` in `resolve.ts` (~1304).
   - **Actual:** any `planner_task` update in a Calendar-classified prompt threw, even when paired with `calendar.schedule`.
   - **Expected:** reject planner updates only when they substitute for a missing Calendar mutation.
   - **Fix:** require `!hasCalendarMutation` before throwing.

4. **Source workspace rewritten as destination** — `resolveWorkspaceMention` + call site in `resolve.ts` (~1516).
   - **Actual:** any unique workspace title mention overwrote every `artifact.create` / `workspaceItem.add` destination.
   - **Expected:** distinguish source (“from Chemistry Lab”) vs destination (“put … in Chemistry Lab”).
   - **Fix:** `promptPlacesIntoWorkspace` + `requireDestinationLanguage: true` at the plan-resolve call site.

5. **Dropped operations shifted `@created:N`** — `parseSpectraPlan` ManageBac dedupe in `operations/schema.ts`; Calendar duplicate-create repair in `plan.ts` (~4718).
   - **Actual:** filters dropped ops without remapping later dependency indexes.
   - **Expected:** stable remap or fail loudly on dangling `@created`.
   - **Fix:** `compactOperationsRemappingCreated`; Calendar repair rewrites aliased creates to owned ids then compacts with remap.

6. **Chart placeholder accepted as visual fulfilment** — `isPurposefulPresentationVisual` / `evaluatePresentation` in `quality/rubrics.ts`.
   - **Actual:** any `type: "chart"` counted; shapes with short labels (including “Chart”) counted as purposeful visuals; no blocker when a data/present prompt lacked numeric series.
   - **Expected:** data/present requests need a real editable chart/table with finite numeric series — not a labelled shape.
   - **Fix:** numeric series/table checks; blocker when `promptRequiresEditableNumericVisual` and none present.

7. **Reference insert rejection swallowed** — `ai-ui-events.ts` `reference_insert` handler.
   - **Actual:** `commandAsync(...).catch(() => undefined)`; run could treat `needs-ui` as success while the host insert failed silently.
   - **Expected:** use awaited shared-command results; surface failure/unmounted host.
   - **Fix:** `commandAsyncResults` with failure / zero-listener notes. Full durable mutation receipt back into the run remains residual.

## Fixes landed

| Area | Files |
|---|---|
| Completion gating | `src/app/api/spectra/run/loop/plan.ts`, `resolve.ts` (`toolFulfillsEntireRequest`) |
| Calendar / workspace targeting | `resolve.ts` |
| `@created` remap | `src/features/spectra/operations/schema.ts`, `plan.ts` |
| Chart numeric quality | `src/features/spectra/quality/rubrics.ts` |
| Reference insert honesty | `src/features/spectra/collaboration/ai-ui-events.ts` |
| Tests | `target-resolution.test.ts`, `quality-machinery.test.ts` |

Preserved: V8-03 focused-edit fast path, durable run substrate (leases/heartbeats/NDJSON/Live Dock/required-input rail), shared registry/authority design (no second orchestration engine).

## Tests

```
./node_modules/.bin/vitest run \
  src/features/spectra/__tests__/target-resolution.test.ts \
  src/features/spectra/__tests__/quality-machinery.test.ts
→ 2 files, 38 passed

./node_modules/.bin/vitest run \
  src/features/spectra/__tests__/live-dock.test.ts \
  src/features/spectra/__tests__/agent-loop.test.ts
→ 2 files, 30 passed
```

Covered seams: slide≠Calendar; update+schedule allowed; source≠destination workspace; multi-obligation completion false; sole schedule completion true; `@created` remap after drop / ManageBac dedupe; shape-“Chart” blocker; real series accepted.

## Residual progress (this pass) — closed vs still open

### Closed / improved on this seat (folded into squash; S9-AI still OPEN)
- **Legacy Calendar unification:** shared `calendar/domain/command.ts` + `loop/calendar-command.ts`; `act.ts` and `executeAgentReadTool` Calendar mutations share aliases, schemas, authority, idempotency, postcondition, undo identity.
- **Reference insert receipt:** `queued_refresh` (not silent `needs-ui` success); `ai.ui.referenceReceipt` durable events including `host_unmounted` / `failed` / `verified_native_write`; completion gate requires verified/canonical write.
- **Stop / Undo / settle honesty (source):** abort fence before tools/mutations; Undo uses `restore:` + `claimActorKind: "human"` (not AI `revert:` claim); Dock still status-driven (completion gate helps).
- **Stream / retention / local-file honesty:** unknown local-effect counts no longer coerce to zero files; NDJSON consumer-detach already continues task to final release (retained ownership).
- **ManageBac harness copy:** plan harness no longer says “authenticated user’s permitted ManageBac”; Spectra-account / school-connection language.
- **Calendar AI egress vs Shell bounded overview:** `compactCalendarForAgent` emits `coverage` (rangeBounded, lookback residual, truncation, empty≠complete). Does **not** rewrite Shell-owned `convex/calendar.ts` (`e3ac373` merge dependency).
- **Negatives landed:** stop mid-run no later mutation; approval declined no execute; Unicode/dup workspace titles; empty chart; unmounted reference receipt; slide-number Calendar false positives; first-tool ≠ complete; truncated/empty Calendar coverage.

### Still open
- **Profile A live acceptance** (PDF+CSV study/present) — Spectra gate for closing S9-AI.
- **Full durable reference write** when host unmounted (canonical embed create without mounted editor) — parked; would touch collab-share embed surfaces.
- **Calendar TZ 13:00→14:00** reproduction (needs recorded account IANA).
- **Passage-level citation corpus**.
- **Full action-family contract matrix** (compact Calendar + reference + neighbors only this pass).
- **Merge dependency:** Shell `convex/calendar.ts` overview bound (`e3ac373`) not on this tip — AI egress honesty is forward-compatible; do not re-implement Shell bind here.
- **Sibling copy still lying (do not edit here):** `managebac-integration-shell.tsx`, `class-shelf-picker.tsx` “authenticated school email” / ManageBac account match copy — Shell-owned.

## Never mark whole outcome passed on first-tool success

Completion now requires `toolFulfillsEntireRequest` / `applicationToolMayCompleteRequest`. A green Calendar tool alone does not complete “schedule A then open B”. A queued reference insert is not request completion.

## Commits (squashed for merge)

Branch `grokbot/launch-review/ai-dock` — soft-reset onto `f7106da`, **2 commits**, docs folded into fix. No push. Dual-gate ACCEPT (Atlas tech + Spectra product) on pre-squash content.

- `bcb7647` — fix(ai): S9 multi-step intent, targeting, chart honesty, Calendar unify, stop/reference/local-file honesty
- `3d69454` — test(ai): S9 completion, targeting, chart, residual stop/approval/Calendar/reference negatives

Pre-squash dual-gate SHAs (superseded by squash): `aebc9eb`, `4a23812`, `14d14fc`, `79fb7b0`.

S9-AI remains **OPEN** (Profile A live acceptance still required).
