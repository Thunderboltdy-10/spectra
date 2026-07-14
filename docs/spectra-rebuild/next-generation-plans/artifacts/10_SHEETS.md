# Sheets artifact plan

## Product position and inheritance

Sheets is a first-class Spectra artifact conforming to 02_ARTIFACT_TYPE_STANDARD.md. It provides the familiar workbook, grid, formula, analysis, and chart environment needed for experiments, study tracking, structured school work, and reusable data sources. It is comparable in ambition to Excel and Google Sheets, not a simplified table.

The primary reference is 16_sheets_editor.png. Match its workbook title/summary, menu and formatting bars, name box and formula bar, row/column headers, active cell and range treatment, grid density, chart/summary region, sheet tabs, right Details/Activity rail, saved state, sharing, links, tags, and persistent Spectra composer. Apply the shared blue AI treatment, history comparison, and embed behavior even where the reference does not show them.

## Workbook and calculation model

The workbook contains stable sheet IDs, ordered/renamable sheet tabs, stable row/column identities, sparse cells, named ranges, tables, filters, sorts, frozen panes, hidden rows/columns, merged cells, notes, data validation, conditional formatting, styles, charts, images, references, and workbook/sheet settings. Cells store typed values, formulas, rich display formats, validation, protection, provenance, and errors. Formula references use stable structural identities internally while displaying A1 notation.

The calculation engine supports arithmetic, text, date/time, logical, lookup/reference, statistical, array, and common educational/scientific functions in staged releases. It maintains a dependency graph, incremental recalculation, circular-reference detection, deterministic locale/timezone handling, spill ranges, error propagation, and calculation-version compatibility. Volatile/network/custom-code functions are excluded initially.

Tables provide named columns, typed data, totals, structured references, filter/sort state, and chart-ready ranges. Charts include line, bar, column, area, scatter, pie/donut, histogram, and combination charts in phases, with titles, axes, series, legends, labels, accessible summaries, themes, and source-range lineage. A chart embedded in a document or presentation remains linked to a permissioned sheet range and can be pinned to a workbook version.

## Real-time persistence and collaboration

There is no manual-save boundary and no offline editing. Cell/range, structure, format, chart, and formula mutations persist incrementally through the self-hosted Yjs collaboration transport and authorized domain transactions. The UI reports synchronizing, synchronized, reconnecting, unsynchronized, invalid, permission lost, and conflict; it never claims a local-only value is saved.

Stable semantic regions include workbook setting, sheet, cell, rectangular range, row, column, table, filter/sort rule, named range, chart, chart series, and formula. Active edit ownership is exclusive for the same cell/range or overlapping structural region. Non-overlapping ranges may change concurrently. A conflicting actor is queued or paused with current/proposed/base values and explicit keep/apply/merge resolution; no last-write-wins overwrite. Presence shows active sheet, cell/range, viewport, and collaborator identity. Comments anchor to cells, ranges, tables, and charts.

Human changes are grouped by meaningful editing session or idle boundary. Every coherent AI operation batch creates an AI-attributed version. If unsnapshotted human changes exist when AI begins, create a user-authored checkpoint first. Historical rendering shows the real workbook state and selected sheet/range beside the live workbook. Partial restore can restore a range, formula, format, table, chart, or sheet after dependency-impact preview.

## AI skill and operations

Load the Sheets AI skill only when Sheets is selected or required. It defines workbook purpose, region addressing, formula semantics, preservation rules, calculation verification, approvals, and cross-artifact connections. The ordinary runtime receives only a compact hint that Sheets is appropriate for structured calculation, analysis, and graphing.

Typed operations inspect workbook outline/range/schema/dependencies; create workbook/sheets/tables; populate or clear cells; set formulas and formatting; fill/transform ranges; filter/sort; create named ranges; analyze statistics/trends/anomalies; create and edit charts; import data; explain formulas/errors; and link chart/range outputs to documents, presentations, code visualizations, threads, tasks, or workspaces. Destructive clears, broad formula replacement, sharing sensitive ranges, or structural changes with dependent formulas require preview/approval.

AI working effects attach to actual ranges, cells, formulas, and charts. Independent range operations may animate concurrently. Values form deliberately across a range, formulas transition with visible dependency feedback, and charts assemble from their real series. Effects trail backend commits slightly when useful for perception, but always reconcile to durable state and fully clear on completion, failure, rejection, cancellation, reconnect, or permission loss. Reduced motion uses restrained region outlines and state labels.

## Permissions and privacy

Artifacts are private by default. Workspace read-only or modify access normally flows to Sheets placed there; an artifact exception may remove an individual’s access. Direct access offers read-only or modify. Public viewing is explicit and never default. Internally, future granular protections may restrict sheets/ranges/formulas, but the initial sharing UI remains simple.

Formula evaluation, search, AI analysis, chart embedding, exports, and history all re-check source access. A document or presentation containing a linked chart does not grant access to the source workbook. Sensitive imported school data is not automatically placed in shared workspaces.

## Progressive disclosure and UI behavior

Common entry points—cell edit, formula bar, formatting, add sheet, sort/filter, chart, comments, share—remain visible. Advanced validation, named ranges, protections, conditional formatting, calculation settings, and chart-series configuration live in menus/inspectors. Remove duplicate or nonfunctional controls. Every menu item in the reference must either work completely or be omitted until it does.

Support keyboard navigation and selection, multi-range operations where practical, copy/paste, fill handle, undo/redo, row/column insertion/deletion/resizing, freeze, find/replace, screen-reader grid semantics, high contrast, 200% zoom, and touch selection. Virtualize rows/columns/charts and fetch workbook chunks by visible range without whole-workbook updates.

## Import, export, quarantine, and adoption

Stage 1: CSV/TSV import/export, clipboard tables, locale/encoding/type detection, and fidelity report. Stage 2: XLSX import/export including worksheets, values, common formulas, formatting, tables, filters, frozen panes, merged cells, validations, comments, and major chart types. Stage 3: ODS import/export and improved Excel round-trip. Google Sheets migration uses XLSX/CSV initially; a connector may follow.

Imports are scanned, parsed in isolation, size-limited, schema/calculation validated, and previewed. Unsupported formulas, macros, external links, pivot features, charts, fonts, or protections are quarantined or converted with an itemized fidelity report—never silently discarded. VBA/macros do not execute. Recovery lets users download the original, retry mappings, import supported sheets only, or keep unsupported formulas as text. Exports report features that cannot round-trip.

## Failure and recovery

Handle calculation cycles, spill collisions, invalid references, locale ambiguity, partial paste/import, huge workbooks, chart-source deletion, unavailable dependency, reconnect, unsynchronized state, concurrent structural edits, permission revocation, corrupted chunk/snapshot, and interrupted AI work. Durable committed cells remain available if a chart/build fails. Reconnect compares Yjs state vectors and server authorization; it does not maintain an offline edit queue.

## Delivery and migration

Deliver in slices: workbook/grid and live persistence; calculation engine and formats; collaboration/comments/history; tables/filter/sort/charts; AI skill/operations/effects; embeds/links; major imports/exports; scale/accessibility/live verification. Existing tabular generic artifacts and uploaded spreadsheets enter the new importer and quarantine flow rather than a compatibility wrapper.

## Tasks

### SHEET-01 Register Sheets and define workbook, sheet, stable cell/range, table, chart, style, validation, comment, and provenance schemas

- [ ] Implemented
- [ ] Verified

### SHEET-02 Implement the sparse workbook store, dependency graph, staged formula engine, incremental recalculation, errors, and version compatibility

- [ ] Implemented
- [ ] Verified

### SHEET-03 Match 16_sheets_editor.png across grid, menus, toolbars, formula bar, chart region, tabs, details rail, composer, responsive and empty/error states

- [ ] Implemented
- [ ] Verified

### SHEET-04 Implement selection, keyboard, edit, fill, copy/paste, undo/redo, formatting, rows/columns, panes, search, validation, and accessibility

- [ ] Implemented
- [ ] Verified

### SHEET-05 Implement tables, filters, sorts, named ranges, conditional formatting, charts, accessible summaries, and linked chart/range references

- [ ] Implemented
- [ ] Verified

### SHEET-06 Implement online-only self-hosted Yjs synchronization, presence, exclusive overlapping-region ownership, comments, reconnect, and conflict resolution

- [ ] Implemented
- [ ] Verified

### SHEET-07 Implement meaningful human checkpoints, mandatory pre-AI user checkpoints, AI-attributed versions, comparison, full/partial restore, and retention

- [ ] Implemented
- [ ] Verified

### SHEET-08 Implement on-demand Sheets AI skill, typed inspect/create/edit/formula/analyze/chart/link operations, approvals, validation, and cross-artifact use

- [ ] Implemented
- [ ] Verified

### SHEET-09 Implement real cell/range/formula/chart working effects, concurrent region animation, cleanup, failure/cancel/reject behavior, and reduced motion

- [ ] Implemented
- [ ] Verified

### SHEET-10 Implement private-default read-only/modify sharing, workspace inheritance exceptions, explicit public view, source-safe embeds, search, and context

- [ ] Implemented
- [ ] Verified

### SHEET-11 Implement staged CSV/TSV/XLSX/ODS import/export, quarantine, fidelity reports, macro/external-link safety, and recovery

- [ ] Implemented
- [ ] Verified

### SHEET-12 Prove actual UI controls, formula correctness, large-workbook performance, collaboration/conflicts, AI history, imports/exports, embeds, permissions, reconnect, and visual fidelity in Chrome

- [ ] Implemented
- [ ] Verified
