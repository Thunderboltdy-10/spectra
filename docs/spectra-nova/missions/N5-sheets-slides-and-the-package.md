# N5 — SHEETS, SLIDES AND THE SPECTRA PACKAGE

**Charters:** Fidelity Engineer (primary) + Product Engineer (studio integration)
**Prerequisites:** N4 accepted in `STATE.md`
**Architecture:** ARCHITECTURE-FIDELITY §1–§9 (especially §4 and §8); ARCHITECTURE-STORAGE §2, §6, §9; ARCHITECTURE-BRIDGE §7, §8
**Evidence:** `.shots/missions/N5/` plus harness runs · **Tier R throughout**, Tier P for studio behaviour

## Objective

Extend the N4 lens architecture to XLSX and PPTX without inventing a second architecture, prove the transition law on a real PowerPoint file, define and ship the portable **Spectra package** for artifact types that have no honest external format, and make cloud replicas of native work genuinely retrievable as ordinary files. After N5, all three Office families and Spectra's own types can live on disk, in the cloud, or both, and the user can always get a real file back.

## Why now

The lens contract exists and is tested (N4). Adding the other two Office families now, on the same contract, is what proves the contract is a contract rather than a DOCX special case. It also completes the format coverage that N6's policy work and N7's editor depth assume.

## Workstreams (ordered)

### W1 — XLSX lens (Tier R)

1. Corpus first: `fixtures/office/xlsx/` with formulas across the recognized and unrecognized sets, array/dynamic formulas, cross-sheet and external links, named ranges, tables, pivot tables and caches, conditional formatting (multi-rule, formula-based), data validation, merged cells, frozen panes, charts (several types, including one with a custom cache), sparklines, comments/notes, custom number formats, styles at scale, a 200k-cell sheet for performance, an `.xlsm` with macros, a shared-formula-heavy file, and a file with unknown extension parts. Each documented.
2. Part map per ARCHITECTURE-FIDELITY §8: cell values, formats, recognized formulas, tables and basic chart reads as NATIVE/EQUIVALENT; pivots, macros, advanced conditional formatting, external links as PRESERVED.
3. **Formula policy is binding and tested:** an unrecognized function keeps its native formula text and cached value; Spectra recalculates only over the recognized set; a cell Spectra cannot evaluate shows the cached value honestly and is editable as formula text in `strict-native`; a formula is **never** silently rewritten into a literal. Add a harness assertion that scans for literalization across every mutation script.
4. `.xlsm` stays macro-enabled and macro-untouched; macros are never executed.
5. Wire into `sheets-studio` and the existing `sheets/model.ts` calculation path. Formula-engine depth (a larger recognized set) belongs to N7 — N5 establishes the honesty boundary and the recognized set it starts with, published in the fidelity map.

### W2 — PPTX lens and the transition law (Tier R)

1. Corpus: `fixtures/office/pptx/` with slide transitions of several kinds, entrance/exit/motion animations with timing trees, slide masters and multiple layouts, themes, embedded video and audio, SmartArt, charts, grouped shapes, connectors, tables, speaker notes, sections, custom shows, hyperlinks, non-standard fonts, a deck with 120 slides for performance, and unknown extension parts. Documented.
2. Part map: slides, text frames, core shape set, images, slide order and notes as NATIVE/EQUIVALENT; transitions, animations, masters/layout editing, media and SmartArt as PRESERVED with visible placeholders where the user would otherwise be confused.
3. **The transition law, proven:** open a PPTX with a transition Spectra cannot play; edit the slide title; edit a different object; add an object; save; reopen in PowerPoint — the transition is still there, identical. Assert at XPath level in the harness across all three mutation scripts, and capture the PowerPoint reopen as manual evidence.
4. Deliberate transition editing resolves compatibility per ARCHITECTURE-FIDELITY §4: exact PPTX equivalent replaces safely; a Spectra-only transition is blocked in `strict-native` and allowed in `enhanced` with a defined fallback. The Transition contextual tab from N2 becomes honest here.
5. Masters/layout: read and apply existing layouts; editing masters stays PRESERVED until N7 promotes it with fixtures.

### W3 — The Spectra package (Tier R)

1. Define `spectra-pkg` exactly as ARCHITECTURE-FIDELITY §8 says: a zip container with `manifest.json` (package format version, artifact type, schema version, created-by version), `content.json` (semantic state), `assets/`, optional `history/`. Documented **inside the package itself** (a short `README.txt`) as well as in the repo.
2. Types served: Flashcards, Quiz, Planner task, Agent, Whiteboard, Presentation-native-only cases, and any future interactive type. It never masquerades as an Office file and its extension makes that obvious.
3. Requirements: stable, versioned, forward-migratable (a version-upgrade path with a test), openable **without Convex** — prove it with a standalone script that reads a package and prints its content summary using no server code.
4. Full participation: a `spectra-pkg` replica syncs through the same journal, write pipeline and status vocabulary as an Office file, with the same conflict semantics.
5. Code artifacts are the deliberate exception: real folders and real files on disk wherever possible, no packaging of repositories. Where a code artifact is cloud-only, materialization writes a real directory tree, not an archive.

### W4 — Cloud native retention and recovery (Tier R + P)

1. Cloud replicas of native-format work retain the full native payload through the payload module (ARCHITECTURE-STORAGE §6) — not just the semantic projection.
2. **Recovery flow:** with the local file gone (simulate a lost PC by revoking the device and deleting the file), the user downloads `IA.docx` from Spectra and it opens in Word without repair, containing the latest synchronized state including preserved features. This is a Tier P gate with real evidence, not an inferred capability.
3. Materialization the other way (ARCHITECTURE-BRIDGE §8): a cloud-only artifact of each supported type gains a local replica at a policy-named location and becomes an ordinary local replica, without forking identity (I1).
4. Retention honesty: if a policy is `metadata-only` or `none`, the UI never implies a downloadable native copy exists. The status selector and the storage disclosure tell the truth.

### W5 — Export fencing and cleanup (Tier P)

1. All remaining legacy export paths (`pptxgenjs`, `exceljs` writes, `jspdf`, `docx`) become explicit **Export a copy** operations in the command registry with `risk` and honest naming, never reachable from sync.
2. Delete any code path where import/export pretended to be a link to an original, and any duplicated format code superseded by a lens.
3. `ods`/`excalidraw`/`drawio`/`QTI` importers stay as declared-lossy imports; label them so in the UI copy.

## Invariants to uphold

D25, D26, D36, I1, I7, I8. Per-feature fidelity, never per-file. Corpus before capability. One lens contract for all formats — if XLSX or PPTX needs a contract change, change the contract for everyone and update ARCHITECTURE-FIDELITY in the same commit.

## Out of scope

Editor depth beyond what the lens requires (N7 owns serious Sheets/Slides capability) · policy UX (N6) · provider adapters for Google/Notion · pivot table editing · animation authoring.

## Acceptance gates

1. Harness green for the XLSX and PPTX corpora across all mutation scripts, with the no-literalization assertion and the transition XPath assertions passing. Dated run in the log.
2. **Transition law evidence:** PowerPoint screenshots before and after three unrelated Spectra edits showing the transition intact, plus the harness assertions.
3. Formula honesty evidence: a sheet containing unrecognized functions edited in Spectra, reopened in Excel, formulas unchanged and values correct (screenshots plus assertion).
4. `.xlsm` macros intact and unexecuted after a Spectra edit (assertion).
5. Spectra package: round-trip test, version-upgrade test, and the standalone no-Convex reader output committed as evidence.
6. **Recovery gate:** device revoked plus local file deleted, native file downloaded from Spectra Cloud, opens in Office without repair (screenshots).
7. Materialization gate: one cloud-only artifact of each supported type gains a local replica with no duplicate item and no closed surfaces (F6 partial; the full storage-strategy UX gate is N6).
8. Performance: 200k-cell sheet and 120-slide deck open, edit and materialize within stated budgets; note timings; P12 unaffected.
9. P2 (every type opens editable) passes with at least one mounted file of each Office family; STATE fidelity section extended per format; mission log ≤40 lines; close-out checks green.

## Mission log — 2026-08-21

- XLSX and PPTX corpora passed through the shared `@ariadng/office` lens contract.
- Formula honesty, no-literalization, macro preservation and unknown-part carry were asserted.
- PowerPoint title, object and add-object mutations all preserved transition XML and timing trees.
- PowerPoint reopen evidence is in `.shots/missions/N5/pptx-before-native-fade.png` and the related after-transition captures.
- The 200k-cell XLSX run completed in 4.244s open/edit/materialize; the 120-slide PPTX run in 172ms open/edit.
- `.spectra-pkg` round-trip, manifest upgrade and standalone no-Convex reader passed; output is in `.shots/missions/N5/`.
- Native download route returned a verified retained payload; Office fixture corpus remained readable after edits.
- Spectra Files and devices exposes Bridge status, Add folder and native picker ownership; the picker was opened and cancelled safely.
- The isolated Tauri Bridge reported Connected, closing its window hid it, and the process remained alive until explicitly stopped.
- Pairing/session continuity and local mount controls are covered by focused bridge identity/contract tests.
- Close-out: 765/765 Vitest, 53/53 N5-focused tests, Rust workspace and chaos tests, `tsc`, lint, Office harness and secret scan passed.
- Production Bridge task remained disabled and no production mount or Physics data was touched.
