# S11 AI engine: ordinary completion and bounded recovery

Starting revision: `d9aabfb5735bdcd8a620af8a7bdaa85aba08d150`.
Checkout: `<local-workspace>`.
Branch: `codex/s11-ai-engine`.
Coordinator: `01a0d83f-92fb-7b80-9ea4-99fcecef20aa`.

Full Access is explicit in this task's environment (`danger-full-access`, approval `never`). The fleet records independent verification of GPT-6 Astra/xhigh. The initial checkout was clean and detached at the starting revision; this worker created the scoped branch above. No subagents, services, installs, backend publication, production deployment or browser mutations were started.

## Decision and scope

Use one ordinary model/tool loop with text completion, retaining the existing durable execution boundary. The model can answer without tools or finish after staging all requested actions without serializing another terminal plan. Structured tool arguments remain the only ordinary source of executable operations. Plans remain optional; dedicated creation and coordination workers retain their current output contracts.

This is a bounded migration, approved by the coordinator, not the complete persisted-per-tool architecture. It does not claim that self-reported model completion proves every semantic user intention was fulfilled. The original request and compatible steering remain model context; exact target, ownership, dependency, selected-agent, content, authority, approval and receipt checks still run. No schema or SECURITY/CRAFT/CONTEXT/CHOREOGRAPHY implementation is changed here.

## Caller inventory

- `runtime.ts:runAttempt` invokes `callModel` directly for ordinary work, or `callParallelCreationWorkers` / `callMixedTaskGraphWorkers` for existing specialized workers.
- `loop/plan.ts:callModel` owns model requests, typed staging and recovery. Its `runNativeAgentPass` is the sole production caller of `ai/agent-loop.ts:runSpectraAgentLoop`.
- The generic agent loop has direct unit-test callers only; repository search found no other production caller.
- `callParallelCreationWorkers` and `callMixedTaskGraphWorkers` call `callModel` with dedicated creation/coordination contracts. Those contracts remain intact.
- `fastConversationalPlan` had three production call sites in `runtime.ts`: immediate run, post-context focused shortcut, and inline request dispatch. The function and all three calls are removed. Existing deterministic focused-edit helpers and school-connection preflight are outside this finite unit.
- `buildContext` has two runtime callers: ordinary run intake and confirmation/resume. CONTEXT owns the new demand-driven option. Both retain existing context behavior in this initial candidate; activation needs the discovery handoff described below.

## Evidence and decisions

| Source | Finding and existing implementation | Current evidence | Decision and consequence |
| --- | --- | --- | --- |
| Final S9-AI task `01a0d3b1-e48a-7292-b2eb-051452e961ae`, final message; starting `d9aabfb5` | Live citation continuation lasted about 3m9s and repeated retrieve/inspect/plan without proposing a write. S9 added repair budgets but did not establish successful citation acceptance. | `plan.ts` required staging followed by terminal `submit_plan`; `agent-loop.ts` suppressed repeated calls but did not respond to a stalled multi-turn cycle. | Replace compulsory terminal serialization for ordinary work. Add actionable cycle feedback and bounded exhaustion. This removes plausible harness causes; it is not a live citation-success claim. |
| `plan.ts:parseAndCheckPlan` | More than one operation required an `intent.obligations` array, even though the schema already makes it optional. | Missing metadata caused another model recovery independently of the validity of typed operations. | Remove the compulsory check. Supplied obligations still pass existing schema/index/coverage validation. Model obligations are not an independent proof of full user intent. |
| `plan.ts:runNativeAgentPass` | Recovery cleared accepted operations and their summaries; focused encouragement narrowed to one focused mutation. | A mixed edit plus another requested action could lose accepted work during repair. | Retain staged operations and stable indexes, supply them to recovery, preserve full original scope, and use the ordinary tool loop for ordinary repairs. |
| `plan.ts:fastConversationalPlan` | English regexes produced fixed greetings, arithmetic, memory acknowledgements and clarifications. | All three runtime call sites bypassed model judgment. The memory response claimed recall without a tool receipt. | Remove the shortcut. Ordinary answers now use model text; no new intent keyword dispatcher is introduced. |
| `agent-loop.ts` | A second identical read was blocked even after a retryable failure. Reading a fourth distinct region of one object was blocked. | Fingerprint count did not distinguish transient failure from success or distinct useful evidence. | Permit one explicitly retryable read retry, retain mutation receipt deduplication, and measure new read observations instead of a per-target three-read ceiling. |
| Legacy plan coercion | Empty final metadata becomes a canned `Done` summary. | Reusing it directly for plain text would fabricate successful completion. | Reject empty model text before legacy coercion, allowing a bounded ordinary recovery. Prose that resembles JSON is never parsed as executable operations. |

## Behavior before and after

Counts below describe deterministic test scenarios, not live provider timing or cost measurements. Execution is pending the shared dependency hold.

| Scenario | Before | Candidate behavior |
| --- | --- | --- |
| Greeting or factual answer in plain model text | Only a few English patterns bypassed the model; other prose was sent through terminal-plan parsing/repair. | One model turn, zero executed tools, zero staged operations; plain answer retained. |
| Focused typed change then final prose | Required another `submit_plan` envelope or a format-repair path. | Two model turns: one `propose_operation`, one ordinary final response. Existing runtime then authorizes, commits and verifies. |
| Edit plus calendar action | First focused operation could not safely finish the whole request; terminal obligations metadata was compulsory. | Three model turns: typed edit, typed Calendar action, plain final. Both operations retained; `fulfillsRequest` never fast-completes the first action. |
| Empty response after staging the first part of mixed work | Staged graph reset on native repair; focused encouragement could narrow scope. | Four model turns in the regression: stage first, empty response, stage remainder on repair, final text. Indexes stay 0 and 1. |
| Repeated successful read | Read payload reused once, then generic duplicate errors until ordinary pass limits. | Read data fetched once; after two no-progress tool turns the model receives actionable feedback with writes still available. Four consecutive no-progress turns enter finalization. Two further unsuccessful turns raise a typed stall, which is not restarted across providers. |
| Transient read failure | Identical retry blocked. | One identical retry allowed when explicitly retryable; no automatic retry of an unacknowledged mutation. |
| Four useful regions in one artifact | Fourth read blocked. | All four distinct useful results accepted. |
| Stop arrives while final model response is pending | No explicit post-request abort check before returning terminal/prose output. | Immediate abort propagation; no success or provider retry. |

## Verification and integration

Prepared tests cover direct multilingual/factual replies; plain JSON as non-executable answer text; mixed staged outcomes; empty-response recovery; no-progress exhaustion; transient read recovery; receipt reuse; useful region reads; terminal sibling handling; and Stop. Route tests cover a real ordinary answer and committing a typed staged update after plain final text, with no write before completion.

At this draft, `git diff --check` passes. Tests, lint and typecheck have not been run: the coordinator/RUNTIME explicitly halted all test/build/install starts during the dependency incident. No runtime acceptance is claimed.

Integrate with CRAFT prompt alignment `00523e2a8c330f1e6a1f110ae195ad14efc00b3b`; it removes the old tools-mode instruction forcing answers into terminal plans. CONTEXT's demand-driven `buildContext` work is a separate prerequisite for claiming no broad initial context retrieval. SECURITY's planned server-classified approval hook remains reserved. CHOREOGRAPHY's existing pre-commit action seam remains authoritative because this unit does not write inside the model loop.

## Remaining limits

- Citation success, saved native bibliography arrays and real provider behavior require a reserved live acceptance run. The source and mocked regressions do not establish these.
- Ordinary completion still commits a staged graph after model completion. A fully persisted per-tool loop with receipt-derived continuation remains a separately reviewed migration.
- Accepted staging is preserved during one `callModel` recovery chain, but not durably across an `ask_user_choice` clarification pause. The full unresolved request must survive that continuation; persisting staged candidates there needs a separate contract.
- An accepted staged operation cannot yet be explicitly replaced or withdrawn by index during recovery. It is not a receipt and must never be described as saved before execution.
- The existing internal final-response schema retains its 4,000-character limit. Long-form conversational output and optional durable conversation metadata remain follow-up work.
- Selected-agent routing, speculative creation dispatch, and deterministic focused-edit helpers still contain earlier policy decisions. Removing greeting shortcuts does not claim those are all model-driven.
- Initial broad-context savings depend on CONTEXT's separate integration; no byte/token/latency savings are measured in this report.
- Do not enable orientation globally yet: `resolveAndValidatePlan` checks `ownedReferences(initialContext)` before the later `gatherResolvedArtifactContext`. Tool-discovered targets absent from initial context are not handed back to the resolver; `request_context_target` likewise uses initial artifact maps. A safe authenticated discovery handoff needs regression coverage for search/read/write of a previously unlisted target.

The coordinator assigned durable clarification continuation as the next finite unit after this candidate, with independent reviewer `01a0d86a-9c58-7a12-801b-78a306bb8b9d`. Genuine context compaction remains a subsequent coordinated unit; this work does not implement it.

## Separate explicit-refresh follow-up

Every registered mutable read now accepts `refresh: true`: artifact, workspace, thread, Calendar, embeds, Library/object search, memory, school records and public research. The agent loop handles this directive before cache reuse or duplicate-call suppression, so successive identical refreshes each reach the existing authenticated executor. It is not forwarded to backend APIs that do not accept it. School-record refresh still only rereads Spectra's stored records and exposes the existing provider-sync approval handoff; it does not perform a provider sync.

Successful reads carry `readSnapshot` metadata with the originating tool-call id, observation time, and available source revision/version/hash/update metadata (at most 32 entries, with explicit truncation). Reuse identifies that exact earlier snapshot and says that no fresh data or permission check occurred. Explicit refresh invalidates previous reuse before fetching, so a failed or revoked read cannot fall back to an earlier success. An older parallel read cannot replace the cache after a later refresh completes or fails.

Read progress uses stable result content, coverage and revisions. Observation times, refresh counts, execution telemetry and metadata update timestamps alone do not reset the stall counter. User content fields retain their literal values. Existing turn, tool, time and token bounds still apply, and refresh does not permit mutation retries. No subscription or write/CAS/merge contract was added or bypassed: fresh reads remain subject to a race before any later write.

The read boundary also unwraps the executor's transport envelope. Previously an inner `{ok:false}` permission/read failure sat inside `{ok:true,data:...}` and could be treated as a cacheable success; direct artifact and research-source consumers likewise expected the unwrapped fields. Inner results now determine success, while execution telemetry remains available. Artifact reads retain current version id, content hash and live state vector hash when supplied by the authenticated backend.

`s11-ai-refresh.test.ts` adds schema coverage plus real read-executor/mocked-query scenarios for successive refreshes, exact cached snapshot provenance, revoked access, unchanged-content refresh loops, global bounds and mutation retry exclusion. These tests remain **unrun**, along with the first candidate's tests, under the shared dependency hold. Static `git diff --check` passes. Durable clarification remains separately stashed while this finite follow-up is committed and reviewed.

## Guarded validation — 2026-09-25

On committed `6c20c669` (including `5fba3511` and `17584448`), the coordinator released slot 2 for finite verification. All **81 tests in five files passed** in 13.23 seconds: `agent-loop.test.ts`, `s11-ai-engine.test.ts`, `s11-ai-refresh.test.ts`, `s10-review-ai-mixed-request.test.ts`, and `run-route.test.ts`. Scoped ESLint passed for all 11 changed source/test files. Scoped TypeScript checking passed for the seven changed production entry files with their transitive imports. This supersedes the earlier unrun status for these files only.

The previously absent worktree `node_modules` junction was created to the verified primary dependency tree only after the coordinator explicitly authorized it and absolute target/absence/Vitest checks passed. All runners used RUNTIME's filesystem guard and Vitest used one worker with file parallelism disabled. No install, existing junction replacement, build, service, publication or deployment ran. The test slot was explicitly released immediately after the executables completed. Both clarification stashes remain intact; those unfinished changes were excluded from this verification.

## Write attribution and full replacements — 2026-09-26

The primary and confirmation/resume paths make one apply attempt. Generic schema, synchronization and TypeError failures can happen after a write, so they no longer authorize an automatic preclaimed replay. Matching current content is no longer treated as acknowledgement of the attempted operation. The explicit region-conflict flow is unchanged.

AI-REVIEW receipt commits `49954e6e` and `76d6f8ea` are integrated here as `f6e83159` and `d3a16b7c`. Their attempt identity and receipt bookkeeping remain intact: unknown identity is set before applying, acknowledgement follows a returned result, and acknowledged outcomes are retained before verification. Failure reconciliation consults the journal; the successful path adds no queries. Existing post-acknowledgement current-state verification recovery remains outside this bounded change.

Full `artifact.update.input.content` replacements now compare complete normalized and schema-validated content, with recursive key-order-insensitive equality and ordered arrays. Missing/extra keys, omitted deletions and changed elements fail verification. Presentation policy is applied to expected content only; applying it to observed content could reconstruct a missing bibliography or reading order and conceal an incomplete save. Patch, academic-operation and metadata-only predicates are unchanged. The existing saved → live → bounded projection polling sequence is reused.

No new metadata exclusions are introduced. Foundry timestamp defaults generated on separate normalization calls can cause a conservative mismatch, and native locator/binding additions remain significant. Retaining the writer's exact normalized desired result would address those false negatives; this unit does not infer a broad subset or metadata-ignoring contract. Matching content verifies state only and never proves which operation saved it.

Prepared regressions exercise the actual verifier and route: complete replacement differences, normalization defaults and key order, stale projection/live/poll outcomes, metadata/patch/academic compatibility, presentation policy, Foundry volatility, and errors thrown after the mocked apply has changed content in both primary and confirmed execution. These new tests and scoped checks are pending the coordinator's finite test slot. Earlier green results apply only to the preceding committed work.
