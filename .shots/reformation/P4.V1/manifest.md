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
