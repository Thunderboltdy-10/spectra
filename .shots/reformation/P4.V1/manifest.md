# P4.V1 evidence manifest — 2026-08-28

Status: **REJECTED**. This was an independent signed-in Playwright walk against the current P4 implementation. The evidence root contains one numbered same-tab sequence (`00`–`26`); no screenshot is cited outside this directory.

## Journeys

1. `00-baseline.png`–`11-draft-readback.png`: created `P4V1 Pendulum Lab Draft` and `P4V1 Pendulum Lab Final`, focused Draft, and explicitly asked Spectra to append `TARGET-FINAL-4827` to Final. Run `ps7abdheg0hz576ahk4z7xdqd18da28q` resolved Final, named it in the Dock, changed Final, and left Draft at `DRAFT-UNCHANGED-4827`. **PASS: zero misdirected mutation.**
2. `12-sheet-quality-prompt.png`–`18-sheet-retry-running.png`: standardized pendulum analysis produced saved artifact `q57ctr8x49nw7stwyq21343j958da7zr` with formulas, automatic calculation, a range-bound scatter chart, frozen headers, units, and conclusions. The production sheet rubric scored **88/100 (PASS)** with two major conclusion/format findings and no blockers. The run then falsely failed after saving and exposed a Retry that returned 409.
3. `19-document-quality-prompt.png`–`20-document-quality-progress.png`: document artifact `q57dvxdttdgjkepj8z9yx8b0h58dacvs` was saved with valid structured content, then failed in `spectraArtifacts:finalizePendingLive` with “This pending artifact is no longer editable by that run.” Grading stopped when the class finding was confirmed.
4. `21-presentation-quality-prompt.png`–`23-follow-off-background-navigation.png`: the standardized 12-slide experimental-design brief entered bounded quality repair. Shared-rubric attempts scored **68, 74, then 59**, all below the 80 bar; the final run paused safely before commit. Findings included overflow/density, repeated layout rhythm, insufficient purposeful layout variety, and unreadable/missing supporting content. **FAIL: systemic presentation-generation quality class.**
5. While that deck run was active, Follow was off (`aria-pressed=false`); opening `P4V1 Pendulum Analysis` kept the viewport there through `23-follow-off-background-navigation.png`. **PASS: background run did not steal navigation.**
6. `24-lifecycle-proof-running.png`–`26-lifecycle-recovery-expanded.png`: after the class-wide runtime repair, the old deployed Convex finalizer was deliberately retained as the fault. The saved artifact stayed visible; the Dock said the step could not finish, preserved the work, offered conversation continuation, and did not offer unsafe Retry. Compare the prior dead-Retry surface in `17-sheet-failure-recovery.png`–`18-sheet-retry-running.png` with `25`–`26`.

## Finding triage

- **P4.V1-F1 — SYSTEMIC, fixed in this VU:** live staging legitimately moves AI-created artifacts from `creating` to `updating`, but `finalizePendingLive` rejected that owned state. Runtime recovery also inferred retry safety from completed outcomes and missed an operation currently across its commit boundary. The repair accepts the synchronized owned live state and derives Stop/failure/retry behavior from one shared commit-boundary helper across runtime and Convex. Retry is now absent whenever effects may have landed.
- **P4.V1-F2 — SYSTEMIC, remains in P4.V1:** presentation planning/realization/rubric repair does not reliably turn a normal 12-slide outline into presentation-quality output. This is independent of lifecycle recovery and spans generation, layout realization, and critique feedback, so R17 stops this VU instead of combining two seams.
- **P4.V1-F3 — SYSTEMIC gate drift, remains in P4.V1:** the current root TypeScript gate is red on unchanged P4 authority/runtime contracts as well as already recorded cross-phase files. This was discovered during close-out after the R17 stop; the P4-owned subset must be repaired without weakening the gate before P4.V1 can pass.
- **P4.V1-F4 — SYSTEMIC Dock density/legibility, remains in P4.V1:** screenshots `23`–`26` show that each run tab reserves one third of the strip while carrying Follow, conversation, Stop/Retry/Undo, and Close controls. At realistic run density the controls displace resolved titles and hide later runs, which violates this unit's Dock-legibility acceptance even though the buttons themselves are good.

## Secondary visual findings

- **Library responsive chrome — SYSTEMIC, later owner P6.I1:** in screenshot `23`, the List/Board switch, result label, search, type filter, sort, and create affordances compete in one narrow row beside the artifact panel. Current code confirms one `flex-nowrap` header with a `min-w-max` location and the full control sequence. P6.I1 owns scope-blind/narrow Dock and Library UX; P4.V1 does not patch it.
- **Side-panel artifact chrome inset — SYSTEMIC, later owner P6.I2:** the identity header and subordinate artifact bars do not share a coherent side inset in split mode, so the chrome reads flush against the panel edge. P6.I2 owns shared spacing/token adoption across the artifact shell; this is not a one-selector P4 screenshot patch.

## Checks and limits

- Red proof before F1 repair: all 3 new production-function lifecycle tests failed on the updating-state finalizer, executing-operation Retry, and safe partial-text replay boundaries.
- Green proof after repair: `convex/ai-run-lifecycle.test.ts`, `honest-execution.test.ts`, and `run-route.test.ts` — **3 files / 42 tests passed**; scoped ESLint passed.
- `check:capabilities` and the secret scan passed. `check:architecture` retained its seven recorded global-event findings. Root `tsc --noEmit` failed on recorded cross-phase files plus unchanged P4 lines in `run/loop/authority.ts` and `run/runtime.ts`; none of the new lifecycle helper/test or changed recovery hunks was named.
- `convex dev --once` was not weakened: its own typecheck stopped on pre-existing errors in `convex/bridge-chaos.test.ts`, `convex/bridgeSync.test.ts`, `convex/replicas.test.ts`, and `artifact-card.tsx`. Therefore the new finalizer itself is verified by real `convex-test`; screenshots `24`–`26` exercise the new runtime recovery against the deliberately old backend fault.
- Duplicate-title ambiguity, network loss, Bridge kill, confirm/reject, authority, Follow-on/input-disengage/reduced-motion, Stop, Undo, and final document grading were not run after F2 triggered the R17 stop. They remain P4.V1 continuation work and are not claimed.

## Continuation (implementer, 2026-08-28)

Status remains **REJECTED** until an independent verifier re-grades. Sequence continues `27`–`45` in this directory.

7. `27-workspace-before-dock.png`–`31-dock-overflow-menu.png`: F4 repair. Tabs are 280px (min 240 / max 320) with Follow + More; conversation and Close live in shared OverflowMenu; the fourth tab is reachable by scrolling. Stop/Retry stay immediate when a run is active (`39`).
8. `32-follow-on.png`–`34-follow-reduced-motion.png`: Follow pressed, window click on Titration disengaged Follow, `prefers-reduced-motion` yielded tab animation `none` / duration `0s`.
9. `35`–`38`: duplicate-title prompt for two `P4V1 Pendulum Method Guide` documents produced a Needs-input rail (General copy / Other copy / Skip). An earlier attempt died on collab gateway 1006 (`37`).
10. `39`–`40`: append-to-Lifecycle-Proof showed Stop, then `AI_ARTIFACT_CONNECTION_CLOSED` (gateway close 1006). No Undo snapshot.
11. `41`–`42`: settings change paused for confirmation; Reject left Cancelled / “No proposed changes were applied.”
12. `43`–`44`: browser offline mid-ping; after restore and reload the Dock showed `Pong Reply` / `pong`.
13. `45`: Method Guide thread from the original paused document create (F1). Fresh live document/12-slide grading was not completed because artifact applies could not sync.

Bridge interruption was not run (live OneDrive Physics). P6.I1/I2 were not patched. Focused Vitest 6 files / 73 tests; `tsc` no longer names `authority.ts` or `runtime.ts`.

## Independent verifier re-grade (2026-08-28)

Status remains **REJECTED**. Sequence continues `47`–`77`.

14. `47`–`49`: F4 Dock density re-grade. Tabs 280px (min 240 / max 320); Follow + Stop/Retry immediate; overflow for conversation/Undo/Close.
15. `50`–`62`: live 12-slide V3. Quality engine **85/100, 0 blockers** on saved artifact `q57b3tfqbv13yv4a5nzp5kg5598da7a8` (`v3-quality-report.json`). Dock still showed Recovery exhausted after undeployed F1 finalizer.
16. `63`–`68`: Method Guide V4 false-failed on "do not cite" → source metadata. Rubric repaired; V5 `q576aaaszgq2a1g3115denn43n8dbar1` scored **100/100** (`v5-quality-report.json`). Same Convex finalize miss after save.
17. `69`–`72`: live Undo. Marker landed on Draft; overflow offered Undo this run; toast **Could not undo this run** (`changeGroups:revertPlanForRun` missing on live Convex). Marker remains.
18. `73`–`77`: archive confirm. Archive it / Keep it / Skip; Keep it left V5 `active`.

Bridge skipped. P6.I1/I2 untouched. Focused Vitest 3 files / 39 tests this VU.

## Remainder verifier (2026-08-28)

Status: **VERIFIED**. Sequence continues `78`–`95`.

19. `78`–`79`: honest Convex deploy (`--typecheck=enable`). Live spec has `changeGroups:revertPlanForRun` and `spectraArtifacts:finalizePendingLive`.
20. `80`–`85`: remainder marker `UNDO-MARK-P4V1-REMAINDER-92828` appended; overflow Undo; 409 because restore still claimed as AI with a synthetic operation id. Marker remained.
21. `86`–`88`: stale Next still served the old apply path; Next relaunched onto the human-claim restore.
22. `89`–`92`: Undo this run POST 200; toast **Restored the earlier copy of this work.** Remainder marker gone; `UNDO-MARK-P4V1-8841` kept.
23. `93`–`95`: create `P4V1 Finalizer Probe` / `FINALIZER-PROBE-8821` finalized; Dock completed; no F1 “no longer editable” miss.

Bridge skipped (Physics mounted). P6.I1/I2 untouched. Focused Vitest 4 files / 48 tests.
