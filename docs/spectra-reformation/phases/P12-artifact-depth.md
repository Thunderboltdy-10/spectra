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

## P12.I3 — Whiteboard depth (H) — leaders: Miro, FigJam, Excalidraw

Shape library depth + connectors that stay attached, frames/sections, sticky notes + voting, laser/pointer presence polish, alignment/distribution/snapping, locking/grouping depth, templates, minimap/navigation at scale (virtualize past `virtualizeAfter`), export (PNG/SVG per frame).

## P12.I4 — Code depth (H) — leaders: VS Code, Replit, Jupyter

Runtime depth (package management story for the Python runtime, honest limits declared), debugging affordances (breakpoint-free stepping or output tracing — inventory decides what is real vs refused), multi-file project polish, notebook-style cell execution mode (inventory decides ship/defer), formatter/linter integration, richer visualization outputs, shareable run results.

## P12.I5 — Planner depth (MT) — leaders: Todoist, Notion, Linear

Recurring tasks, subtasks/checklists, natural-language due entry, priorities/labels, filters + saved views (list/board/timeline parity), workload view over calendar integration (single temporal truth — reads `calendarItems`, never a second store), reminders leveraging the P9.I2 schedule-at-write machinery, bulk operations.

## P12.I6 — Agent Foundry + timetable/calendar studio depth (MT)

Foundry: evaluation-run UX depth, release comparison, skill authoring ergonomics, routing-transparency view (why this agent was chosen). Timetable/calendar: the studio-level polish that P13.I3's pipeline needs to land well — layer management, overlay editing, recurrence editing UI, print/export. Coordinate with P13.I3 through the merge queue (calendar seam is theirs; studio chrome is this unit's).

## P12.I7 — Office trio gap re-audit (MT)

Re-run the document/sheets/presentation inventories against their post-P3 state (the existing inventories predate the IR migration): close what P2.I3's R7 refusal list left honestly refusable but is now cheaply shippable; re-verify each remaining refusal still reads truthfully; file genuinely-large items (tracked changes UI, pivot tables) as Field Notes with owners rather than silently re-deferring.

## P12.V1 — Depth verification wave 1 (H, max) — verifies I1–I3

Fresh agent, local instance. Per type: inventory-vs-product walk (every "ship" row demonstrated, every "refuse" row showing its sentence), L3 authoring + consumption journeys (author a quiz → cohort attempt → review; build a deck → study cycle with SRS state advancing across days via clock control; facilitate a board session), AI-plane symmetry spot-checks (the AI can drive a sample of each new capability family), conformance + ghost gates, narrow-width workbar grading.

## P12.V2 — Depth verification wave 2 (H, max) — verifies I4–I7

Same protocol for code/planner/agent/timetable + the Office re-audit closures. Budget re-check against P9 baselines (depth must not regress studio open cost).

## Exit gate

All seven inventories exist and are closed (ship/refuse/defer-with-owner — zero silent gaps); ghost gate green across the grown catalog; both VUs PASS; Pablo pass. The IR census in each inventory header records the new per-type capability counts as the standing baseline.
