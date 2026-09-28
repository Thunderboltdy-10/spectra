# P8.V1 release matrix

This matrix is a covering program, not a list of isolated feature demos. Every
card combines at least two systems and records the user's goal, the transitions
observed, the truth readback, the feel, and the cost. Run it in order because
later cards assume the candidate survived earlier truth checks.

Status for every card lives in `.shots/reformation/P8.V1/run-state.json`.
`pending`, `running`, `passed`, `failed`, and `blocked` are the only values.
A failed card stays failed until the class-wide repair and all named consumer
cards pass on a rebuilt production candidate.

## Invariants across every card

1. No user-visible success precedes durable truth.
2. Every entered non-terminal state exits to success, an actionable failure, or
   an explicit resting state within its stated bound.
3. User input always ends Follow AI immediately. Background AI never steals the
   viewport when Follow is off.
4. Human, AI, keyboard, context-menu, and workbar operations share the same
   availability and authority decision.
5. A disconnected person, Bridge, gateway, or provider cannot make another
   healthy subsystem pretend the work disappeared.
6. Replay is idempotent. Recovery never duplicates an operation, class shelf,
   invitation, artifact, update, or file write.
7. Every surface uses Spectra's components, tokens, spacing, type, layers,
   motion grammar, and plain-language state vocabulary.
8. Every user action is discoverable without implementation hints. A verifier
   may know the goal card, never the click sequence.
9. Cost is part of behavior: actions and idle periods remain inside the P8
   budgets in ARCHITECTURE-PLATFORM section 4.

## Perceptual-seam protocol

Run this protocol at every visual checkpoint, not only during the copy sweep:

1. Capture the complete viewport before inspecting a component. Mark the
   content rectangle, shell chrome, active work, auxiliary panes, composer/Dock
   band, fixed overlays, and the last readable content.
2. Record the literal observation before proposing a fix. Then name what a
   person loses: reading, orientation, control ownership, confidence, focus, or
   access to an action.
3. Measure geometry with `perception-audit.mjs`: bottom occlusion at maximum
   scroll, shared baselines, clipped/overflowing controls, corner action
   clusters, pane overlap/blur, target-to-highlight area, focusability, and
   type/style histograms.
4. Trace the measurement to the shared allocator, safe-area publisher, state
   presenter, operation IR, or rendering adapter. Search every direct and
   indirect consumer before editing. A screenshot selector or per-studio
   padding value is not a class repair.
5. Capture the same full-frame state after the repair at 1920, 1440, 1280,
   1024, 200% zoom, both themes, and reduced motion where state changes move.
   Compare the work that remains readable, not merely the color of the repaired
   element.

A screenshot passes only when task, state, recoverability, geometry, hierarchy,
typography, copy, and calmness agree. Visual polish cannot hide a truth failure,
and functional success cannot excuse an unusable viewport.

## Stage A: candidate and non-repetition

### A0 - exact candidate

Record clean commit, production build ID/hash, local instance, profiles, service
readiness, Bridge data directory, and sacrificial paths. Prove the browser is on
the production build and local Convex. Fail on a dev server, dirty candidate,
wrong instance, stale build, missing gateway, or unowned mount.

### A1 - RC inheritance

Read the RC closeout note and evidence. Add its three carryovers to the current
ledger. Explicitly record the RC cards skipped by deduplication. This is a pass
when the verifier can name what will not be repeated and why.

Consumer reruns after repair: A0 always; A1 only when the repair reaches an RC
truth/fidelity seam.

## Stage B: first hour and onboarding

### B0 - reusable new-person state

Create a new disposable local instance from the existing credential template,
not from an existing database. Use the real sign-in and invitation/school saga
with the same saved credentials. Do not reset another instance. Stop and keep
the instance after the card so a later agent can inspect it.

Expected: before product choices, the account projection contains no copied
Library state, class shelves, preferences, Bridge pair, or collaboration cache.
Auth identity may be the same Clerk person; Spectra state must be new.

### B1 - first useful session

Goal card: “Set up Spectra for this school year, keep only the classes you use,
and get to a useful workspace.”

- Experience sign-in, invitation acceptance, first product load, and any
  loading/error/empty state without implementation hints.
- Resolve the signed-in person's ManageBac identity through the existing secure
  path. A provider failure must leave the core workspace usable.
- Select a small non-contiguous subset from a noisy class list, including a
  similarly named old/current pair. Search and keyboard selection must work.
- Double-submit once and hard reload once. Exactly one shelf per chosen class,
  none for unchosen classes, with user-facing names only.
- Record how many decisions, screens, paragraphs, and seconds it took to reach
  useful work. Flag any screen that teaches architecture instead of helping.

Required variants: no ManageBac connection, identity unresolved, zero classes,
partial/degraded sync, 50+ candidates, stale candidate, and interrupted submit.
The variants may use controlled provider fixtures; they never bypass the
production route or write raw database rows.

### B2 - change your mind later

From both School and ManageBac, locate the class choice without relying on the
onboarding entry point. Add one class, remove one generated shelf, and verify
the shelf's existing work moves to General rather than being deleted. Disconnect
and reconnect ManageBac; personal overlays and unrelated work survive.

### B3 - settings round trip

Change every preference the onboarding asks, then find and reverse it in
Settings. Exercise system/light/dark, interface/editor text size, reduced
motion, and any notification/AI choice that actually ships. Reload in a second
tab and verify the canonical merge result. No onboarding-only storage, zombie
choice, silent revert, or whole-section overwrite.

### B4 - first-session perception

At 1920, 1440, 1280, 1024, and 200% zoom, capture first load, class choice,
first Library, and first work open in light, dark, and reduced motion. Grade
hierarchy, type consistency, focus, reading order, empty/error states, control
density, copy, and whether the next action is visually obvious. Mobile is out of
scope; sub-`md` is not a launch claim.

Consumer reruns after repair: B1 always; B2 for ManageBac/tree changes; B3 for
preference changes; B4 for every visible change.

## Stage C: ordinary work before chaos

### C0 - navigation and discoverability loop

Starting from Library, move through a workspace, Calendar, School, ManageBac,
Settings, Files and devices, notifications, and back with browser Back/Forward.
Open and close work between route changes. At every surface answer: where am I,
what is primary, what changed, how do I leave, and what would a first-time user
try next? The route, selected nav, open-work rail, Dock, and composer context
must agree.

### C1 - artifact world sampling

Create and perform the defining edit for all nine creatable blueprints:
document, sheets, presentation, quiz, flashcards, code/visualization,
whiteboard, planner task, and agent. Also open a PDF/image/unknown resource and
an existing thread. Do not exhaustively retest Office fidelity; test reachability,
basic edit/save/reload/close, workbar consistency, errors, and truthful refusal.
Legacy timetable is not creatable.

### C2 - open, close, focus, and field

Open work from List, Board, search, a share, an AI result, and a deep link.
For clean and dirty artifacts, close with the header, tab rail, Escape, and
browser navigation. Confirm one close action, one save, one removed URL target,
focus return, no resurrection on reload, and a visible active/open field effect
that disappears when work closes. Force a save failure and prove there is a
door to retry, discard where safe, or stay.

### C3 - workbar under pressure

At normal and narrow split widths, verify the common workbar grammar across the
nine studios. Essential enabled controls remain immediate; honest disabled
controls keep their reason; overflow ordering is meaningful; customization and
keyboard paths do not fork behavior. Combine with an open thread, Dock tabs,
comments, and a required-input card to expose layout collisions.

Consumer reruns after repair: the failed blueprint plus C0/C2; C3 for any shared
chrome, operation IR, or layout repair.

### C4 - whole-viewport geometry

Open a long document, Sheets, presentation, PDF/resource, whiteboard, and code
work at each supported width. Scroll each real content owner to its final item
while the Dock/composer is expanded, collapsed, streaming, asking for input,
and holding many tabs. The final content must clear the published bottom band;
no overlay may make the ending unreachable. Open comments, thread/run, embeds,
and inspector combinations. Each auxiliary pane must either receive a shared
width allocation or intentionally promote to a named overlay while preserving
a usable, unblurred work area and an obvious exit.

Measure the row below Workspace for baseline spread, child overflow, label
collapse, and action order. Measure top-right clusters for duplicate or
competing intents. Inspect claim, gate, selection, conflict, and active-work
effects: an effect may identify its target, never wash a large unrelated area.

### C5 - simple-style canary

In DOCX, XLSX, PPTX, quiz, and flashcards, apply and remove font family, size,
bold, italic, underline, and one color where the capability is offered. Read
back the semantic model, rendered computed style, workbar selected/value state,
durable reload, and native package for the three linked formats. Use
`style-fidelity.mjs` after selecting the styled region. A visible control with
no rendered effect, a rendered effect with the wrong control state, or a
projection/package mismatch fails the whole style class and triggers sibling
search for more complex formatting.

Consumer reruns after a geometry repair: C0, C2-C4, the affected studios, and
B4. After a formatting repair: C1, C3, C5, and only the RC format seams reached
by the change.

## Stage D: four actors in one living workspace

The actors are A, B, AI-1, and AI-2. Use one shared document or whiteboard with
stable, visible regions, plus one second artifact in another workspace. Give
every actor a unique marker and record durable attribution.

### D0 - two people, two AIs, same region

A and B edit the same region while AI-1 proposes a structured edit there and
AI-2 works in the second artifact. Verify presence identity, claims, conflict or
merge truth, authorship, and final content from both profiles after hard reload.
No actor's marker silently replaces another's. Stop, retry, and run-level Undo
operate on the named run and no other work.

### D1 - Follow AI route crossing

A follows AI-1 as it moves from Library to the first artifact and then the
second. AI-2 and B continue moving elsewhere. Only AI-1 controls A's viewport.
A scrolls, types, clicks Library, and changes a setting in separate trials;
each input ends Follow immediately and AI continues in the background without
returning the viewport. Re-enable Follow and use Stop explicitly. Reduced motion
uses instant state changes without removing state feedback.

Use `scripts/playwright/follow-disengage.mjs` for the input-disengagement
measurement after first reaching a real active run.

### D2 - a person leaves

While A, B, and both AIs are active, close B's tab, revoke B's access, then
restore a permitted share. Presence exits once, A and AI work continue, B sees
an honest unavailable/revoked state, and no shared work is deleted. An expired
share link and a declined invitation are distinct from deleted work.

### D3 - Bridge state changes during collaboration

On a sacrificial linked file, edit with A/B and one AI while the Bridge is
healthy. Stop the Bridge before the native write, continue with non-local work,
navigate away, then restart it. The product says what is queued and where the
file lives; recovery writes once and verifies bytes before saying current. Turn
the mount read-only and confirm all input paths share the refusal.

Consumer reruns after repair: D0-D3 as a group for collaboration/follow/claim
changes; only D3 plus RC carryover T0 for a Bridge-only repair.

## Stage E: composed failure and recovery

Each fault is introduced at the worst transition, not at an idle screen. Capture
before, intermediate, timeout boundary, recovered state, and fresh readback.

| Card | Sequence | Required recovery |
| --- | --- | --- |
| E0 | gateway kill during A/B/AI same-region write | local edits stay durable; reconnect once; no duplicate update or false saved label |
| E1 | browser crash after durable ack but before visible settle | reopen from IndexedDB/server truth; no missing or duplicated edit |
| E2 | browser network partition during AI run and manual edit | product-wide Offline; local input remains usable where promised; queued truth and clean resume |
| E3 | Convex latency/failure during save, invitation, preference, and class materialization | bounded waiting; one retry path; idempotent replay; no fake empty world |
| E4 | failed collaboration checkpoint followed by gateway restart | update log replays once; projection catches up; other rooms unaffected |
| E5 | stale token during run and websocket reconnect | reauthorize or sign-in door; no raw token/Request ID; no cross-account storage leak |
| E6 | permission downgrade during AI confirmation and human edit | pending action rechecks authority; prohibited write never lands; audit is durable |
| E7 | device revoke during pending native write | claim fails truthfully; state exits pending; browser/Bridge both lose authority |
| E8 | Office lock, external save, then queued Spectra write | wait or conflict, never overwrite; stable final region identities and bytes |
| E9 | stop services and restart clean | journals, updates, scheduled work, and UI recover without reinstall or database surgery |

### E10 - independent recovery systems composed

Run one compound chain: D0 → Follow AI → navigate to Settings → gateway kill →
manual edit → Bridge kill → browser offline → reconnect network → restart
gateway → restart Bridge → stop one AI → revoke B → hard reload A and B. The
point is not more failures; it is proving independent recovery systems do not
fight each other.

## Stage F: cost, performance, endurance, and scale

### F0 - Convex baseline windows

Capture, separately:

- five minutes with the signed-in Library truly idle;
- five minutes with one idle collaborative artifact and a healthy gateway;
- first paint for each primary surface;
- one representative action per feature family;
- one AI run, one class materialization, one Bridge discovery/write, and one
  clean restart;
- enough time to include every scheduled function at least twice.

Aggregate by function and caller with `scripts/convex-window.mjs`. Record cached
and uncached executions, return bytes, database I/O, documents, storage, egress,
execution time, and Node memory. Compare the historical top offenders in
CONTEXT.md to current measured truth. A repaired offender is not closed merely
because another function became the largest.

### F1 - frontend action budgets

Use the observer and checkpoint scripts around first paint, opening each dense
artifact, a keystroke burst, a Sheets commit, a deck drag, a peer cursor burst,
and Dock activity. Record request count/size, long tasks, layout shifts,
animations, websocket frames, errors, and failed requests. The budgets in
ARCHITECTURE-PLATFORM are gates.

### F2 - scale without feature repetition

Use the existing 10k Library, 40-page document, 200k-cell workbook, 120-slide
deck, and many-Dock-tab fixtures. Measure first useful paint, input latency,
scroll/drag feel, memory, main-thread work, and recovery after leaving/reopening.
This is a performance card, not a second Office feature inventory.

### F3 - endurance

Run a realistic multi-hour session containing work, idle, navigation, AI,
presence, Bridge, sleep/wake, and reconnect intervals. Sample browser/Bridge/
gateway/Convex memory, handles, timers, IndexedDB, update logs, and function
usage at fixed checkpoints. Growth must flatten or be explained by retained
user work. No unbounded animation loop, cache, snapshot, or log.

The unchanged P5.V1 classroom soak is inherited. Rerun it only if a P8 repair
touches collaboration transport, persistence, checkpointing, compaction, or
presence performance.

## Stage G: copy, accessibility, security, and privacy

### G0 - perception and copy sweep

Run the perception audit on every unique shell/state, then inspect every flagged
string in context. Rewrite robotic or implementation-facing copy through shared
humanizers and shared components. A person should see what happened and what to
do, not provider IDs, record types, enums, capability mechanics, stack traces,
or internal certainty language. Prefer visible state and visual cues over
paragraphs and toast chains.

### G1 - keyboard, zoom, contrast, motion

Complete every core journey using keyboard only. Verify logical focus order,
visible focus, dialog trap/return, named icon controls, non-color state,
live-region restraint, 200% zoom, light/dark AA contrast, text-size settings,
and reduced motion. Test error, empty, loading, disabled, confirmation, and
success states, not only the populated default.

### G2 - authorization and privacy

Run the school/account/artifact/room/payload authorization matrix; expired and
revoked URLs/tokens; cross-account browser-storage cleanup; sandbox network
boundaries; secret scan; signed URL lifetime; audit visibility without private
content exposure; and operator read-only/write sessions. Any role change is
checked again at mutation time.

### G3 - connector architecture paper exercise

Map a hypothetical Google Docs connector to one lens, capability mapping, and
sync policy. It passes only if no editor, AI tool, choreography, or workbar code
would need a connector-specific branch. This is an architecture review, not a
connector implementation.

## Stage T: RC carryovers only

### T0 - xlsx-run3 native completion

Starting from the exact RC xlsx-run3 sacrificial file and recorded semantic
state, prove the pending Bridge `file.write`, read-back-verified hash, Excel COM
package readback, retained B1/Y1/D4, and formula/untouched-part preservation.
Do not repeat initial render, formula inventory, workbar inventory, or Keep
Excel semantic durability unless a repair touches those seams.

### T1 - original-tree integrity

Read-only hash the original IBDP1 tree before and after every native test block.
Never mount or edit it. Record locked/unreadable files separately and compare
every readable common file. The known live `Maths EE 4.docx` lock is user work,
not a file to close or revert. Integrity cannot be inferred from total bytes.
Use `scripts/tree-integrity.mjs`; its output path must be outside the source
tree and its comparison must remain green for every readable common file.

### T2 - PPTX R2 exit

Open the exact RC deck state that showed `Updating presentation content.` and
record state transitions until a documented bound. It must leave updating for
ready or an actionable failure. Then close/reopen once. Do not repeat the slide,
notes, AI, PowerPoint, or workbar cards unless the repair reaches them.

## Stage Z: final gate and verdict

### Z0 - clean final candidate

From stopped processes, rebuild the exact final commit and start the production
local composition. Run one representative B, C, D, E, F, G, and T card without
repairing between them. All readiness, state, cost, and integrity checks pass.

### Z1 - full machine floor

Run full Vitest, typecheck, production build, zero-warning lint,
architecture/copy/capability/token/secret gates, DOCX/Office/seam fidelity,
Bridge tests/build, local-stack/foundation tests, and any focused suites added
by P8 repairs. A test failure is a product/gate failure; tests are never weakened.

### Z2 - terminal release verdict

Write the verdict into the P8.V1 manifest and STATE row against the exact commit
and build. GO requires every card passed, no launch blocker, budgets met,
rollback/incident paths exercised, and open risks named with severity and owner.
NO-GO names the failed cards and remains active P8.V1 work. There is no later
verdict unit and no acceptance ceremony.
