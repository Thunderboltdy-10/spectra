# P3 AI engine: findings ledger

- **Branch:** `p3/ai-engine`, based on `d04fcd6f`.
- **Owner:** the Phase-3 AI engine agent.
- **Scope:**
  - the run route and loop;
  - `src/features/spectra/ai`, `runs`, `sources` and `context`;
  - `use-spectra-run.ts`;
  - `convex/spectraRuns.ts`, metering, `artifactEmbeds` and `artifactAssets`.
- **Contract kept throughout:**
  - reasoning runs at xhigh on every turn, and no capability was narrowed;
  - atomic signed admission for live writes;
  - approval scopes are enforced at the sinks;
  - no focus or viewport stealing;
  - fast direct answers;
  - compaction near 256k;
  - truthful receipts.

## Fixed

| # | Severity | Finding | Where (after the fix) | Commit |
|---|---|---|---|---|
| F1 | High | **Model spend was under-metered.** Only the final pass's usage reached the school ceiling. Repair and fallback passes, parallel workers and web research were never counted, and stopped or dead runs metered nothing. An AsyncLocalStorage ledger now records every provider response. `recordRunModelMeters` meters only growth past `meteredUsage`, so repeated reports never double-count. Stop, reconcile and approval-cancel meter the last heartbeat total. | `src/features/spectra/ai/run-usage.ts:32`, `openrouter-stream.ts:107`, `parallel-search.ts`, `convex/spectraRuns.ts:81`, `convex/schema.ts` (`meteredUsage`) | d555fb81 |
| F2 | High | **`finish_reason: "length"` was treated as complete.** A cut-off answer was saved as final. A cut-off tool call could still run with its truncated arguments, or end the run as terminal. Cut-off prose now continues up to 3 times and is stitched together. If it is still cut off, it says so. A cut-off call is answered with `output_truncated` and is never executed. | `src/features/spectra/ai/agent-loop.ts:34`, `:271`; `plan.ts` (`consumeAgentResult` note) | 3dd9a55e |
| F3 | High | **The id scrubber damaged AI-written content, and the stream leaked ids.** It deleted words, code identifiers and whitespace from AI-written code and prose. The streamed answer was never scrubbed, so internal ids reached the screen before the saved copy removed them. Now only Convex-shaped and owned ids are removed, together with their wrapper. The live stream holds back the trailing word, scrubs finished lines once, and replaces text already shown if needed. | `plan.ts:1939` (`createUserFacingSanitizer`), `plan.ts:4543` (`streamAnswerFor`) | 9bbfb141 |
| F4 | High | **A reply that saved nothing could claim a save.** For example, "I've updated your notes" with zero operations was stored like a receipt. That final answer now gets one correction turn: do the work with tools, or answer without the claim. If the claim persists, the answer carries "Nothing was saved from this reply." | `src/app/api/spectra/run/loop/completion.ts` (`claimsUnsavedWork`), `agent-loop.ts:302`, `plan.ts:4803`, `:5034` | 0fcf754e |
| F5 | Med | **Time to first token paid for serial waits.** The "reading" status write blocked the context reads. A focused edit built its whole context twice in sequence (orientation, then hydrated). The "retrieving" status write and the context snapshot were written one after the other. Now the context reads overlap the status write and the opening of creation shells. The hydrated build runs alongside orientation. The two later writes run together. Phase order and the model's context are unchanged. | `src/app/api/spectra/run/runtime.ts:500`, `:649`, `:845` | 91d72e7a |
| F6 | Med | **Run-loop logs could not be tied to a run.** About 40 `console.*` lines had no runId or requestId, and the failure line was a JSON string. A `runLog()` StructuredLogger now lives in AsyncLocalStorage: the request adds a requestId, and each attempt or resume adds runId and executionId. | `src/features/spectra/ai/run-log.ts`, runtime and `loop/*.ts`, `yjs-artifact-operation.ts` | e9b9e80f |
| F7 | Low | **Dead human region-claim chain deleted.** It covered the route actions acquire/renew/release, `ArtifactRegionController.acquire`, and the studio's renew interval and release call. None of it could run once human authoring became optimistic. AI durable claims are unchanged. | `src/app/api/spectra/route.ts`, `data/api.ts`, `collaboration/region-controller.ts`, `use-artifact-live-model.ts`, `artifact-studio.tsx` | 6f914852 |
| F8 | Low | **Dormant legacy visual prepass deleted.** This removed the vision model config, the attachment strategy and the env keys. | `loop/intake.ts`, `ai/model-config.ts`, `.env*.example` | 0c86fc3f |
| F9 | Low | **Orphaned `artifactEmbeds.contextContribution` and `visibleRegionExcerpt` deleted.** | `convex/artifactEmbeds.ts` | 6dbb9f87 |
| F10 | Low | **Dead parallel asset upload endpoints deleted.** These were `failUpload`, `finalizeUpload` and the unused authorized store. | `convex/artifactAssets.ts` | 92cf5a33 |
| F11 | Low | **Pre-existing red test on main.** `action-protocol.test` still expected reasoning "high" after fcf9dbbb. It now expects "xhigh", matching main's 1f9f1594. | `src/features/spectra/__tests__/action-protocol.test.ts` | 0c86fc3f |

## Reported, not fixed

- **R1 (Low): the typed `applied: false` conflict union is unreachable, and the studio branch that handles it is dead code.**
  - `ArtifactRegionController.edit/editMany` always return `applied: true` (`collaboration/region-controller.ts:21`, `:33`).
  - The handler is `artifact-studio.tsx:3610`, and `liveConflict.claimId` is never set.
  - Narrowing the type means edits across the editor-owned models `artifact-yjs-model.ts` and `work/models/yjs/native-artifact-model.ts`. That is left to the editor agent.
- **R2 (Low): the AI "refuse" path of region claims is unreachable.**
  - `claimAcquireAction` refuses only a `paused` claim (`shared/region-claim-policy.ts:13`, used at `yjs-artifact-operation.ts:770`).
  - Nothing in `convex/` writes a claim with status `paused`.
  - So `AiArtifactRegionConflictError` from acquire (`yjs-artifact-operation.ts:437`) never fires. AI-vs-AI overlap queues, and humans are protected by the gateway's frame checks.
  - Deleting it requires changes to `convex/regionClaims.ts` and the conflict-resolution flow in `spectraOperations.ts`, outside this scope.
- **R3 (Med, product gap): the embed `contextPolicy` is stored but never changes AI context.**
  - It is stored at `convex/artifactEmbeds.ts:510`, `:601` and `:628`.
  - Wiring or removing it touches the reference UI, which is owned elsewhere.
- **R4 (Low): a worker takeover on the same execution can under-meter.**
  - A replacement worker's ledger restarts at 0 while `meteredUsage` holds the first worker's total (`convex/spectraRuns.ts:90`).
  - Its spend is metered only once it passes that total. This is rare (lease expiry mid-run) and bounded by one worker's usage.
- **R5 (Info): "uploading" asset rows can remain after an abandoned upload** (`convex/artifactAssets.ts:193`). This is intentional: they are hidden and retryable.
- **R6 (Info): prohibited tools remain on the model's tool list.** These are `pair_bridge`, `change_credentials`, `change_ai_authority_mode`, `delete_account`, `connect_future_provider`, `import_managebac_resource` and `change_managebac_mapping` (`tools/registry/application-tools.ts:686`).
  - Each can only return `authority_prohibited` with a truthful reason.
  - Removing them would save a few hundred prompt tokens, but the model would lose its grounded refusal text. They are kept deliberately.

## Rejected or already done

- **Item 10 (raw fetches in `use-spectra-run.ts`): already done on this base.** All six stop, confirm and resume calls already go through `requestSpectra` (`use-spectra-run.ts:792`, `1283`, `1317`, `1340`, `1500`, `1678`).
- **Capability review of the prompts** (`ai/workspace-assistant-prompt.ts`; `plan.ts:2609` `agentSystemPrompt`):
  - no contradictions, unavailable-tool references or refusal/hedging instructions were found;
  - every tool the prompt names is on `APPLICATION_AGENT_TOOL_IDS`;
  - the plan-mode "refuse" decision is not offered in tools mode.
- **Stop, retry and resume** were checked in the loop and client:
  - Stop aborts before each turn and each tool call. Queued mutations after a Stop do not run, as the existing test shows.
  - A provider error mid-stream takes back the partial answer before the retry streams (`text_replace:""`).
  - A steering Stop waits for a terminal state before continuing.
  - The terminal paths meter usage (F1), so a stopped run is neither lost nor double-counted.

## Gates and tests

Gates:
- `tsc --noEmit`: clean.
- `eslint --max-warnings=0` on every touched file: clean.
- `check:architecture`, `check:copy`, `check:design-tokens`, `check:capabilities`, `check:secrets`: all pass.

Full `vitest run --maxWorkers=3`: 443 files and 4075 tests passed (1 skipped).

Every behaviour fix was shown failing on the pre-fix code by temporarily restoring that file (no stash). The new tests:
- `run-usage.test.ts`
- `school-ai-ceiling.test.ts` (stop plus a late report; dead-worker reconcile)
- `agent-loop.test.ts` (3 length tests, 1 answer-review test)
- `user-facing-sanitizer.test.ts`
- `claims-unsaved-work.test.ts`
- `run-route.test.ts` (streamed-id split, saved-claim correction x2, parallel focused hydration, status write overlap, run/request ids on logs)

## Needs live verification

These need a real provider, gateway and collab room. Prompts are listed per kind.

**Answer:**
1. "Why can we see the Moon?"
   - Expect one model call and streamed text with no ids.
2. Ask for a 4,000-word essay in chat.
   - Expect it to continue past the output limit with no duplicated text.
   - If it still stops, expect the length note.
3. "Tighten my notes summary" with no artifact open.
   - The model must either do the work with tools or answer without claiming it saved anything.
   - Check that the first streamed claim is replaced.

**Document:**
- Create: "Create a document on the causes of WW1 with 4 sections."
- Edit: with it open, "Rewrite the second section to be more concise."
  - Time to first token should drop compared with main (F5).
- Append: "Add a conclusion paragraph."
- Rewrite: "Rewrite the whole document for a 12-year-old."

**Flashcard deck:**
- Create: "Create a flashcard deck about photosynthesis with 8 cards."
- Edit: "Change card 3's hint."
- Append: "Add 4 cards about the Calvin cycle."
- Rewrite: "Rewrite every card in Spanish."

**Quiz:**
- Create: "Make a 6-question quiz, 4 multiple choice and 2 short answer."
- Edit: "Make question 2 harder."
- Append: "Add two questions on enzymes."

**Sheet:**
- Create: "Make a budget sheet with monthly totals."
- Edit: "Change the rent formula to include 5% inflation."
- Append: "Add a savings column."

**Presentation:**
- Create: "Make a 6-slide deck on plate tectonics."
- Edit: "Tighten slide 3's bullets."
- Append: "Add a summary slide."

**Code:**
- Create: "Write a Python script that plots a sine wave."
- Edit: "Rename the function to plot_wave."
  - Identifiers must survive byte for byte (F3).

**Whiteboard:**
- Create: "Draw a mind map of the water cycle."
- Edit: "Recolor the evaporation node."

**Planner and Calendar:**
- "Create a task 'Revise chemistry' and schedule it tomorrow 4–5pm."
- "Move my Revise chemistry block to 6pm."

**Stop and steer:**
- Stop mid-stream on a long create. The partial must disappear, with no spinner left and no write.
- Redirect mid-run. The old run must reach a terminal state before the new one starts.
- Confirm the school ceiling counts the stopped run's tokens.

**Logs:**
- In production JSON, each `spectra.*` line for a run must carry the same `requestId` and `runId`, including provider turns and `spectra.run.failure`.

## Shared files touched

These are outside or shared with other agents:
- `convex/schema.ts` (`spectraAiRuns.meteredUsage`)
- `.env.example`
- `.env.local.example`
- `convex/parent-m02-boundaries.test.ts`
- `src/features/spectra/__tests__/honest-execution.test.ts`
- `src/features/spectra/__tests__/action-protocol.test.ts`
- `src/app/api/spectra/route.ts`
- `src/features/spectra/data/api.ts`
- `src/features/spectra/components/artifact-studio.tsx` (logic-only deletions)
- `src/features/spectra/collaboration/region-controller.ts`
- `src/features/spectra/collaboration/use-artifact-live-model.ts`
