# S11 choreography — first bounded repair and execution-contract review

Date: 2026-09-25. Worker: `01a0d846-54e2-71b0-86a7-1976e532e794`.
Coordinator: `01a0d83f-92fb-7b80-9ea4-99fcecef20aa`.
Base: `d9aabfb5735bdcd8a620af8a7bdaa85aba08d150`.
Checkout: `<local-workspace>`; branch `codex/s11-choreography`.
Coordinator independently verified GPT-6 Astra / xhigh / danger-full-access / approval never.

## Result and limits

The first unit replaces time-based local completion with explicit performer acknowledgement, repairs lost blocked entries, and isolates actors. Existing saved-result notifications still update Follow AI locations and reference receipts, but no longer pretend to execute a control after the write. The existing Follow AI status/cursor UI and artifact awareness rendering are preserved.

This is **not** full app-wide action execution. The prior `performAppUiEvent` path never operated a control or rendered an ordinary-mode app cursor: it allocated a no-op artifact performer and retired a queue entry on a timer. Removing that path removes false execution bookkeeping, not an existing ordinary-mode visible performer. The new callback lifecycle is ready for prepared local performers, but no production command adapter invokes it yet. Backend application writes, artifact Yjs streaming, and durable receipts are unchanged. A future callback's `completed` means local performance finished, not that a canonical write succeeded.

No service, browser profile, backend publication, native mutation, original file mutation, or production deployment was started by this worker. Browser proof is requested from RUNTIME and remains unrun. Full typecheck/build/full-suite checks were not claimed or run without a shared heavy slot.

## Source review and decisions

The complete S11 charter and private user brief were read. The coordinator's original request was read through `read_thread`. The latest request explicitly supersedes the earlier restriction of ordinary-mode choreography to artifact editors.

Historical conversations read: S9 recovery `01a0c3c8-af56-70b1-9da4-298cc0ad6384`, S9 integration `01a0cb47-5362-7f51-83b1-0a2b0775fe3d`, S10-AI `01a0d32a-9164-74a0-9320-b4c2c7967a35`, S10 REVIEW-AI `01a0d338-6276-7861-b6d6-a7d454ba28fd`, and final S9/S10 AI `01a0d3b1-e48a-7292-b2eb-051452e961ae`. The latter's turn `01a0d3b1-e8af-7d72-ae44-47f7cb278cad` contains the direct user Follow requirements, the immediate cursor update decision, focused-suite claims, and explicit deferral of authenticated control-by-control acceptance. Recovery had failed turns and does not establish live acceptance.

| Source / original decision | Current call-path evidence | Verdict / cross-system consequence | Verification and residual |
| --- | --- | --- | --- |
| `534dc9b9`: one actor timer retires app choreography after 280ms | `app-choreography-host.ts` baseline `completeLater` clears the previous actor timer; a queued second ID's timer tries to complete the active first ID and fails. Neither callback operates a control. | **Replace.** A prepared local callback finishes/fails explicitly. Expiry cancels local presentation, never establishes save success. | Baseline execution with transpiled original source reproduced first active + second queued after all settle timers fired. New deferred-callback tests verify actual changes occur in FIFO order and no 280ms success assumption. |
| `534dc9b9` and later retained coordinator target claims | Baseline `pump` removes every head whose status is not `queued`, including `blocked`. Enqueue another operation for that actor or cancel an unrelated ID and the blocked head disappears. | **Keep independent queues and target claims; replace lifecycle handling.** These local claims are not cross-tab or server revision locks. | Baseline A1 active / B1 blocked / B2 enqueue incorrectly becomes A1 + B2 active. Patched result preserves A1 active / B1 blocked / B2 queued. Failure, cancellation and expiry release the claim and preserve FIFO. |
| Baseline one mutable `artifactPerformer` with `setActor` | `artifactPerformerFor` gives all runs the same instance. Same operation IDs collide and cancellation crosses actors. Its publish callback is empty. | **Replace instance ownership.** Each actor has a separate performer. Do not mislabel this unused client wrapper as the real server awareness performer. | Deterministic test starts matching operation IDs for two actors, cancels A, and retains B's operation. |
| S9 `b63daf0c`: application commands emit semantic result notifications | `loop/act.ts` awaits settings/Library mutation before emitting `settings_changed` / `organize_library`; `calendar-command.ts` has the same after-write event shape. `runtime.ts` forwards `ui_event` without operation identity. `use-spectra-run.ts` forwards it to `ai-ui-events.ts`. | **Keep notifications; remove their fake action dispatch.** No re-invocation of saved writes on event replay. Requiring operation execution here would duplicate effects. | Saved-event replay test keeps queue empty, preserves notification target/note, and performs no navigation in ordinary mode. Real pre-commit adapters are a subsequent unit. |
| `d9aabfb5` / final AI turn: immediately position global Follow cursor and track navigation settles | `AppChoreographyMount` searches loose target keys, clamps position to viewport, and falls back to an app corner. `follow-ai.ts` changes route separately. Existing test proves mounting/coordinates, not a real dropdown or write. | **Keep UI for this unit; needs replacement of target/execution binding.** A fallback cursor is location/status presence, not proof an action happened. | Existing Follow/cursor regressions pass. Missing target, artifact path truncation, shared target keys and the 90/260/620ms settle assumptions remain unproved live. |
| Existing surface-only visibility arbitration | A mounted settings/calendar page was enough to animate, even if its control was clipped or collapsed. `school` had no distinct app surface. Missing actor identity could inherit the selected actor's Follow permission. | **Replace with optional exact target measurement at each control boundary.** Ordinary mode returns no animation for invisible targets; Follow requires reveal, and another actor cannot navigate. | Real DOM geometry stubs exercise ancestor clipping, visibility changes, hidden controls, selected actor changes, unchanged user selection/focus/scroll/route. This is deterministic geometry evidence, not browser layout proof. |
| Existing `AiPerformer` speculative frames and grace expiry | `ai-performer.ts` drives `planChoreography` with timers; `finishChoreography` calls `commit` after 4s without durable acknowledgement; `confirmDurable` matches path alone. It is not the production artifact write loop. | **Needs replacement in next contract.** Timer expiry must clear provisional state as expired/unconfirmed, not imply success. Receipt matching needs operation/revision identity, not only path. | Source-audited; unchanged in this unit except actor instance ownership. Existing performer tests are regression checks, not endorsement of these semantics. |
| Prior artifact streaming throughput repair retained by S9/S10 | `yjs-artifact-operation.ts` caps stream to 48 beats, including sampling required beats if they exceed that cap; each delay is capped at 36ms. Awareness + preview ledger precede one final `commitAiYjsAfterNativeQueue(plan.apply)`. There is no live client visibility decision at each beat. | **Replace execution/presentation coupling after contract review; retain actual region/native/durable fences.** Increasing waits alone is not a repair. The current system can show speculative actions rapidly and then commit all at once. | Source-audited actual `applyAiArtifactMutation` path through `loop/act.ts`. Live one-to-one typing/menu/drag behavior remains a launch gate. |

The direct tests previously asserted that an after-write Library event produced a `performing` entry. That assertion encoded the flawed architecture. It now verifies the saved notification remains available while no action is replayed.

## First unit implementation

- Coordinator preserves blocked heads, deduplicates the same in-flight `(actorId, operationId)`, rejects retargeting that identity, clears obsolete blocking reasons, and releases claims on explicit completion/failure/cancellation.
- Every active performance has an expiry, including actions without a target key. Real progress can renew that local lease. Expiry cancels; it does not complete.
- The host invokes the queued callback only after it becomes active. Promise resolution acknowledges local execution, rejection records failure, and unmount/expiry aborts the callback. A late acknowledgement cannot complete a newer request with the same ID. Callbacks must observe their AbortSignal at control boundaries; this mechanism is not a substitute for server-side fencing.
- The callback receives a fresh `decision()` and `checkpoint()` function. Visibility includes DOM presence, hidden ancestors, viewport intersection and clipping scroll ancestors. This unit does not add navigation, typing or menu code.
- In-flight deduplication is deliberately local and finite. Persisted receipts remain responsible for replay after completed work, reload, process loss, or another device.

## Proposed shared contract — requires cross-review before implementation

Extend `actions/protocol/semantic-action.ts` and the existing typed command/run-event protocol. Do not add a parallel action bus or a second storage engine. `RecoverableAction` currently contains broad choreography metadata and an `apply` retry helper; it does not bind performed control steps to durable receipts. Reuse the intent, target, conditions, collaboration policy and retry policy while making execution identity and acknowledgements explicit.

### Envelope and execution ownership

One prepared action carries server-owned `runId`, `executionId`, `operationId`, an operation digest, actor identity, command/capability ID, canonical target including stable artifact/control/region identity, expected region/base revision, and ordered typed control steps. A step has an immutable sequence and semantic action (text splice, option selection, drag update/release, toggle, open/close). Derive it from the actual validated change and real control descriptor; do not invent menu options or decorative steps.

An observer lease identifies `(client session, actor, operation, epoch)` and whether Follow is active. Exactly one client owns execution for an operation; other tabs/people render its attributed state. Same-account clients still synchronize normally. Another visible actor has a separate queue/body. Presence and viewport observations do not grant approval or authorize effects.

Per-step outcomes distinguish `target_ready`, `locally_applied`, `canonical_committed`, `native_queued`, `native_verified`, `blocked`, `failed`, and `cancelled/expired`. Include acknowledged sequence and the matching operation/revision identity. A finished animation is never a canonical receipt. Do not persist every caret frame as a whole artifact snapshot.

### Migration at current call paths

1. **Application commands:** before `executeApplicationCommand` dispatches the authorized mutation in `loop/act.ts` / `calendar-command.ts`, prepare the semantic action under its existing durable operation ID. Publish through the existing run/action stream, preserving that ID in `runtime.ts` and `use-spectra-run.ts`. If the target is visible, the owning local adapter opens/operates the actual registered control and asks the fenced server path to commit at the corresponding action point. Ordinary mode must not steal browser focus/selection. Menus that cannot open without stealing focus need a collaborator presentation mode driven by the same control state, not synthetic DOM clicks.
2. **Artifacts:** adapt `applyAiArtifactMutation` / `yjs-artifact-operation.ts` to execute incremental semantic edits through existing native/Yjs command adapters and origin identities. Reuse target geometry and control descriptors. Rebase after competing edits; validate authority/base-region revision at the actual mutation boundary. Preserve Tiptap/CodeMirror/Yjs user selections. Keep a bounded operation transaction/history grouping and durable final acknowledgement. Do not replay speculative old values over a completed write.
3. **Visibility and Follow:** resolve the exact current target before every step. Ordinary visible steps use natural pacing; invisible steps apply without animation overhead. If the user moves into/out of the area, the next step uses fresh geometry. Follow permits route/scroll/panel/menu reveal and waits for actual target readiness; an active Follow lease never takes the invisible-work shortcut. Bind the existing cursor to this target/step rather than a guessed corner. Extend school navigation deliberately through the existing route types and shell, not just surface classification.
4. **Collaboration seam:** transport the same operation/step identity and acknowledgements using existing provider/awareness paths. Distinguish local view state from canonical edits. Only execution owner applies a step; other observers render it. Independent regions proceed concurrently; conflicting same-region changes wait/rebase/conflict rather than overwrite. Local target claims do not protect cross-client writes.
5. **Bridge seam:** retain `commitAiYjsAfterNativeQueue`, queue receipts and revision ancestry, but re-check the revision/region at commit. An earlier "native queue empty" read is not race protection. Native-only updates and UI edits share the same base/revision conflict rules; native export remains an acknowledgement stage separate from canonical save.

### Failure/recovery states

| State | Required behavior |
| --- | --- |
| No observer / closed browser from the start | Server executes the same authorized semantic operation directly without animation waits. Durable work does not require a browser. |
| Active ordinary observer, target invisible | Execute without animation; reevaluate visibility at the next step. Do not move the viewport. |
| Active Follow observer, target not ready | Reveal the actual target and wait with a bounded readiness deadline. Keep the operation pending/blocked; never report a fake action or silently use invisible execution while this Follow lease remains active. |
| Follow/browser crashes or lease expires | Invalidate that observer epoch and clear its provisional state. Inspect canonical receipt + last applied sequence, then resume only uncommitted work under the server path/new owner. The expired Follow session is no longer an active viewer; old UI acknowledgements cannot advance it. |
| User disables Follow / moves viewport | Stop route/scroll control immediately; continue the same semantic operation in ordinary mode, with fresh visibility. No cancellation of durable work unless Stop was separately requested. |
| Approval rejected, permission revoked, Stop/steer epoch invalidated | Server fence rejects effect. Cancel uncommitted UI state; preserve existing committed receipts and compatible intent. UI readiness is never authorization. |
| Control unmounts mid-step / same region changes | Stop that local step, re-resolve target and revision. Rebase a disjoint change or preserve/report a true conflict. Do not restore a stale full snapshot over user changes. |
| Lost acknowledgement / duplicate or reordered step | Query receipt and acknowledge by operation digest + epoch + sequence; skip only confirmed effects. Never retry a non-idempotent step from a vague timeout. |
| Slow native write or Office lock | Canonical completion, queued native write and verified native write remain distinct. Bounded Bridge retry does not prolong speculative UI indefinitely. |
| Reduced motion | Reduce movement, preserving real action ordering and acknowledgement. Do not convert unfinished work into success or bypass Follow target readiness. |

This proposal needs AI loop/authority, COLLAB and BRIDGE review, then one real application control and one editor operation as vertical slices before broad migration.

## Verification evidence

1. Original-source reproduction: `.spectra-local/launch-s11/choreo/reproduce-baseline.cjs` transpiles the original coordinator and host from `git show d9aabfb5` (read-only) and runs the losing-queue and replaced-timer scenarios. Output in `baseline-reproduction.json`. The current coordinator retains B1 where the baseline loses it.
2. Focused new/changed suites: **4 files / 38 tests pass** (`s11-app-choreography-execution`, `app-choreography-coordinator`, `app-choreography`, `ai-ui-events`), one worker, file parallelism disabled.
3. Neighbor regressions: **4 files / 55 tests pass** (`follow-ai`, `s10-review-ai-explicit-navigation`, `ai-performer`, `interaction-choreography`), one worker. These tests preserve current behavior; they do not prove unmodified speculative performers satisfy the new requirement.
4. Scoped ESLint passed with zero warnings; `git diff --check` passed. Git reports expected LF/CRLF conversion notices.
5. Live browser: **pending RUNTIME slot and served revision**. No generated screenshot or test adapter is represented as authenticated product evidence.

Reproduction command for the eight suites:

```powershell
node node_modules/vitest/vitest.mjs run src/features/spectra/__tests__/s11-app-choreography-execution.test.ts src/features/spectra/__tests__/app-choreography-coordinator.test.ts src/features/spectra/__tests__/app-choreography.test.ts src/features/spectra/__tests__/ai-ui-events.test.ts src/features/spectra/__tests__/follow-ai.test.ts src/features/spectra/__tests__/s10-review-ai-explicit-navigation.test.ts src/features/spectra/__tests__/ai-performer.test.ts src/features/spectra/__tests__/interaction-choreography.test.ts --maxWorkers=1 --no-file-parallelism
```

## Remaining bounded units

1. Cross-reviewed protocol and a real app-control vertical slice (prepared authorized operation -> live target -> actual control -> fenced commit -> receipt), including settings approval and rejection.
2. A real document text splice and a real dropdown/drag through the same step contract; remove timer/grace-based success and final-snapshot pseudo-streaming. Measure ordinary visible/invisible and Follow paths.
3. Bind global actor presence/cursor and Follow navigation to exact step target, with school/calendar/library/settings coverage, same-page scroll/collapse, mounted duplicates, and two actors.
4. Concurrent human/AI/native conflict and lost-ack recovery with operation/revision fencing; ordinary-mode selection preservation under actual editor transforms.
5. Authenticated Profile A acceptance after integration, then native and multi-client proof on disposable fixtures. No launch-readiness conclusion follows from this first unit.
