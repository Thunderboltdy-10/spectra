# P2 OUTCOMES: findings ledger

Branch `p2/outcomes`, cut from main `3aa01f19`. The rule for this pass: a student must be told the truth, in plain words, about what the AI did. They must also be able to resolve a conflict without seeing internals.

Every behaviour fix below has a test that fails on the old code and passes on the new code. Each failure was confirmed by saving the source diff with `git diff > file`, checking out the old source, running the test, then re-applying the diff. No stash was used.

## Commits

| Commit | Subject |
| --- | --- |
| `2a4b999c` | fix(spectra): report queued and verified native file sync on the run outcome |
| `c6f8ad90` | fix(spectra): show edit conflicts as a plain comparison, not JSON internals |
| `4b153385` | fix(spectra): verify an acknowledged append at the position it landed |
| `e1380b2f` | fix(spectra): explain restore refusals in plain words instead of a connection error |
| `6edbdc8e` | fix(spectra): say "work" in AI step titles and explain an offline live preview |
| `772da9d3` | fix(spectra): give hand-built modal dialogs the shared keyboard contract |

## Fixed

### 1. Native sync outcomes were never written (high)

**Files:**
- `convex/bridgeWriteOperations.ts:106` (`queuedLocalWrite`), `:119` (`runNativeSyncOutcome`) and `:142` (`settleRunNativeOutcome`);
- `convex/spectraRuns.ts:1435`;
- `convex/bridgeSync.ts:1648`;
- `src/app/api/spectra/run/loop/receipt-report.ts:124`;
- `src/features/spectra/runs/live-dock/live-dock-model.ts:111`;
- `src/features/spectra/components/live-dock.tsx:95`.

**Problem.** `native_pending` and `native_verified` existed in the schema but no code path wrote them. A run that queued a Word, Excel or PowerPoint write for the Bridge ended as `canonical_saved`, and its summary claimed success with no mention of the file on the student's computer.

**Fix.**
- **At completion.** `updateStatus` derives the native outcome from the run's operations. For each replica it takes the newest Bridge write request:
  - if every request is `verified`, the outcome is `native_verified`;
  - if any is still queued, claimed, failed or conflicted, the outcome is `native_pending`;
  - a cloud-only save stays `canonical_saved`.
- **On readback.** When the Bridge completes a write as `verified` (its readback), `completeWrite` settles a completed `native_pending` run to `native_verified`. "Verified" therefore comes only from real Bridge readback.
- **Copy.** The receipt summary and the Live Dock now say one of these:
  - "Saved in Spectra. The file on your computer hasn't confirmed this change yet."
  - "Saved in Spectra and checked in the file on your computer."
- **Dock polling.** For 10 minutes the dock keeps polling a recently completed `native_pending` run, so the change to "checked" shows without a reload.
- **Tests.** `convex/nativeAiCommit.test.ts`:
  - queued, then verified after claim and complete;
  - a readback revision mismatch stays pending;
  - cloud-only stays `canonical_saved`.

  Receipt-report and live-dock tests cover the copy and check that no native claim appears on cancelled or failed runs.

### 2. The conflict view showed raw JSON, region ids and a JSON merge editor (high)

**Files:**
- `src/features/spectra/collaboration/region-text.ts` (new);
- `src/features/spectra/components/conversation-surface.tsx:307` and `:331`;
- `src/features/spectra/collaboration/recovery-controller.ts`.

**Problem.**
- The card printed `JSON.stringify` of region values, the raw region id (for example `sheet:cells/B4`) and a textarea that asked the student to edit JSON.
- The choices "Keep mine" and "Use saved" did not say whose version was whose.

**Fix.**
- `readableRegionText` extracts only authored text. It skips ids, `$` markers and identifier-like strings, and it also reads truncated previews.
- `compareConflictRegions` builds rows with a label, a "Saved version" and "Spectra's change".
- "Review both" also shows "Before Spectra started".
- The choices are "Keep the saved version" and "Use Spectra's change". While another edit holds the region, the second choice reads "Waiting for the other edit".
- `REGION_CONFLICT_*` failures map to plain sentences.
- The merge editor and "Cancel proposal" are gone. `keep_current` and `cancel` had identical server effects.
- **Tests.** `src/features/spectra/__tests__/conflict-resolution.test.tsx` (jsdom) checks that the card contains no JSON braces and no region ids. It covers resolution calls, the waiting state and error text, and region text for cells, slides, truncated values and labels.

### 3. An honest run failed when a person appended to the same list before final verification (medium)

**Files:** `src/app/api/spectra/run/loop/verify.ts:273`, `:520` and `:547`; `src/app/api/spectra/run/runtime.ts:2098`.

**Problem.** Final verification looked for an AI append at `length - (laterAppends + 1)`. A human card appended after the acknowledgement shifted that slot, so a correctly saved AI card was reported as lost.

**Fix.**
- When the per-operation acknowledgement verifies an append, it records the exact index where the append landed in `outcome.appendedAt`. The runtime now keeps that same outcome object (`retainedOutcome`).
- Final verification uses the recorded index when there is one, and the old arithmetic otherwise. Nothing else is loosened.
- The document text fallback (`authoredValueLandedInContent`) does not record a position.
- **Test.** `s11-ai-full-content-verification.test.ts` covers three cases: the acknowledged append verifies after a human append, a lost AI card still fails, and there is no loosening without a recorded position.

### 4. The restore limit showed "check your connection" (low/medium)

**Files:** `src/lib/artifact-restore-server.ts:41`; `src/app/api/spectra/route.ts:1580`.

**Problem.**
- `ARTIFACT_RESTORE_NATIVE_BASE_LIMIT` fell through to the generic 500, which says "Check your connection". That was false.
- `NATIVE_SOURCE_UNAVAILABLE` surfaced the same 500.
- `NATIVE_SOURCE_INVALID` matched "invalid" and returned the raw code as the message.

**Fix.** `artifactRestoreFailure` maps these codes, plus `ARTIFACT_RESTORE_NATIVE_BASE_STALE`, to a 409 with plain copy that says the work hasn't changed. It also keeps the existing stale mapping.

**Test.** `src/lib/artifact-restore-server.test.ts` goes through the real `POST` for five codes and asserts that no code and no "connection" text is returned.

**Limit not raised; see "Reported" below.**

### 5. "Artifact" in user-visible AI copy, and "Failed to fetch" in the live preview (low)

**Files:** `src/features/spectra/tools/registry/application-tools.ts:91` and `:304`; `src/features/spectra/collaboration/ai-ui-events.ts:181`; `src/features/spectra/collaboration/artifact-yjs-model.ts:661`; `src/features/spectra/components/live-code-runtime.tsx:97`.

**Fix.**
- The titles and notes now read "Read work guidance", "Add comment", "Opening the requested work" and "Whole work".
- The live preview build request uses `requestSpectra`, so an offline student sees the shared "check your connection" copy instead of "Failed to fetch".
- **Tests.**
  - A registry test asserts that no tool title contains "artifact".
  - `ai-ui-events.test.ts` checks the Follow AI note.
  - `artifact-yjs-decompose.test.ts` checks the region label.
  - `live-code-runtime-offline.test.tsx` checks the offline copy.

### 6. Hand-built modals lacked a focus trap, Escape or focus return (low)

**Fix.** `useModalFocus` is now applied to:
- the calendar composer;
- the comments, embeds and blueprint sheets;
- deck study;
- the presentation rehearsal report and presenter;
- whiteboard present mode;
- the command bar;
- both agent library dialogs;
- the ManageBac settings and manifest dialogs;
- the plan bulk confirmation;
- the guided tour.

Surfaces that already owned Escape keep their own handler and take only the trap and focus return: comments, blueprint sheet, deck study, presenter and command bar. The reason is that the hook stops Escape at the dialog node before React's own handlers run. The code studio confirm dialog now returns focus to its opener.

Two related improvements came with this:
- Deck study now receives focus when it opens. Before, its keyboard grading did nothing until the student clicked.
- The rehearsal report's close button gained an accessible name.

**Tests.** `src/components/ui/use-modal-focus.test.tsx` has two parts:
- a jsdom test of the contract: focus moves in, Tab wraps, Escape closes, focus returns;
- a guard that fails when any `aria-modal` surface in `src` skips the hook.

The guard exempts three surfaces that already implement the full contract themselves: `chat-browser-panel.tsx`, `code-studio.tsx` and `context-controls.tsx`.

## Reported, not fixed

- **The 50-copy restore limit is not raised** (`convex/artifactRestore.ts:93`).
  - It matches `convex/durableContentDependencies.ts:18` (`COLLABORATION_CONTENT_DEPENDENCIES_SIZE`) and `MAX_REPLICAS_PER_WORK` in `convex/spectraApplicationWriteScope.ts:26`.
  - Every replica is hashed into the restore's fenced `headHash`.
  - Raising one cap alone would let a restore admit a head that the dependency and write-scope paths refuse.
  - No UI exists to remove stale replicas, so the message points the student to a teacher or admin.
- **A write superseded by a newer human write stays `native_pending`** (`convex/bridgeWriteOperations.ts:119`).
  - The newest request per replica decides the outcome. If a person's newer write replaces the AI's queued write, the run keeps "hasn't confirmed yet", which is true but never settles.
  - Settling it would need a rule for when a human write carries the AI change. That is a product decision.
- **The chat reply text is not changed.** The model's own `finalResponse` can still say "I updated your document" without the native caveat. The truth is carried by the receipt summary and the dock (`receipt-report.ts:142`, `live-dock-model.ts:111`).
- **Merge has no UI.**
  - `resolution: "merge"` is still accepted by `convex/spectraOperations.ts:530`, `convex/regionClaims.ts:176` and `route.ts:1331`, but nothing offers it now.
  - A plain-language merge needs a per-region text editor rather than JSON. Left for design.
- **The resume path's final verification has no recorded append positions** (`src/app/api/spectra/run/runtime.ts:3195` and `:3226`). Resumed runs have no per-operation acknowledgement verification, so they fall back to the old arithmetic. A human append during a resumed run can still produce a false failure.
- **`GuidedTour` is not rendered anywhere** (`src/components/ui/guided-tour.tsx`). The hook was applied anyway. It is a candidate for removal.
- **"Ask Spectra about this time" has no click handler** (`src/features/spectra/calendar/ui/calendar-application.tsx:1802`). It is a dead button.
- **The plan bulk confirmation (`plan-studio.tsx:1486`) has `role="alertdialog"` but no `aria-modal`**, so the guard test does not cover it (it does now use the hook).
- **Context-controls popovers return focus only on Escape** (`context-controls.tsx:202` and `:743`), not after a pick. This is acceptable for a popover.

## Rejected

- **Marking a run `native_verified` when the Bridge reports `claimed` or a matching base hash.** Only the `verified` readback proves that the file holds the change.
- **Keeping "Cancel proposal" as a third conflict choice.** It had exactly the server effect of "Keep the saved version", and two labels for one effect confuse students.

## Tests and gates

- Focused vitest runs for every changed area passed.
- The one full run (`vitest run --maxWorkers=3`) had 433 files passed, 1 failed and 1 skipped; 3997 tests passed and 3 failed.
  - All 3 failures are in `ai-live-write-admission.test.ts`, which this branch did not touch. The `@/lib/collaboration-token` mock at base `3aa01f19` lacks `collaborationGatewayUrl`.
  - Main already fixed this in `885807e8`, after this branch was cut.
- `tsc --noEmit` and `eslint --max-warnings=0` on touched files are clean.
- `check:architecture`, `check:copy`, `check:design-tokens`, `check:capabilities` and `check:secrets` pass.

## Needs live verification

1. A native Word edit through a paired Bridge: the dock says "waiting for your file to confirm", then "checked in the file on your computer" after Bridge readback, without a reload.
2. The conflict card in the browser during a real region claim: the comparison is readable, both choices resolve, and the waiting state releases.
3. A person appending a flashcard while an AI run appends to the same deck: the run ends verified.
4. Restore on a work with more than 50 linked copies, and on a version whose retained file is gone: the plain 409 message appears in the history panel.
5. The live code preview with the network off.
6. A keyboard-only pass through each dialog in item 6: Tab stays inside, Escape closes, and focus returns. Include deck study keyboard grading on open.

## Shared files touched

- `convex/spectraRuns.ts`: one import, and one guarded hunk in `updateStatus`.
- `convex/bridgeSync.ts`: one line.
- `convex/bridgeWriteOperations.ts`.
- `src/app/api/spectra/route.ts`: the restore catch only.
- `src/app/api/spectra/run/runtime.ts`: one line.
- `src/app/api/spectra/run/loop/receipt-report.ts` and `verify.ts`.
- The Live Dock (`live-dock.tsx`, `live-dock-model.ts`).
- `conversation-surface.tsx` and `recovery-controller.ts`.
- The dialog files listed in item 6.

Not touched: `convex/schema.ts`, `use-spectra-run.ts`, `metering.ts` and the `beginRun` path.
