# P8.V1 execution manual

P8.V1 is a serial release investigation that may span several agents while
remaining one unit, one ledger, and one candidate lineage. A verifier resumes
the next incomplete card; they do not restart the matrix or create a smaller
implementation unit.

## 1. Establish the candidate

1. Read the mandatory stack in README and inspect `git status`, the exact HEAD,
   STATE Field Notes, `.shots/reformation/P8.V1/`, and the existing ledger.
2. Run `fresh-instance.mjs plan`. Allocate a new instance only for a destructive-
   to-test-state or first-person card. Never reset an earlier instance.
3. Run `run-state.mjs prepare --instance <n>` and `doctor --instance <n>`.
4. Build and start production for that instance. Record `.next/BUILD_ID`, URLs,
   service readiness, profile names, and the exact sacrificial paths. A dirty
   tree or dev server may be used to diagnose, never to pass a card.
5. Read the RC closeout and mark A1 with the cards deliberately inherited. Do
   not repeat their green feature inventories.

## 2. Browser sessions

Use playwright-cli, not a hand-written browser driver. Account A and B are test
actors, not parallel development agents.

```powershell
playwright-cli -s=p8-a open --browser=chrome --profile=.playwright-cli/spectra-session http://localhost:<port>/workspace
playwright-cli -s=p8-b open --browser=chrome --profile=.playwright-cli/spectra-session-b http://localhost:<port>/workspace
playwright-cli -s=p8-a run-code --filename=docs/spectra-reformation/final-verification/scripts/playwright/install-observers.mjs
playwright-cli -s=p8-b run-code --filename=docs/spectra-reformation/final-verification/scripts/playwright/install-observers.mjs
```

Use semantic snapshots to discover each journey. The matrix gives a goal and
observable truth, never a locator sequence. Start trace before a failing or
time-sensitive transition; use video only when timing/motion cannot be conveyed
by numbered screenshots. Do not use `networkidle` as readiness.

Before a measurement window:

```powershell
playwright-cli -s=p8-a run-code --filename=docs/spectra-reformation/final-verification/scripts/playwright/reset-window.mjs
```

Set a safe checkpoint label in session storage, run `checkpoint.mjs`, then save
its returned JSON beside the screenshot. Run `perception-audit.mjs` at every
unique full-frame composition and `style-fidelity.mjs` on selected styled text.
Use `timed-sequence.mjs` for streaming, status exits, overlays, and motion where
one final screenshot would erase the failure. Run `copy-audit.mjs` after every
unique error, empty, warning, confirmation, and Settings state.

## 3. Run cards as sequences

For each card:

1. Mark it running. State the user's goal and expected invariant before acting.
2. Capture the starting full viewport and machine truth needed for readback.
3. Act through visible product controls. Introduce faults at the worst boundary,
   not before the task begins.
4. Capture intermediate, timeout, recovery, and hard-reload states. Screenshots
   alone do not prove persistence; pair them with the durable or native readback.
5. Record feel while it is fresh: what was hard to find, visually competing,
   occluded, robotic, noisy, or falsely reassuring.
6. Capture the browser metric window and bounded Convex window for the action.
7. Mark passed only when the expected truth and evidence files exist.

Use controlled route faults only after the happy path has reached the real
production route. Record every route and remove it after the card. Browser
offline, gateway/Bridge process stop, and Windows Office control are real faults;
clean up only the processes and routes created by the card.

For a scoped request failure, put the explicit URL pattern and mode in session
storage, run `network-fault.mjs`, perform one transition, then immediately run
`clear-network-faults.mjs`. The helper refuses the blanket `**/*` pattern so a
component failure cannot masquerade as a whole-browser partition.

## 4. Failure to repair loop

The first output from a failure is:

`[card] severity | observation | user consequence | LOCAL or SYSTEMIC: class |
suspected engine and sibling consumers | evidence`

Then inspect current code. Draw the read/write or layout ownership path before
editing. A holdable class is repaired inside P8.V1 even when it crosses many
files. Tests are added with the repair and first shown capable of failing. Never
bend a constant, timeout, comparison, accessibility assertion, or budget to pass.

For visible repairs, the failing screenshot is the before reference. Rebuild the
production candidate, recapture the same state, and run every consumer card named
in MATRIX. For truth repairs, replay the whole sequence from its initial durable
state. Append the repair and commit to the manifest; do not erase the failed run.

Only a class containing multiple independent seams that cannot be understood
safely in the current context is handed to another agent. It remains P8.V1. Put
the exact continuation prompt in PROMPT.md, mark the card blocked, commit the
foundation/evidence, and stop. The continuing verifier rereads everything and
resumes the same ledger.

## 5. Fresh-person loop

Onboarding iteration never requires deleting Convex:

1. create the next unused instance from instance 1's credential template;
2. run the real school/invitation bootstrap against that empty database;
3. sign in with the saved account A credentials on the new localhost origin;
4. experience onboarding, class choice, refresh, double submit, and Settings;
5. keep the instance for evidence, stop its processes, and allocate another for
   the next clean replay.

Provider variants may be simulated at the HTTP boundary, but the UI must still
use the production ManageBac route and mutations. Raw database seed rows are not
an onboarding test.

## 6. Cost windows

Run Convex windows separately so one action is not hidden by another:

```powershell
node docs/spectra-reformation/final-verification/scripts/convex-window.mjs --instance <n> --profile idle --seconds 300 --label idle-library
node docs/spectra-reformation/final-verification/scripts/convex-window.mjs --instance <n> --profile collaboration --seconds 300 --label idle-collaboration
node docs/spectra-reformation/final-verification/scripts/convex-window.mjs --instance <n> --profile action --seconds 60 --label <card-action>
node docs/spectra-reformation/final-verification/scripts/convex-window.mjs --instance <n> --profile scheduled --seconds 600 --label scheduled-floor
```

The script records usage only, never arguments or log lines. A budget breach is
a product finding. Trace the caller and lifecycle, then replace polling, scans,
or fat projections at their source; hiding a function from the report is gate
weakening.

For T1 original-tree integrity, write reports outside the tree being checked:

```powershell
node docs/spectra-reformation/final-verification/scripts/tree-integrity.mjs capture --root "<local-workspace>" --out ".shots/reformation/P8.V1/native/original-before.json"
node docs/spectra-reformation/final-verification/scripts/tree-integrity.mjs compare --root "<local-workspace>" --before ".shots/reformation/P8.V1/native/original-before.json" --out ".shots/reformation/P8.V1/native/original-after.json"
```

The probe never mounts, opens, edits, or writes inside the source tree. A locked
file is recorded as locked; a readable file that becomes inaccessible fails the
comparison instead of being silently counted as unchanged.

## 7. Final pass

After all focused repairs, stop every process created by P8, rebuild from clean
HEAD, and run Z0 without editing. Run the entire machine floor once at Z1. The
P8.V1 manifest is the release verdict: GO only when every required card and
budget is green, the evidence paths exist, the candidate hash matches, and no
launch blocker remains. Update STATE, append the phase log (30 lines maximum),
and make one coherent closeout commit.
