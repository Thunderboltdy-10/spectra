# P12 — Artifact Depth

**Goal:** every artifact type reaches the depth the Office trio already has — the "hundreds of options" treatment, delivered the only legal way: through the capability IR (CANON R6, R26). Each type gets a named-industry-leader capability inventory first, then closes it: every capability a real user of the leader product would miss either **works** or **refuses honestly** (R7). One worktree per type, all parallel.

**Prerequisites:** none hard — the IR, conformance suites, and shared workbar system exist (P3, P6.I2). Units rebase over the current track's merges per the merge queue. **Architecture:** ARCHITECTURE-CAPABILITIES; the workbar-artifact-capability contract (`docs/spectra-nova/workbar-artifact-capability/`); EXPANSION §7. **Findings absorbed:** current IR census (document 103 / sheets 111 / presentation 118 capabilities vs quiz 23, flashcards 26, whiteboard 28, code 17, planner 17, agent 7); the standing narrow-width workbar coherence finding (STATE §1 2026-08-30) — new capabilities must land inside the responsive workbar grading, not degrade it.

**Difficulty (PROCESS §4):** I1–I4 = Hard / xhigh. I5–I7 = MT / xhigh. V1, V2 = Hard / **max**.

**Standing unit shape (every depth unit, in order):**

1. **Inventory first (R26):** write/refresh `docs/spectra-nova/workbar-artifact-capability/<TYPE>-CAPABILITY-INVENTORY.md` against the named leaders — feature-by-feature, each row marked ship / refuse-honestly / defer-with-owner. The inventory is the unit's contract; depth without an inventory is slop.
2. Implement as `CapabilityDefinition`s in a **new per-type file** `src/features/spectra/capabilities/studio-<type>.ts` (registered in `catalog.ts` via merge queue — do not grow `studios.ts`), plus studio handlers, workbar bindings, `COMMAND_TABS` rows, and schema migrations (bump `currentVersion` with migration, never fork).
3. Update the type's AI skill (`artifacts/skills/<type>.ts`) and manifest `operations` so the AI plane gains the same depth the workbar gains (C2 symmetry).
4. Conformance: ghost gate green, `capability-conformance` + work-kernel suites extended, keyboard + overflow behavior graded at narrow width.

Ownership per unit: `components/<type>-studio.tsx`, `capabilities/studio-<type>.ts`, `artifacts/schema/<type>.ts`, `artifacts/skills/<type>.ts`, type-specific model/ops dirs. Shared files are merge-queue-managed.

## P12.I1 — Quiz depth (H) — leaders: Kahoot, Google Forms, Canvas quizzes

Question-type depth (matching, ordering, numeric with tolerance, hotspot, multi-part), question banks + pools, shuffling, per-question/whole-quiz timers, points/partial credit/penalties, feedback per answer, attempt limits + review policies, accessibility of attempt mode, results/analytics view for cohorts.

## P12.I2 — Flashcards depth (H) — leaders: Anki, Quizlet

A real SRS scheduler (FSRS-family, parameterized per deck) replacing/upgrading study heuristics; deck options presets; cloze depth (multi-cloze, hints); image occlusion polish; nested decks/tags; leech handling; study statistics (retention, forecast, heatmap); bulk edit; the P11.I5 import/export capabilities exposed as IR operations.

### P12.I2 implementation log — 2026-08-31

- Inventory: the Anki/Quizlet comparison closes with 63 registered Flashcards capabilities and records that count as the standing IR baseline.
- Added a version-4 deck model and migration with nested decks/tags, multi-cloze hints, image occlusion, bidirectional cards, scheduler options, and private study-state separation.
- Replaced the study heuristic with a parameterized FSRS-family scheduler, deck presets, learning/relearning steps, bury/suspend/reschedule/reset/undo controls, and leech handling.
- Added private retention, forecast, heatmap, and leech analytics; study mutations refresh those views and distinguish saved mutations from refresh failures.
- Added bulk editing plus preview/commit imports and CSV, TSV, portable-package, and print exports through shared operations.
- Registered the per-type capability IR directly in the catalog, projected it through the workbar, and extended the manifest and Flashcards AI skill with matching operation families.
- Regression coverage spans scheduler transitions, migration and normalization, operations, content isolation, IR projection, conformance, and work-type passes.
- Evidence: focused Vitest 5 files / 72 tests; TypeScript; capability ghost gate; secret scan; scoped ESLint with zero errors; diff checks.
- No live server, browser, Convex, Bridge, Office, or cloud resources were used.
- Status: IMPLEMENTED only. P12.V1 remains an independent verification unit; no acceptance claimed.

## P12.I3 — Whiteboard depth (H) — leaders: Miro, FigJam, Excalidraw

Shape library depth + connectors that stay attached, frames/sections, sticky notes + voting, laser/pointer presence polish, alignment/distribution/snapping, locking/grouping depth, templates, minimap/navigation at scale (virtualize past `virtualizeAfter`), export (PNG/SVG per frame).

## P12.I4 — Code depth (H) — leaders: VS Code, Replit, Jupyter

Runtime depth (package management story for the Python runtime, honest limits declared), debugging affordances (breakpoint-free stepping or output tracing — inventory decides what is real vs refused), multi-file project polish, notebook-style cell execution mode (inventory decides ship/defer), formatter/linter integration, richer visualization outputs, shareable run results.

### P12.I4 implementation log — 2026-08-31

- Inventory closed against VS Code, Replit, and JupyterLab: 54 Code IR definitions, up from 17; every row ships, refuses with exact guidance, or names the GitHub connector owner.
- Code capabilities now live in `capabilities/studio-code.ts`; the legacy multi-studio catalog no longer owns Code definitions.
- Shipped safe multi-file create, rename, duplicate, entry selection, delete, and bounded path/source search through one shared studio dispatcher.
- Shipped explicit local Python package selection for the six pinned Pyodide packages; arbitrary installs, scripts, terminals, servers, and remote kernels refuse honestly.
- Shipped source-native `# %%` cell discovery and current-cell execution with line-preserving traceback source; rich Jupyter state and fidelity export remain explicit refusals.
- Shipped bounded, redacted run reports with lifecycle, fingerprint, output, problems, and checks; reports copy as Markdown or download as JSON and never enter published source payloads.
- Code schema is v2 with a source-preserving v1 migration for package, notebook, and report fields; collaboration regions include each new durable surface.
- Live and published Python execution receive approved package declarations; published payload validation rejects unknown packages and invalid notebook settings.
- Human workbar, chrome, panel tabs, and scoped keyboard entry points converge on the same Code operation dispatcher; shared narrow overflow retains every action.
- Focused Vitest: 6 files / 46 tests PASS. Root TypeScript PASS. Scoped ESLint: 0 errors; pre-existing Code/design-token warning census unchanged.
- `check:capabilities`, `check:secrets`, and `git diff --check` PASS. No browser, dev server, Convex, Bridge, Office, cloud resource, or primary checkout was used.
- Independent verifier: run P12.V2; grade the inventory walk, exact refusals, source-cell behavior, package containment, report privacy, AI symmetry, and narrow-width reachability.

## P12.I5 — Planner depth (MT) — leaders: Todoist, Notion, Linear

Recurring tasks, subtasks/checklists, natural-language due entry, priorities/labels, filters + saved views (list/board/timeline parity), workload view over calendar integration (single temporal truth — reads `calendarItems`, never a second store), reminders leveraging the P9.I2 schedule-at-write machinery, bulk operations.

## P12.I6 — Agent Foundry + timetable/calendar studio depth (MT)

Foundry: evaluation-run UX depth, release comparison, skill authoring ergonomics, routing-transparency view (why this agent was chosen). Timetable/calendar: the studio-level polish that P13.I3's pipeline needs to land well — layer management, overlay editing, recurrence editing UI, print/export. Coordinate with P13.I3 through the merge queue (calendar seam is theirs; studio chrome is this unit's).

## P12.I7 — Office trio gap re-audit (MT)

Re-run the document/sheets/presentation inventories against their post-P3 state (the existing inventories predate the IR migration): close what P2.I3's R7 refusal list left honestly refusable but is now cheaply shippable; re-verify each remaining refusal still reads truthfully; file genuinely-large items (tracked changes UI, pivot tables) as Field Notes with owners rather than silently re-deferring.

### P12.I7 implementation log — 2026-08-31

- Re-audited against Microsoft Word, Excel, and PowerPoint; the 2026-08-22 inventories are retained only as explicitly superseded archaeology.
- Standing IR census: Document 103 = 39 writers / 46 honest refusals / 18 UI-only; Sheets 111 = 42 / 42 / 27; Presentation 118 = 16 / 66 / 36.
- Promoted PowerPoint hidden-slide state through one `set-slide-hidden` delta using the native slide visibility flag; only the selected slide part changes.
- Removed the stale speaker-notes studio gate; the existing lens creates a native notes page and master when absent.
- Hidden state now survives PPTX projection, editor/Yjs projection, native materialization, reopen, and three-way merge.
- No-delta Office capabilities now keep their exact IR-owned refusal instead of collapsing to a generic preserved-region sentence.
- Rewrote all Office refusal families as specific, punctuation-complete human guidance with a next action; row/column, duplicate-row, equation, and multi-object geometry families are distinct.
- Added exhaustive human/AI refusal parity coverage plus focused hidden-slide and notes promotion tests.
- Focused Vitest: 8 files / 124 tests PASS; seam contract: 13/13 PASS; PPTX command fixtures: 20 assertions / 0 failures.
- TypeScript, capability ghost gate, secret scan, and `git diff --check` PASS; scoped ESLint has 0 errors and the existing 11 design-token warnings.
- Aggregate DOCX/Office scripts were run and reproduce recorded unrelated baseline blockers: DOCX wrapper move/delete refusal and XLSX paste-values error-code drift; no lens expectation was weakened.
- Filed Word Review/Structure/Rich Objects/Automation, Excel Analytical Objects/Package Writer/Structural Rewrite/External Data, and PowerPoint Rich Objects/Motion/Structure/Shape Tree/Advanced Objects Field Notes with orchestrator-owned future units.
- No browser, dev server, Convex, Bridge, Office application, cloud resource, lease, or primary checkout was used; P12.V2 owns independent live grading.

## P12.V1 — Depth verification wave 1 (H, max) — verifies I1–I3

Fresh agent, local instance. Per type: inventory-vs-product walk (every "ship" row demonstrated, every "refuse" row showing its sentence), L3 authoring + consumption journeys (author a quiz → cohort attempt → review; build a deck → study cycle with SRS state advancing across days via clock control; facilitate a board session), AI-plane symmetry spot-checks (the AI can drive a sample of each new capability family), conformance + ghost gates, narrow-width workbar grading.

## P12.V2 — Depth verification wave 2 (H, max) — verifies I4–I7

Same protocol for code/planner/agent/timetable + the Office re-audit closures. Budget re-check against P9 baselines (depth must not regress studio open cost).

## Exit gate

All seven inventories exist and are closed (ship/refuse/defer-with-owner — zero silent gaps); ghost gate green across the grown catalog; both VUs PASS; Pablo pass. The IR census in each inventory header records the new per-type capability counts as the standing baseline.
