# P8.V1 final verification

P8.V1 is the terminal Spectra Reformation unit. It is one serial, resumable
verifier program: discover a failure, classify it, repair the whole class when
it is holdable, rebuild the production candidate, rerun the affected journeys,
and finally record GO or NO-GO. There are no P8 implementation lanes and no
second verdict unit.

This folder is the verifier's working manual. It does not replace the governing
documents above it.

The reusable probes in `scripts/` are source-controlled. Browser profiles,
Playwright CLI config/session files, traces, recordings, storage states, and
`.shots/` evidence are runtime output and are ignored by the repository; never
force-add them to the launch commit.

## Mandatory read order

At the start of every session, and again after conversation compaction, read:

1. `../README.md`
2. `../CANON.md`
3. `../STATE.md` section 0, the P8.V1 row, and all open P8.V1 Field Notes
4. `../PROCESS.md`
5. `../phases/P8-release-gate.md`, including the logs
6. all five `../ARCHITECTURE-*.md` files, then `../PRODUCT.md` and
   `../VERIFICATION.md`
7. the cited finding families in `../../../SPECTRA-ISSUE-COMPENDIUM.md`
8. this folder in order: `CONTEXT.md`, `MATRIX.md`, `EXECUTION.md`,
   `EVIDENCE.md`, then `PROMPT.md`
9. every script in `scripts/` before running it

Current code and live behavior remain the field truth. If a binding rule is
wrong in the field, stop and ask Pablo rather than editing the rule around the
product.

## What is already proven

RC.V1 is VERIFIED. Do not rerun its DOCX, XLSX, or PPTX feature inventories or
its already-green Office round trips. P8.V1 inherits only three explicit
carryovers:

- the xlsx-run3 Bridge `file.write` and Excel package readback hash;
- a read-only before/after integrity card for the original IBDP1 tree, treating
  the locked `Maths EE 4.docx` as live user work and never reverting it;
- a bounded exit for PPTX `Updating presentation content.`

P5.V1 already proved the 30-client/65-minute collaboration floor. P8.V1 does
not repeat that unchanged soak. It reruns it only after a collaboration repair
whose blast radius reaches the load path, and otherwise runs the combined
four-actor and failure cards in `MATRIX.md`.

## Known launch contracts that are not yet proved

- A new signed-in person has no first-run product setup today. The current
  Library only changes its empty-list presentation.
- ManageBac already exposes authenticated class candidates and class-workspace
  materialization in `convex/managebac.ts`, but no user-facing surface calls
  those endpoints. P8.V1 must add one selection flow, not a parallel model.
- Class selection must be available again from School or ManageBac. Removing a
  class shelf must preserve its work by moving it to General.
- Every other choice made during onboarding must be editable from Settings.
  The preference schema is broader than the sections currently rendered.
- The attached Convex usage evidence shows launch-disqualifying historical
  cost concentration. P8.V1 must measure the current candidate from function
  logs before deciding what remains, then close every budget breach class-wide.
- R13 copy remains open: technical and robotic phrases, including raw mutation
  errors and integration vocabulary, must be judged in the actual journeys.

These are owned requirements, not pre-written implementation instructions. A
verifier still inspects the live product first and captures the required visual
reference before changing a visible surface.

## Start or resume

Use the next unused local instance for destructive-to-test-state journeys. This
preserves every prior local Convex database:

```powershell
node docs/spectra-reformation/final-verification/scripts/fresh-instance.mjs plan
node docs/spectra-reformation/final-verification/scripts/fresh-instance.mjs create --source-instance 1
```

After the chosen production stack is ready, initialize the evidence ledger:

```powershell
node docs/spectra-reformation/final-verification/scripts/run-state.mjs prepare --instance <N>
node docs/spectra-reformation/final-verification/scripts/run-state.mjs doctor --instance <N>
```

`prepare` is idempotent and never overwrites completed cards. `doctor` is
read-only. Use the same ledger when another agent continues the unit.

## Supplied probes

- `run-state.mjs`: prepare, inspect, and advance the resumable card ledger.
- `fresh-instance.mjs`: plan or scaffold a new empty local instance without
  copying/deleting a database.
- `convex-window.mjs`: capture privacy-safe usage windows and apply the P8
  action, idle, collaboration, or scheduled budget.
- `tree-integrity.mjs`: capture and compare a read-only SHA-256 manifest for
  the original IBDP1 tree, keeping locked/unreadable files explicit.
- `playwright/install-observers.mjs`, `reset-window.mjs`, and
  `checkpoint.mjs`: browser errors, requests, WebSocket volume, long tasks,
  layout shift, animations, metrics, and a numbered viewport.
- `playwright/perception-audit.mjs`: bottom occlusion, panel overlap, action
  competition, row alignment/overflow, effect area, type and accessible-name
  leads for full-frame human review.
- `playwright/style-fidelity.mjs`, `artifact-close.mjs`,
  `follow-disengage.mjs`, and `onboarding-contract.mjs`: prepared canaries for
  the specific high-risk journeys.
- `playwright/copy-audit.mjs` and `timed-sequence.mjs`: contextual language
  leads and timestamped intermediate states.
- `playwright/network-fault.mjs` and `clear-network-faults.mjs`: one explicit,
  scoped route fault at a time, with a mandatory cleanup path.

## Hard boundaries

- One agent and one checkout at a time. Two browser actors are test subjects,
  not parallel development lanes.
- Never mount or mutate `<local-workspace>`.
- Never reset or delete a local instance to replay onboarding. Allocate another
  disposable instance and stop it when finished.
- Never use production/cloud Convex as a substitute for the local composition.
- Never weaken a test, comparison, security boundary, or numeric budget.
- Never import P9-P15 feature chains. The ManageBac onboarding selection in
  this packet is a newly included launch entry flow, not the deferred grading
  and assignment product.
- A product repair invalidates the frozen build. Rebuild, record the new exact
  commit/build hash, then rerun every consumer card named by the finding.

The full repository sweep runs once, at the final P8.V1 gate, after all focused
repair checks and targeted journeys are green.
