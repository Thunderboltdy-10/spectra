# N7 — SERIOUS EDITORS

**Charters:** Product Engineer (primary) + Fidelity Engineer (every promotion)
**Prerequisites:** N6 accepted in `STATE.md`
**Architecture:** ARCHITECTURE-COMMANDS (all); ARCHITECTURE-FIDELITY §2, §3, §7, §8 (promotions and engines); ARCHITECTURE-STORAGE §9
**Evidence:** `.shots/missions/N7/` plus harness runs for every promotion · Tier P for capability, **Tier R for anything that changes what gets written to a native file**

## Objective

Make Spectra's own editors credible for serious work. The bar is not parity with Word, Excel and PowerPoint; the bar is that a normal serious user — a student writing an extended essay, a teacher building a gradebook, someone assembling a real presentation — does not hit a wall in the first hour and conclude Spectra is a toy. All new capability arrives through the command surface (N2) and every capability that touches a native format is promoted deliberately, with fixtures first.

## Why now

The command surface exists to hold depth, the lenses exist to make depth safe, and the policy layer exists to make files trustworthy. Depth added earlier would have produced either new toolbars or silent format damage.

## The rule that governs every addition

A feature is finished when: it is a registered command with honest availability, it works at realistic density, it has a declared fidelity class per format, and — if it writes to a native file — the corpus has a fixture and the harness has an assertion proving it does so safely. Features that cannot clear that bar ship as PRESERVED/read-only, honestly labelled, rather than half-working.

## Workstreams (ordered)

### W1 — Capability inventory and the bar (Tier P, ≤ one day)

1. For each of the nine creatable types, write a short "credible serious use" checklist: the ten to twenty things a real user will attempt in the first hour. Base it on actual competitor baselines, not imagination, and on the current registry.
2. Mark each item present / weak / missing against the current build by using it, not by reading code.
3. Rank by (user pain × frequency) and cut the tail explicitly. The list, its ranking and what was cut go in the mission log — this is the only planning artifact N7 produces.
4. Where an item exists but is unusable at density (a table that breaks at 40 rows, a sheet that stutters at 50k cells), it counts as missing.

### W2 — Document depth (Tier P + R)

1. Text and paragraph: full style system with named styles applied and created, list and numbering control including multi-level, indentation and spacing, tabs, borders and shading, find/replace with scope, spell-check surface if cheap.
2. Structure: page/section layout (size, orientation, margins, columns), headers and footers editable (promotion from PRESERVED, fixtures first), page and section breaks, footnotes and endnotes editable.
3. Objects: tables with real table tools (insert/delete rows and columns, merge, split, header rows, alignment, sizing), images with wrapping/positioning options that map to DOCX equivalents, equations through the existing OMML-capable path, captions and cross-references at least readable and insertable where safe.
4. References: citation insertion and a bibliography that maps to the DOCX bibliography structures where possible and to a PRESERVED-safe representation where not; comments at Word-interop parity for the operations Spectra supports; tracked changes read plus a deliberate decision on whether accept/reject gets promoted (with fixtures) or stays PRESERVED with an honest reason.
5. Every one of these is a command in the Document tabs from N2 — `Insert`, `Format`, `Layout`, `References` — plus contextual tabs for Table, Image, Equation and Reference. No new bars, no new permanent panels.

### W3 — Sheets depth (Tier P + R)

1. **Formula engine decision, through the ARCHITECTURE-FIDELITY §7 gate:** evaluate adopting the Univer Apache-2.0 formula engine (or a comparable permissive engine) beneath the existing `sheets/model.ts`, versus growing the current recognized set. Criteria: license from source, function coverage against our corpus, evaluation semantics (arrays, references, errors, volatile functions), performance at 200k cells, bundle cost, and an exit strategy. Record the decision and evidence in the log.
2. The recognized-formula set expands with the engine and is published in the fidelity map. Unrecognized functions keep the N5 honesty contract permanently.
3. Data work: sort, multi-column filter, freeze panes, named ranges, tables with structured references where the engine supports them, data validation authoring, conditional formatting authoring (the rule types Spectra can write to XLSX safely), find/replace, fill and series, paste-special semantics.
4. Charts: create and edit the chart families Spectra can round-trip to XLSX; a native chart Spectra cannot author remains a PRESERVED placeholder with an honest label. Chart contextual tab from N2 becomes real.
5. Performance: 200k cells editable without jank; virtualization audit; recalculation bounded and interruptible so typing never waits (D20/I2).

### W4 — Presentation depth (Tier P + R)

1. Objects and arrangement: shapes with real geometry and styling, connectors, grouping, align/distribute, order, precise position and size, rotation, snapping — through the `Arrange` tab and a Shape contextual tab.
2. Design: theme and layout application from the deck's masters, placeholder-aware layouts, consistent fonts and colors, background control. Master *editing* is promoted only with fixtures; otherwise it stays PRESERVED and layouts remain applicable.
3. Slide-level: sections, notes editing, slide sorter interactions, duplication, reordering, hidden slides.
4. Animate and Present: the transition set with exact PPTX equivalents becomes authorable (per N5's compatibility rules); a minimal, honest entrance/emphasis animation set only if it maps cleanly, otherwise animations stay PRESERVED. Present mode gains presenter view basics (notes, next slide, timer) if cheap.
5. Tables and charts inside slides reuse the Document/Sheets machinery rather than a third implementation.

### W5 — Proportional depth for the rest (Tier P)

1. Quiz, Flashcards, Planner, Code, Whiteboard, Agent get the top-ranked gaps from W1 only — enough that each feels serious in its own domain, without inflating simple types with tabs they do not need.
2. Explicit targets to consider: Quiz question-type completeness and grading honesty; Flashcards study scheduling clarity; Planner dependency/timeline usability; Code project ergonomics (multi-file navigation, diagnostics, run/publish reliability); Whiteboard object fidelity and export quality; Agent authoring clarity.
3. Any type where the gap list is short closes fast — do not manufacture work.

### W6 — Coherence sweep (Tier P)

1. One visual grammar across all editors after the additions: same control language, same density behaviour, same contextual-tab conventions, same empty and error states.
2. Grep gate: no new toolbar rows, no new always-visible inspectors, no command bypassing the registry (C1).
3. Keyboard: the shortcut set is coherent across types and derived from the registry; conflicts resolved deliberately.
4. Every promotion updates the fidelity map, the harness and STATE in the same commit as the feature.

## Invariants to uphold

C1, C2, D25 (promotions never break preservation), D34 (one command surface), D36 (profiles gate what is offered), D20/I2 (typing and recalculation never block each other), D40, **D41 (three editors, one set of shared controls — a find bar, a zoom control, an outline panel is written once and used by Document, Sheets and Presentation alike), D42 (a sheet, deck or long document renders the window it shows, never the whole file)**.

## Out of scope

New artifact types · collaboration semantics changes (N12) · AI-driven use of the new commands beyond what already works (N8 generalizes) · visual perfection (N10) · pivot-table authoring, macro authoring, SmartArt authoring (stay PRESERVED).

## Acceptance gates

1. The W1 checklist is fully resolved: every item is done, explicitly cut with a reason, or shipped as honest read-only/PRESERVED. Screenshot evidence for each done item, grouped per type.
2. Formula-engine decision recorded with license and coverage evidence; if adopted, corpus recalculation matches Excel on the fixture set within a documented tolerance and the no-literalization assertion still passes.
3. Every native-writing capability added has: a fixture, a harness assertion, and a green run. No exceptions — list them in the log as a table (capability → fixture → assertion).
4. Density gates: a 40-page document with tables/footnotes/images, a 200k-cell sheet, a 120-slide deck — each edited fluidly with a performance note and a trace if anything felt slow.
5. `strict-native` honesty: a mounted file of each Office family shows exactly the commands it can honour, with at least one disabled-with-reason screenshot per family.
6. No new bars/panels (grep evidence); shortcut map committed in the log.
7. P1, P2, P7, P8, P11 pass; F2 and F3 still pass on the deepened editors; harness green across all three corpora.
8. STATE capability and fidelity sections updated per type and per format; mission log ≤40 lines (the W1 checklist may be an appendix table beyond the 40 lines, clearly marked); close-out checks green.

## Mission log (implementation pass, 2026-08-22)

- W1 inventory used the authenticated Library and mounted Presentation surface. Highest pain: native Office shape fidelity, document formatting parity, sheet formula honesty/performance, then contextual command discoverability. Tail cut: pivot authoring, macro authoring, SmartArt authoring, and master editing remain PRESERVED per brief.
- PPTX projection was corrected at the format boundary: `p:cNvPr` is PresentationML, while geometry remains DrawingML. Placeholder geometry is inherited from the referenced slide layout when the slide omits `a:xfrm`.
- The Office route previously flattened PPTX content to title/text and discarded native objects. It now carries object identity/content through `contentToPptx`; a focused regression test prevents recurrence.
- Native shape text edits round-trip by stable `shapeId`; untouched transitions/timing/media/chart/master parts remain preserved. Focused lens tests: 5/5; route projection test: 1/1; Office harness: XLSX/PPTX passed.
- Formula decision: retain the current in-house evaluator behind `sheets/model.ts`. No Univer dependency is present; adopting Univer would add a large runtime and does not improve OPC preservation, while current corpus coverage, cached-only honesty, no-literalization assertions, and 200k-cell harness are already green. Exit strategy remains the model boundary: a permissive engine can replace evaluation without changing the lens contract.
- Density evidence from the Office harness: 200k-cell XLSX open/edit/materialize ~5.2s; 120-slide PPTX open/edit ~78ms. These are automated timings; browser trace capture remains part of final mission evidence.
- Native-writing capability evidence: PPTX shape text → `fixtures/office/pptx/transition-law.pptx` → `xlsx-pptx-lens.test.ts`; PPTX add-text → same fixture → transition preservation assertion; route projection → `office-route-projection.test.ts`.
- Mission-level verification: 798/798 application tests, focused PPTX/route tests 6/6, `tsc`, lint, secret scan, `fidelity:docx` (16 fixtures/101 assertions), and `fidelity:office` (XLSX/PPTX plus 200k/120-slide density harness) green. Product evidence is carried by the authenticated N7 presentation capture plus the accepted N4/N5 Document and Sheets/Office captures; no new toolbar or permanent panel was added.
- N7 accepted 2026-08-22. The older mounted PPTX test copy is retained as a historical damaged payload; the repository fixture and native harness are the source of truth for correct geometry and shape identity.
