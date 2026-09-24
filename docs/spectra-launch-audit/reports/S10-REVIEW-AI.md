# S10 REVIEW-AI — independent execution and intent review

2026-09-24, main, inherited dirty baseline at HEAD `898229c8`. **Independent source review and deterministic re-verification complete; live acceptance remains pending.** This lane owns this report and six new `src/features/spectra/__tests__/s10-review-ai-*.test.ts` files (16 independent cases). S10-AI owner: `01a0d32a-9164-74a0-9320-b4c2c7967a35`. No production edits, branch/index changes, runtime/deployment/Office mutation or live model calls by this lane.

Initial permissions were workspace-write/restricted network; later context explicitly enabled danger-full-access/approval never. Subsequent context changed more than once; permissions are read from the current session, not inferred from the registry.

## Confirmed findings and re-review

| Priority | Boundary and reproduction | Current evidence |
| --- | --- | --- |
| P1 | Generic application actions continued after Stop during awaited authority or folder lookup. | **Repaired, three independent cases pass.** Owner added cancellation checks and a transactional `spectraApplicationWrites` gateway with exact operation scope, fresh authority and atomic receipts. Source review caught obsolete `actorClerkId` nested args; owner removed them. SECURITY found receipt loss through `markFailed`; owner preserves it. Independently rerun real nested mutation/scope/replay suites pass. |
| P1 | Focused edit shortcut forced `fulfillsRequest:true` and finished after one operation despite further requested actions. | **Repaired, three independent cases pass.** A Calendar-only guard first fixed schedule but left settings broken. Owner then removed the early terminal shortcut and forced focused tool/schema restrictions; general work ends through `submit_plan`. Held-out edit+schedule, edit+Library, edit+settings all retain the second operation. |
| P1 | Declared intent allows an extra artifact, missing requested artifact type, and ignored explicit destination. | Initial three failures in `s10-review-ai-intent-contract.test.ts`. Owner removed repeated-type count exception, requires every requested create type and rejects null/inbox placement for explicit workspace. Independently rerun: all three pass. |
| P1 | Explicit `navigate_spectra` with Follow off did not dispatch navigation/open while server reported success. | **Dispatch repaired, three independent cases pass.** Explicit Calendar/artifact events now dispatch; ordinary reference work stays background. Owner also bypassed the shell's Follow guard only for explicit navigation. Server reports `requested`, not ready. End-to-end readiness and historical event replay remain open below. |
| P2 | Planner linked-artifact append was absent from shared dependency mapping. | **Repaired, two independent cases pass.** `/linkedArtifactIds/-` now rejects missing producers and remaps/resolves through compaction into the saved ID. Owner also added optional `/content` prefix handling. |
| P1 | Compact model orientation dropped `activeGoal`, losing the authoritative unresolved request after a clarification. | **Repaired, independent case passes.** The selected answer and unresolved goal survive `buildAgentOrientation` instead of relying only on historical conversation. |
| P1 | Replacing a passage with another page in the same source retained the old generated native citation. | **Repaired, independent case passes.** A page-2→page-7 update now refreshes generated citation identity/page/evidence. Owner preserves authored rich inlines. Independently rerun source suite also checks DOCX export/reopen. |

## Verification record

All executions use `npx vitest run <explicit paths> --maxWorkers=1 --no-file-parallelism`; mocked provider responses never contact a model.

- Initial action-fencing + intent: 6 failed, 4.66 s. Failures assert desired behavior; none are weakened, skipped, or marked expected-to-fail.
- Intent after fix + initial mixed + navigation: 4 passed, 3 failed, 6.49 s.
- Extended mixed + dependencies: 2 passed, 3 failed, 4.59 s. Schedule shortcut repaired; non-Calendar mixed requests remain.
- After generalized completion, cancellation and append repairs: 8/8 passed, 5.98 s.
- Clarification/citation continuation initially: 2/2 failed, 3.11 s; both repaired by owner.
- **Final current-source run, 14:54:39 Europe/Madrid: 14 files, 91/91 passed, 19.78 s, one worker.** All six `s10-review-ai-` files plus `operation-dependencies`, `reference-command`, `calendar-time-intent`, `source-evidence-content`, `attachment-evidence`, `follow-ai`, and Convex `ai-operation-scope-security` / `ai-application-integration`.
- Scoped ESLint on all six new review test files passed with zero warnings.

The final run used real local test implementations and isolated in-memory Convex fixtures. It covers committed receipt replay and preservation through failure, wrong actor/attempt/input/approval denial, four Calendar mutation families and source attachment/citation paths. It does not exercise the served backend or a real Stop during an in-flight live transaction. No final deterministic failure remains in this selected set.

Historical S9's 111+54 passing tests are prior deterministic evidence. They do not establish current live quality, all action families' atomic receipts, browser readiness, native output, or Stop races.

## Required held-out acceptance

- Use a novel numeric reading/CSV topic, e.g. shaded versus unshaded campus cooling measurements; request a useful guide and brief presentation without dictating schemas. Check all source values and units, editable chart series/table, actual explanation and passage/page support. Include one unsupported causal claim in the brief: output must qualify it rather than invent evidence.
- Source workspace A, current destination B, duplicate Unicode guide titles. Create a guide plus separate cards, clarify a real ambiguity, change focus, reload, and inspect both targets and retained attachments.
- Edit a task note plus schedule; edit plus settings approval; edit plus explicit Library navigation. Schedule two different blocks in Europe/Madrid and inspect UTC plus wall times and official deadline preservation.
- Stop after operation claim but before mutation commit; change approval target/input; lose the mutation/receipt response after persistence and resume. Require no stale commit, no duplicate effect and truthful partial result.
- Explicit navigation with Follow off, ordinary work with Follow off, manual navigation during Follow, unmounted reference insertion and receipt replay. Verify actual ready surface and durable version separately.

## Unresolved limits and handoff

- Navigation delivery is still fire-and-forget at `handleSpectraAiUiEvent`; it does not return the awaited command/readiness result to the run. The requested-status repair is truthful but is not proof of the full open outcome. OPEN's ready marker waits for committed selected editor (and TipTap for documents); consume that boundary in live acceptance. Explicit navigation replay currently lacks a stable operation/action receipt in its payload; verify that remount/reconnect does not override later manual navigation. AI and coordinator have these residuals.
- Source handle validity, exact page roundtrip, editable numeric structure and schema checks do not establish semantic source support, accurate data interpretation, teaching usefulness or visual quality. Judge live persisted guide/deck content and exported/native output independently.
- Latest source repairs require paired web/Convex publication. This lane did not inspect or mutate the shared served runtime. Historical S9 native/latency findings remain tied to their tested revisions; Windows evidence does not establish macOS.

No held-out live corpus, native exports, model token/latency comparison, or production/Mac evidence has run in this lane. Whole-request quality cannot be concluded from a schema pass or successful first action.
