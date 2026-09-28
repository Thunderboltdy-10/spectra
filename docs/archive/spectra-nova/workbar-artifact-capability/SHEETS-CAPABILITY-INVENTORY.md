# Sheets Capability Inventory

## P12.I7 authoritative post-P3 closure — 2026-08-31

**Named industry leader:** Microsoft Excel for Microsoft 365 (desktop).

**Authority:** the capability IR and XLSX lens schemas on `reform/P12.I7`; this section supersedes every 2026-08-22 status, proposal, priority, and gap statement below.
**Closure rule:** `SHIP` means the operation is reachable through the IR and works in its declared profile; `REFUSE-HONESTLY` means strict-native shows the exact IR-owned sentence to both a person and the AI; `DEFER-WITH-OWNER` names work outside this bounded re-audit. There are no silent rows.

### Standing IR census

| Classification | Rows | Closure |
|---|---:|---|
| SHIP — XLSX lens writer | 42 | Each row names a delta imported from the XLSX lens schema. |
| SHIP — UI/read/export operation | 27 | These operations do not claim a native package write. |
| REFUSE-HONESTLY — no native delta | 42 | Exact Excel-specific reason plus a next action; human and AI gates share it. |
| **Total** | **111** | Standing P12.I7 baseline; unchanged from the post-P3 census. |

### Microsoft Excel family closure

| Classification | Capability families | IR rows | Product answer |
|---|---|---:|---|
| SHIP | Cell values/formulas, safe clearing, supported formatting, merges, and freeze panes | 42 | Writes through the XLSX lens; unsupported formula machinery and unrelated parts remain preserved. |
| SHIP | History, selection/navigation, formula aids, inspection, views, and copy/export actions | 27 | Works without claiming a native package delta. |
| REFUSE-HONESTLY | Import-copy boundary | 1 | Offer a separate Library copy. |
| REFUSE-HONESTLY | Charts | 7 | Preserve chart parts and cached data; direct chart changes to Excel. |
| REFUSE-HONESTLY | Row/column insert/delete and dimensions/visibility | 10 | Explain dependency risk; direct structural or dimension changes to Excel. |
| REFUSE-HONESTLY | Sort, filters, and duplicate-row removal | 6 | Name the distinct structural risk and the matching Excel action. |
| REFUSE-HONESTLY | Tables, validation, conditional formatting, calculation mode, and defined names | 7 | Preserve each native record family; direct its edit to Excel. |
| REFUSE-HONESTLY | Worksheet lifecycle/order/visibility/tab colour | 9 | Preserve sheet identities; direct sheet management to Excel. |
| REFUSE-HONESTLY | Cell notes and protection | 2 | Preserve the native parts/settings; direct the change to Excel. |

### Deferred leader gaps with owners

| Field Note | Classification | Microsoft Excel gap | Named later owner |
|---|---|---|---|
| P12.I7-EXCEL-1 | DEFER-WITH-OWNER | Pivot-table creation/editing, slicers, PivotCharts, and data-model semantics | Orchestrator — future **Excel Analytical Objects unit**, after P12.V2 |
| P12.I7-EXCEL-2 | DEFER-WITH-OWNER | Native charts, tables, filters/sorts, validation, conditional formatting, defined names, notes, and sheet lifecycle | Orchestrator — future **Excel Package Writer unit**, after P12.V2 |
| P12.I7-EXCEL-3 | DEFER-WITH-OWNER | Dependency-safe row/column insertion/deletion and dimension/visibility writes across formulas and preserved objects | Orchestrator — future **Excel Structural Rewrite unit**, after P12.V2 |
| P12.I7-EXCEL-4 | DEFER-WITH-OWNER | Power Query/external data, data model, and VBA authoring beyond safe preservation | Orchestrator — future **Excel External Data & Automation unit**; macro execution remains prohibited |

### Archaeology boundary

Everything below this line is the original 2026-08-22 pre-IR research record. It remains useful for historical evidence and leader-feature discovery, but its statuses, command wiring claims, gaps, and implementation priorities are **superseded and non-authoritative**.

**Purpose:** Research deliverable for the workbar/artifact capability implementation pass (Phase 4). Maps every Sheets authoring capability against the shared command contract, native fidelity classes, existing code, fixtures, and gaps.

**Sources:** Nova canon/architecture docs, `WORKBAR-ARTIFACT-CAPABILITY-CONTRACT.md`, `WORKBAR-ARTIFACT-CAPABILITY-AGENT-PROMPT.md` Phase 4, N7/N8 mission logs, and codebase truth in `sheets-studio.tsx`, `sheets/model.ts`, `lenses/xlsx-lens.ts`, `commands/registry.ts`, `artifacts/registry.ts`, and Office harness fixtures.

**Inventory date:** 2026-08-22

---

## 1. Executive summary

Spectra Sheets already supports serious spreadsheet work at the **semantic model** layer: a 200k-cell density harness passes, the XLSX lens preserves macros, comments, charts, ActiveX, and unrecognized formulas without literalization, and the studio implements sorting, filtering, tables, named ranges, validation, conditional formatting (Spectra-authored rules), chart creation, structural edits, freeze panes, import/export, and a broad in-house formula evaluator behind `sheets/model.ts`. N7 retained that evaluator (no Univer dependency) with documented exit strategy at the model boundary.

The **workbar/command gap** is the main blocker for the capability pass: ~25 actions exist as `CommandBinding[]` in `sheets-studio.tsx`, but many contract-required capabilities live only in side panels, keyboard shortcuts, or grid gestures — **not** as registered commands with stable ids, AI parity, choreography targets, and per-capability evidence. Contract defaults (`General`: Undo, Redo, Find, Format, **Formula**, **Freeze**, Chart) are not fully populated; contextual **Chart** and **Formula** tabs have no dedicated command sets. Merge/unmerge, paste, fill series, replace, notes, borders, wrap, hide row/column, sheet reorder, manual recalc, and chart editing are implemented or partially implemented **without** workbar registration.

**Lens vs evaluator mismatch:** `XLSX_RECOGNIZED_FORMULAS` in `xlsx-lens.ts` lists only nine functions (`ABS`, `AVERAGE`, `COUNT`, `COUNTA`, `IF`, `MAX`, `MIN`, `ROUND`, `SUM`). The runtime evaluator recognizes ~50 function names including `XLOOKUP`, `SUMIF`, `COUNTIFS`, etc. Formulas using functions outside the lens set remain **cached-only** in strict-native mounted files even when Spectra can evaluate them in born-Spectra workbooks — honest for XLSX round-trip but confusing for users unless availability explains the profile.

**Native write depth:** Cell value/formula edits, recognized formulas, and Spectra-modeled tables/charts round-trip through `@ariadng/office` part-level mutation. Native Excel charts, pivot tables, advanced conditional formatting, data validation variants, external links, sparklines, and comments are **PRESERVED** (fixture-proven) but not authorable to XLSX yet. Import paths (`exceljs` for "Import a copy", studio import) are **ADAPTED** and must never be confused with lens sync.

**Priority:** (1) Register and wire every existing studio handler to namespaced commands with contract default placement; (2) close formula recognition alignment and add harness rows for each promoted function family; (3) promote XLSX-safe authoring for validation/conditional formatting/merge/charts with fixtures before exposing strict-native commands; (4) defer pivot authoring, macro execution, and external-link editing per N7 cut line.

---

## 2. Full inventory matrix

Legend:

- **Status:** `SHIPPED` (works end-to-end), `PARTIAL` (UI/model exists, command/evidence/native gap), `PRESERVED` (read-only in strict-native), `MISSING` (not implemented), `ADAPTED` (lossy import/export only)
- **Formats:** Primary native targets for strict-native profile; `spectra-native` = born-in-Spectra workbook with no mounted OPC ceiling

### 2.1 General editing and history

| Capability name | Semantic model | Proposed command id | UI tab/group | Supported native formats | Fidelity class | Risks and gaps | Proposed fixture assertions |
|---|---|---|---|---|---|---|---|
| Undo | Yjs history stack on workbook content | `sheets.undo` | General / History | xlsx, xlsm, xltx, xltm, spectra-native | NATIVE | Shipped; `sheets.undo` binding exists; needs AI/choreography test | Reload after undo; Yjs round-trip via `sheetsYjsAdapter` |
| Redo | Yjs history stack | `sheets.redo` | General / History | same | NATIVE | Same as undo | Same |
| Copy selection | Clipboard snapshot of selected cells (values, formulas, formats) | `sheets.copy` | General / Clipboard | same | NATIVE (values/formats); EQUIVALENT (formula text) | Command exists; no dedicated test | Copy `A1:B2` with formula; paste in Spectra preserves formula text |
| Paste | Apply clipboard to selection with formula translation | `sheets.paste` | General / Clipboard | same | NATIVE / EQUIVALENT | **PARTIAL:** `pasteSelection()` via Ctrl+V only; not a command | Paste after copy; formula refs adjust (`translateFormula`) |
| Clear selection | Remove values/formulas/formats in range | `sheets.clear` | General / Clipboard | same | NATIVE | Command exists; clearing formula cells must use lens delete path for mounted XLSX | Clear unrelated cell beside `XLOOKUP` in `representative.xlsm`; formula part untouched |
| Fill down / fill series | Drag fill handle copies values/formulas with offset | `sheets.fill` | General / Fill | same | EQUIVALENT | **PARTIAL:** fill handle UI only; no command; no XLSX fill metadata | Fill `=A1+1` down 5 rows; recalc matches evaluator |

### 2.2 Selection, navigation, view

| Capability name | Semantic model | Proposed command id | UI tab/group | Supported native formats | Fidelity class | Risks and gaps | Proposed fixture assertions |
|---|---|---|---|---|---|---|---|
| Find in sheet | Search cell values/formulas; highlight matches | `sheets.find` | General / Find | all | NATIVE | Shipped inspector; **no Replace** | Find "Edited" after A1 edit in harness |
| Find next | Cycle match index | `sheets.find.next` | General / Find | all | NATIVE | Sub-action of find panel | Same |
| Replace | Find/replace across sheet | `sheets.replace` | Review / Find | same | NATIVE | **MISSING** (contract requires) | Replace literal in range; formula text replace only when safe |
| Zoom in / out | View zoom factor on grid (0.75–1.5) | `sheets.zoom.in`, `sheets.zoom.out` | General / View | all | NATIVE (UI state) | Commands exist; not persisted in workbook model | Visual only; no native part |
| Show grid / show formulas mode | Toggle display of formula text vs values | `sheets.view.formulas` | General / View | all | NATIVE | **MISSING** | Toggle shows `=SUM(...)` in cells |
| Freeze rows | `sheet.frozenRows` count | `sheets.freeze.rows` | General / View (contract default) | xlsx, spectra-native | EQUIVALENT | Shipped; contract wants Freeze in General defaults | Freeze row 2; reopen Excel shows split |
| Freeze columns | `sheet.frozenColumns` | `sheets.freeze.columns` | General / View | same | EQUIVALENT | Shipped as advanced priority; should pin per contract | Freeze column B; XLSX `sheetViews` part assertion |
| Unfreeze panes | Clear frozen rows/columns | `sheets.freeze.clear` | Data / Freeze | same | EQUIVALENT | Toggle on existing freeze commands | Unfreeze restores scroll |

### 2.3 Cell and range values

| Capability name | Semantic model | Proposed command id | UI tab/group | Supported native formats | Fidelity class | Risks and gaps | Proposed fixture assertions |
|---|---|---|---|---|---|---|---|
| Edit cell value | `SheetCell.value` scalar | `sheets.cell.set` | — (grid) | xlsx, xlsm, spectra-native | NATIVE | Direct grid edit; AI op `sheets.set_cells` | Set A1 "Edited" in `representative.xlsm` harness |
| Edit formula (formula bar) | `SheetCell.formula` string | `sheets.formula.set` | Formula / Formula bar | same | NATIVE (recognized); PRESERVED (cached-only) | Formula bar shipped; lens blocks literalization | `XLOOKUP` cell stays formula text + cached value (`xlsx-pptx-lens.test.ts`) |
| Insert function | Pick function template into formula bar | `sheets.formula.insert` | Formula / Library | same | NATIVE (recognized fns) | **MISSING** command; evaluator exists | Insert `SUM` over range; recalc |
| Recalculate workbook | `calculateWorkbook()` dependency pass | `sheets.calculate.now` | Formula / Calculate | spectra-native; partial xlsx | EQUIVALENT | Automatic on edit; **no manual/recalc mode command** | 200k-cell harness timing; no keystroke blocking |
| Calculation mode manual/auto | `workbook.calculationMode` | `sheets.calculate.mode` | Formula / Calculate | spectra-native | EQUIVALENT | Model field exists; **no UI/command** | Toggle manual; edit does not auto-recalc until F9 |
| Recognized formula evaluation | In-house `FormulaParser` in `model.ts` | — (engine) | — | spectra-native | NATIVE | ~50 fns in model vs 9 in lens recognition set | Document tolerance per function family in harness |
| Cached-only formula display | `nativeFormulaSupport: "cached-only"` | — | — | xlsx, xlsm | PRESERVED | Honesty contract (N5); never rewrite as literal | `representative.xlsm` C2 XLOOKUP assertion |
| Formula error display | `#DIV/0!`, `#REF!`, etc. | — | — | all | NATIVE | Shown in grid/formula bar | Cycle detection `#CYCLE!` |

### 2.4 Formatting

| Capability name | Semantic model | Proposed command id | UI tab/group | Supported native formats | Fidelity class | Risks and gaps | Proposed fixture assertions |
|---|---|---|---|---|---|---|---|
| Format inspector | Side panel for active cell format | `sheets.format` | General / Format (contract default) | xlsx, spectra-native | EQUIVALENT | Opens panel; not granular commands | Bold A1; reopen Excel style part changed |
| Bold / italic / underline | `cell.format.bold/italic/underline` | `sheets.format.bold`, etc. | Format / Font | same | EQUIVALENT | Panel + keyboard; **not individual commands** | Style bit in `xl/styles.xml` |
| Font family / size | `cell.format.fontFamily`, `fontSize` | `sheets.format.fontFamily`, `sheets.format.fontSize` | Format / Font | same | EQUIVALENT | Limited palette (sans/serif/mono) | Font name maps to Excel family |
| Text / fill color | `textColor`, `fillColor` hex | `sheets.format.textColor`, `sheets.format.fillColor` | Format / Fill | same | EQUIVALENT | Color picker in panel | Fill color in dxf |
| Horizontal alignment | `cell.format.align` | `sheets.format.align.left`, etc. | Format / Alignment | same | EQUIVALENT | Panel buttons | Alignment in style |
| Number format | `numberFormat` enum + `decimals` | `sheets.format.number` | Format / Number | same | EQUIVALENT | general/number/currency/percent/date | Currency format round-trip |
| Borders | Cell border sides/style/color | `sheets.format.borders` | Format / Borders | xlsx | EQUIVALENT / PRESERVED | **MISSING** (contract) | Border on range; part-level style |
| Wrap text | `cell.format.wrap` | `sheets.format.wrap` | Format / Alignment | xlsx | EQUIVALENT | **MISSING** | Wrapped text in cell |
| Merge cells | `mergedRanges[]` + anchor cell content | `sheets.merge` | Format / Merge | xlsx, spectra-native | EQUIVALENT | Panel buttons only; **not command** | Merge A1:B1; `mergeCells` in sheet XML |
| Unmerge cells | Remove merge metadata | `sheets.unmerge` | Format / Merge | same | EQUIVALENT | Panel only | Unmerge restores individual cells |

### 2.5 Structure (rows, columns, sheets)

| Capability name | Semantic model | Proposed command id | UI tab/group | Supported native formats | Fidelity class | Risks and gaps | Proposed fixture assertions |
|---|---|---|---|---|---|---|---|
| Insert row above | `mutateSheetAxis(row, +1)` + formula rewrite | `sheets.insert.row` | Insert / Rows & columns | xlsx, spectra-native | NATIVE | Command exists | Insert row above formula; refs update |
| Insert column left | `mutateSheetAxis(column, +1)` | `sheets.insert.column` | Insert / Rows & columns | same | NATIVE | Command exists | Column insert shifts `SUM(A2:B2)` |
| Delete row | Structural delete + ref rewrite | `sheets.delete.row` | Insert / Rows & columns | same | NATIVE | Command exists | Delete row; no `#REF!` in dependents |
| Delete column | Structural delete | `sheets.delete.column` | Insert / Rows & columns | same | NATIVE | Command exists | Same |
| Resize column / row | `columnWidths`, `rowHeights` maps | `sheets.resize.column`, `sheets.resize.row` | Format / Size | xlsx | EQUIVALENT | Drag on headers only; **not commands** | Width persists in sheet XML |
| Hide row / column | `hiddenRows`, `hiddenColumns` | `sheets.hide.row`, `sheets.hide.column` | Data / Hide | xlsx | EQUIVALENT | Model fields used by filter; **no author command** | Hidden row excluded from export view |
| Show hidden | Clear hidden arrays | `sheets.unhide.all` | Data / Hide | same | EQUIVALENT | **MISSING** | Unhide restores rows |
| New sheet | Append `WorkbookSheet` | `sheets.sheet.new` | Insert / Sheets | spectra-native; **blocked strict-native mounted** | NATIVE / UNSUPPORTED | Command exists; lens throws on add sheet to mounted XLSX | Born-Spectra workbook adds sheet; mounted file disabled with reason |
| Rename sheet | `sheet.name` | `sheets.sheet.rename` | Insert / Sheets | xlsx (name part) | NATIVE | Command + panel | Rename in harness workbook |
| Delete sheet | Remove sheet from `sheets[]` | `sheets.sheet.delete` | Insert / Sheets | spectra-native | NATIVE | Disabled when only one sheet | Delete sheet; identities stable |
| Reorder sheets | Reorder `sheets` array / activeSheetId | `sheets.sheet.reorder` | Insert / Sheets | spectra-native | EQUIVALENT | **MISSING** | Tab order matches model |
| Select sheet | `activeSheetId` | `sheets.sheet.select` | — (selector) | all | NATIVE | Workbar selector; not command | Switch sheet preserves formulas |

### 2.6 Data tools

| Capability name | Semantic model | Proposed command id | UI tab/group | Supported native formats | Fidelity class | Risks and gaps | Proposed fixture assertions |
|---|---|---|---|---|---|---|---|
| Sort ascending | Reorder rows by column value | `sheets.sort.asc` | Data / Sort & filter | spectra-native | EQUIVALENT | Command `sheets.sort`; native sort XML **not written** | Sort column; values reorder |
| Sort descending | Same descending | `sheets.sort.desc` | Data / Sort & filter | spectra-native | EQUIVALENT | Command exists | Same |
| Multi-column sort | Sort keys array | `sheets.sort.multi` | Data / Sort & filter | spectra-native | EQUIVALENT | **MISSING** (N7 W3) | Two-key sort stable |
| Create filterable table | `SheetTable` with `filters` | `sheets.filter.toggle` | Data / Sort & filter | spectra-native | EQUIVALENT | `sheets.filter` toggles table filter | Table filter UI; not native Excel table part |
| Column filter editor | `table.filters[].allowedValues` | `sheets.filter.edit` | Data / Sort & filter | spectra-native | EQUIVALENT | Filter panel shipped | Hide rows via filter |
| Excel table (ListObject) | Native `xl/tables` part | `sheets.table.create` | Insert / Tables | xlsx | PRESERVED / EQUIVALENT | Native tables in fixtures **preserved** not authored | `complex-preservation.xlsx` table part identical after unrelated edit |
| Named range | `workbook.namedRanges` map | `sheets.namedRange.create` | Formula / Names | xlsx, spectra-native | EQUIVALENT | Command `sheets.name-range` | Name `class_means` → `definedNames` in lens |
| Data validation list | `cell.validation` list kind | `sheets.validation.set` | Data / Validation | xlsx (limited) | EQUIVALENT / PRESERVED | Spectra-authored rules; native variants preserved | List rule in Spectra; exotic native validation preserved |
| Data validation number/checkbox | validation kinds | `sheets.validation.set` | Data / Validation | same | EQUIVALENT | Panel shipped | Checkbox cell behavior |
| Conditional formatting (color scale) | `conditionalFormats` color_scale | `sheets.conditional.apply` | Format / Conditional | spectra-native | EQUIVALENT | Spectra rules rendered client-side; **native CF parts PRESERVED** | Unrelated edit preserves native CF parts |
| Conditional formatting (cell rules) | cell_is rules | `sheets.conditional.apply` | Format / Conditional | spectra-native | EQUIVALENT | Limited operators | Apply greater_than rule |
| Pivot table | Native pivot parts | — | — | xlsx | PRESERVED | **Explicitly cut** (N7); lens rejects Strict pivot fixture | `pivot-preservation.xlsx` not opened for edit |
| Pivot-like summary | Spectra analysis mode / formulas | `sheets.analyze.summary` | Data / Analysis | spectra-native | EQUIVALENT | Analysis canvas mode exists; not native pivot | SUMMARY via formulas only |

### 2.7 Formulas (function library)

| Capability name | Semantic model | Proposed command id | UI tab/group | Supported native formats | Fidelity class | Risks and gaps | Proposed fixture assertions |
|---|---|---|---|---|---|---|---|
| SUM | Aggregates | `sheets.formula.sum` | Formula / Library | xlsx (recognized) | NATIVE | In `XLSX_RECOGNIZED_FORMULAS` | `SUM(A2:B2)` in representative.xlsm |
| AVERAGE | Mean | `sheets.formula.average` | Formula / Library | xlsx | NATIVE | Recognized | Harness recalc |
| COUNT / COUNTA | Count numbers / non-empty | `sheets.formula.count` | Formula / Library | xlsx | NATIVE | Recognized | Count range |
| IF | Conditional | `sheets.formula.if` | Formula / Library | xlsx | NATIVE | Recognized | Branching formula |
| MIN / MAX | Extrema | `sheets.formula.min`, `sheets.formula.max` | Formula / Library | xlsx | NATIVE | Recognized | Min/max range |
| ROUND / ABS | Rounding / absolute | `sheets.formula.round`, `sheets.formula.abs` | Formula / Library | xlsx | NATIVE | Recognized | Decimal round-trip |
| SUMIF / COUNTIF / AVERAGEIF | Criteria aggregates | `sheets.formula.sumif`, etc. | Formula / Library | spectra-native; cached-only xlsx | EQUIVALENT / PRESERVED | Evaluated in model; **not lens-recognized** | Cached-only if mounted with SUMIF |
| SUMIFS / COUNTIFS | Multi-criteria | `sheets.formula.sumifs` | Formula / Library | spectra-native | EQUIVALENT | Model only | Evaluator tests |
| Text functions (LEN, TRIM, etc.) | String ops | `sheets.formula.text.*` | Formula / Library | spectra-native | EQUIVALENT | Model only | TEXTJOIN concat |
| Date functions | DATE, YEAR, etc. | `sheets.formula.date.*` | Formula / Library | spectra-native | EQUIVALENT | UTC semantics vs Excel locale | DATE(2024,1,1) tolerance doc |
| INDEX / MATCH | Lookup | `sheets.formula.index`, `sheets.formula.match` | Formula / Library | spectra-native | EQUIVALENT | Model only | Match position |
| XLOOKUP | Modern lookup | `sheets.formula.xlookup` | Formula / Library | xlsx | PRESERVED (cached-only) | Model evaluates; lens cached-only | `xlsx-pptx-lens.test.ts` preservation |
| Dynamic arrays / spill | — | — | — | xlsx | PRESERVED / UNSUPPORTED | **MISSING** | #SPILL! not modeled |
| Volatile (NOW, RAND) | — | — | — | xlsx | PRESERVED | **MISSING**; should stay cached-only | Do not recalc NOW in strict-native |
| External references | `xl/externalLinks` | — | — | xlsx | PRESERVED | Lens marks preserved | Unrelated edit preserves link part |

### 2.8 Charts

| Capability name | Semantic model | Proposed command id | UI tab/group | Supported native formats | Fidelity class | Risks and gaps | Proposed fixture assertions |
|---|---|---|---|---|---|---|---|
| Insert chart | `SheetChart` object on sheet | `sheets.chart.insert` | General / Chart (contract); Insert / Chart | spectra-native | EQUIVALENT | `sheets.chart` command creates Spectra chart | Chart renders from `sourceRange` (`sheets-chart.test.ts`) |
| Chart types | column, bar, line, area, pie, scatter, combo, histogram | `sheets.chart.type` | Chart (contextual) / Type | spectra-native | EQUIVALENT | Types in model | Each type dataset smoke |
| Move / resize chart | `chart.position` | `sheets.chart.move`, `sheets.chart.resize` | Chart (contextual) / Layout | spectra-native | EQUIVALENT | Pointer gestures; **not commands** | Position persisted in model |
| Edit chart title / range | `chart.title`, `sourceRange` | `sheets.chart.edit` | Chart (contextual) / Data | spectra-native | EQUIVALENT | **PARTIAL** — limited UI | Change range updates plot |
| Delete chart | Remove from `sheet.charts` | `sheets.chart.delete` | Chart (contextual) | spectra-native | EQUIVALENT | **MISSING** command | Chart removed; no orphan embed |
| Native Excel chart | `xl/charts/*` parts | — | — | xlsx | PRESERVED | Placeholder/thumbnail; `complex-preservation.xlsx` | Chart parts byte-identical after cell edit |
| Linked chart to Presentation | Embed `sheets_range` binding | `sheets.link.chart` | Insert / Chart | spectra-native | EXTENSION | Presentation embed path exists | PPTX chart from sheet range |

### 2.9 Review, comments, protection

| Capability name | Semantic model | Proposed command id | UI tab/group | Supported native formats | Fidelity class | Risks and gaps | Proposed fixture assertions |
|---|---|---|---|---|---|---|---|
| Cell note | `cell.note` string | `sheets.note.set` | Review / Notes | xlsx (limited) | EQUIVALENT / PRESERVED | Note corner display; import from exceljs; **no author UI/command** | `comments-preservation.xlsx` native comments preserved |
| Threaded comment | Native comment parts | — | — | xlsx | PRESERVED | Not mapped to Spectra comments | Comment XML identical after edit |
| Protect sheet / range | — | `sheets.protect.sheet` | Review / Protect | xlsx | PRESERVED | **MISSING** | Protection XML untouched |
| Show changes / audit | History attribution | `sheets.review.history` | Review / History | all | NATIVE | Uses global history panel | External edit attributed (Bridge) |

### 2.10 Import, export, Bridge

| Capability name | Semantic model | Proposed command id | UI tab/group | Supported native formats | Fidelity class | Risks and gaps | Proposed fixture assertions |
|---|---|---|---|---|---|---|---|
| Import spreadsheet (studio) | Replace workbook from file picker | `sheets.import` | Insert / Import | ADAPTED | ADAPTED | exceljs/ods paths; lossy caveats surfaced | Import notice lists caveats |
| Import a copy (Library) | New artifact; not linked | `app.library.importCopy` | — | ADAPTED | ADAPTED | Must not be sync path (D25) | Separate artifact id |
| Export Excel (studio) | exceljs write from model | `sheets.export.xlsx` | Insert / Export | xlsx | ADAPTED / EQUIVALENT | Lossy vs lens materialization | Export born-Spectra; compare to lens path |
| Export CSV | Delimited export | `sheets.export.csv` | Insert / Export | csv | ADAPTED | Values only | CSV round-trip values |
| Export ODS | `sheets/ods.ts` writer | `sheets.export.ods` | Insert / Export | ods | ADAPTED | Spectra ODS writer | ODS open in LibreOffice |
| Export PDF | — | `sheets.export.pdf` | Insert / Export | pdf | ADAPTED | Listed in registry exports; **verify command** | Print/PDF snapshot |
| Native materialization (Bridge) | Lens `materialize()` → bytes | — (sync path) | — | xlsx, xlsm | NATIVE | Bridge does not interpret Office (ARCHITECTURE-BRIDGE) | F2-style Bridge write + hash verify |
| Macro-enabled workbook | `vbaProject.bin` | — | — | xlsm | PRESERVED | Never executed | Macro bytes identical (`representative.xlsm`) |
| ActiveX controls | `xl/activeX/*` | — | — | xlsm | PRESERVED | `active-x-preservation.xlsm` | ActiveX parts identical |
| Custom XML | `xl/customXml/*` | — | — | xlsx | PRESERVED | Opaque part preserved | `item1.xml` identical |

### 2.11 AI manifest operations (existing semantic ops)

These exist in `artifacts/registry.ts` as `sheets.*` operation names; each must map 1:1 to a command `execute` (C1).

| Manifest operation | Proposed command id | Status | Notes |
|---|---|---|---|
| `inspect_workbook` | `sheets.inspect.workbook` | SHIPPED (AI) | Read path |
| `inspect_range` | `sheets.inspect.range` | SHIPPED | |
| `inspect_dependencies` | `sheets.inspect.dependencies` | SHIPPED | |
| `create_sheet` | `sheets.sheet.new` | PARTIAL | Human command exists |
| `rename_sheet` | `sheets.sheet.rename` | SHIPPED | |
| `set_cells` | `sheets.cell.set` | SHIPPED | |
| `set_formula` | `sheets.formula.set` | SHIPPED | |
| `fill_range` | `sheets.fill` | PARTIAL | No human command |
| `clear_range` | `sheets.clear` | SHIPPED | |
| `format_range` | `sheets.format.apply` | PARTIAL | Panel not command |
| `validate_range` | `sheets.validation.set` | PARTIAL | |
| `create_named_range` | `sheets.namedRange.create` | SHIPPED | |
| `insert_structure` | `sheets.insert.row` / column | SHIPPED | |
| `create_table` | `sheets.table.create` | PARTIAL | |
| `sort_filter` | `sheets.sort.asc` / filter | SHIPPED | |
| `create_chart` | `sheets.chart.insert` | SHIPPED | |
| `edit_chart` | `sheets.chart.edit` | PARTIAL | |
| `analyze` | `sheets.analyze` | PARTIAL | Analysis mode |
| `explain_formula` | `sheets.formula.explain` | AI-only | Needs command registration |
| `import_data` | `sheets.import` | SHIPPED | |
| `link_output` | `sheets.link` | PARTIAL | Embeds |
| `validate` | `sheets.validate` | SHIPPED | Schema/skill validation |

---

## 3. Excel / XLSX formula and behavior research notes

### 3.1 Formula honesty contract (N5 / ARCHITECTURE-FIDELITY §8)

1. **Unrecognized functions** keep native formula text and Excel's cached value (`nativeFormulaSupport: "cached-only"`). Spectra displays the cached value, allows formula-text edits, and never rewrites the cell as a literal. The lens enforces this at materialization: `XLSX_FORMULA_LITERALIZATION_BLOCKED` if a formula cell is set via value mutation (`xlsx-lens.ts` `applyDelta`).

2. **Recognition is lexical:** `formulaSupport()` scans formula text for function names against `XLSX_RECOGNIZED_FORMULAS` (nine functions). Any other function name → cached-only for that cell in the fidelity map, even if `model.ts` can evaluate it.

3. **`_xlfn.` prefix:** Parser strips modern function prefix when scanning (`(?:_xlfn\.)?` in regex) — aligns with Excel's prefixed functions in OOXML.

### 3.2 Evaluator vs lens recognition gap

| Layer | Function count (approx.) | Role |
|---|---|---|
| `XLSX_RECOGNIZED_FORMULAS` | 9 | Native round-trip safe set for mounted files |
| `FormulaParser` in `model.ts` | ~50 named handlers | Runtime calculation for born-Spectra work |
| Excel 365 | 500+ | Competitor baseline; not target for N7 cut |

**Risk:** User edits `=SUMIFS(...)` in a born-Spectra sheet, exports via lens to XLSX — if SUMIFS not promoted to recognized set, materialization may still write formula but classification stays cached-only; Excel recalculates on open. Promotion requires harness proof per function family.

**N7 decision:** Retain in-house evaluator; Univer formula engine not adopted (bundle size, preservation boundary unchanged). Exit strategy: swap evaluator behind `calculateWorkbook()` without changing lens API.

### 3.3 Error semantics (Excel alignment targets)

| Error | Model behavior | Fixture need |
|---|---|---|
| `#DIV/0!` | Thrown on divide by zero | Unit test |
| `#REF!` | Invalid references; structural delete | Structural edit test |
| `#CYCLE!` | Circular dependency detection | Two-cell cycle |
| `#NAME?` | Unknown function in evaluator | `=FOO()` |
| `#VALUE!` | Type mismatch in FIND etc. | Text ops |
| `#N/A` | MATCH/XLOOKUP miss | Lookup tests |
| `#NUM!` | Invalid LOG/SQRT domain | Numeric tests |
| `#SPILL!` | **Not implemented** | Dynamic array defer |

### 3.4 Reference rewriting

Structural edits (`mutateSheetAxis`, insert/delete row/column) call `rewriteStructuralReferences` on formulas — required for serious work. Harness should assert `SUM(A2:B2)` survives row insert above row 2.

### 3.5 Array formulas and shared formulas

OOXML shared formulas and array formulas are **not modeled**. Cells may display cached values with PRESERVED formula parts. Do not claim recalculation parity until corpus exists.

### 3.6 Locale and date

Model uses `workbook.locale` and UTC date construction in `DATE()`. Excel locale (1904 date system, comma decimals) may differ — document tolerance in harness; school launch defaults to en-US style.

### 3.7 Calculation performance

Office harness: 200k cells open+edit+materialize ~5.2s (automated). Recalculation must stay off keystroke path (D20/I2): `calculateWorkbook` runs on derived state, not inline with Yjs writes. Interruptible recalc for manual mode is an implementation priority for large sheets.

### 3.8 Strict-native profile gating

`commandForBinding` supports `strictNative: { available: false, reason }` — use for:

- Adding worksheets to mounted XLSX (`XLSX_TOPOLOGY_UNSUPPORTED`)
- Import in linked workbook (like Document's import-a-copy prohibition)
- Commands whose mutations cannot be represented in backing OPC parts

---

## 4. Gap analysis vs contract

Reference: `WORKBAR-ARTIFACT-CAPABILITY-CONTRACT.md` §5 (Sheets feature map) and §8 (required evidence per capability).

### 4.1 Contract feature map coverage

| Contract area | Coverage | Gap |
|---|---|---|
| Range/cell formatting | **Strong** in model + format panel | Granular commands missing; borders/wrap missing |
| Number formats | **Shipped** (5 kinds) | Custom format strings not supported |
| Borders/fills | **Partial** (fill color) | Borders missing |
| Alignment/wrap | **Partial** (align) | Wrap missing |
| Row/column structural ops | **Shipped** | Hide/show, resize not commands |
| Freeze/hide/resize | **Partial** | Freeze shipped; hide/resize gaps |
| Sort/filter | **Shipped** (single-column sort, table filter) | Multi-column sort missing |
| Tables | **Partial** (Spectra tables) | Native ListObject authoring missing |
| Named ranges | **Shipped** | — |
| Validation | **Shipped** (3 kinds) | Native exotic rules PRESERVED only |
| Conditional formatting | **Partial** (Spectra rules) | Native CF authoring missing |
| Formula insertion + formula bar | **Partial** | Bar shipped; insert-function command missing |
| Charts | **Partial** (create + render) | Native chart edit; contextual tab commands |
| Comments/notes | **Partial** | Display/import; author command missing |
| Find/replace | **Partial** | Find only; replace missing |
| Sheet lifecycle | **Partial** | Reorder missing; add sheet blocked on mounted XLSX (correct) |
| View/zoom | **Partial** | Zoom commands; formula view missing |
| Import/export | **Shipped** with ADAPTED labeling | Must distinguish export vs Bridge materialization |
| Truthful formula compatibility | **Strong** | Lens/evaluator recognition mismatch |

### 4.2 Workbar taxonomy vs contract defaults

| Contract default (General) | Current workbar | Gap |
|---|---|---|
| Undo | `sheets.undo` essential | OK |
| Redo | `sheets.redo` essential | OK |
| Find | `sheets.find` essential | OK |
| Format | `sheets.format` essential | OK |
| Formula | — | **Missing default** — no Formula tab entry or General pin |
| Freeze | `sheets.freeze.rows` (not essential) | **Not in General**; freeze-columns advanced |
| Chart | `sheets.chart` essential (tab Insert inferred) | Contract wants General default |

### 4.3 Command protocol gaps (Phase 1 audit criteria)

| Criterion | Sheets status |
|---|---|
| Stable namespaced id | **PARTIAL** — bindings use short ids; `commandForBinding` namespaces to `sheets.*` |
| One execute path human + AI | **PARTIAL** — AI uses `operations/schema`; studio uses `onSelect` closures; must converge |
| Typed params + availability | **MISSING** for most — `Command<void>` only; no Zod params on bindings |
| Authority risk / undo | **PARTIAL** — inferred `risk: safe`; undo `yjs` |
| Choreography target | **PARTIAL** — `workbar-command` region id set in registry helper |
| Handler mounted | **YES** in studio | |
| Focused test | **WEAK** — `command-surface.test.ts` uses sheets examples only |
| Fixture per native write | **STRONG** for cell edit; **WEAK** for format/chart/validation |

### 4.4 Evidence gaps (contract §8)

Most shipped studio capabilities lack the full ten-point evidence record. Strongest existing evidence:

- `fixtures/office/xlsx/representative.xlsm` + `scripts/fidelity-harness/office.ts`
- `src/features/spectra/__tests__/xlsx-pptx-lens.test.ts`
- `src/features/spectra/__tests__/sheets-chart.test.ts`
- `src/features/spectra/__tests__/sheets-content-patch.test.ts`
- N5 `.shots/missions/N5/harness-report.json`

Missing: per-command human/AI execution tests, choreography-disabled parity, reload+Bridge matrix for each new command, strict-native disabled-with-reason screenshots.

### 4.5 STATE Field Note alignment

STATE (2026-08-22) records: "Document/Sheets/Presentation capability depth and default Workbar population still need a dedicated implementation pass." This inventory confirms Sheets **depth** is largely in the model/studio; **population and protocol completion** are the pass.

---

## 5. Implementation priorities

Ordered for Phase 4 implementation. Each item should land with command registration, default placement, availability, and at least one test; native writes need fixture assertions before strict-native enablement.

### P0 — Protocol completion (no new product surface)

1. **Register all existing `actions[]` bindings** as stable commands with documented `defaultPlacement`, migrate `onSelect` to shared `execute` accepting typed params where needed.
2. **Populate General defaults** per contract: pin Formula (opens formula bar / insert), Freeze rows, Chart; align with `WORKBAR-ARTIFACT-CAPABILITY-CONTRACT.md` §2 table.
3. **Contextual tabs:** When `selectionContext` is `Formula` or `Chart`, surface tab-specific commands (function library subset; chart type/title/range/delete).
4. **AI parity:** Map each manifest `sheets.*` operation to command id; ensure `availability` hides disabled ops for AI (C2).
5. **Capability matrix test** (Phase 1): generated or static test listing every `sheets.*` command with availability snapshot for `strict-native` + mounted XLSX fixture.

### P1 — Contract holes with existing model support

6. **`sheets.paste`** command (wire `pasteSelection`); **`sheets.merge` / `sheets.unmerge`** from format panel.
7. **`sheets.replace`** find-replace in sheet scope.
8. **`sheets.note.set`** — minimal note editor (Review tab).
9. **`sheets.chart.delete`**, **`sheets.chart.edit`** (title, range, type) on contextual Chart tab.
10. **`sheets.formula.insert`** — function picker wired to formula bar.

### P2 — Native fidelity promotions (fixture-first, Tier R)

11. **Align `XLSX_RECOGNIZED_FORMULAS` with evaluator** incrementally: promote SUMIF/COUNTIF family first with harness rows; document Excel tolerance.
12. **Merge cells XLSX write** — assert `mergeCells` in sheet XML after materialize.
13. **Freeze panes XLSX write** — assert `sheetViews` freeze state.
14. **Spectra conditional formatting → XLSX** only if safe dxf write proven; else keep Spectra-only with honest availability.
15. **Spectra data validation → XLSX** for list/number/checkbox kinds.

### P3 — Serious-editor tail (N7 W3 deferred)

16. Multi-column sort command.
17. Hide/unhide row/column commands.
18. Borders and wrap text formatting.
19. Sheet reorder.
20. Manual calculation mode + `calculate.now` command.
21. Paste-special semantics (values/formulas/formatting).

### P4 — Explicit deferrals (do not ghost)

| Feature | Action |
|---|---|
| Pivot table authoring | Stay PRESERVED; disable with reason |
| Macro execution | Stay PRESERVED; never execute |
| Native Excel chart edit | Placeholder + reason until chart part mutation exists |
| Dynamic arrays | UNSUPPORTED until modeled |
| External link editing | PRESERVED |
| Add sheet to mounted XLSX | `strictNative.available: false` with lens reason |

### P5 — Verification bundle (mission close)

- Extend `npm run fidelity:office` with rows for each P2 promotion.
- Browser pass: strict-native mounted gradebook fixture — screenshot disabled commands with reasons.
- AI pass: `set_formula`, `create_chart`, `sort_filter` via command dispatcher.
- Bridge pass: edit cell → materialize → reopen Excel → unrelated preserved features spot-check (`complex-preservation.xlsx`).

---

## Appendix A — Current workbar command bindings (code truth)

Source: `src/features/spectra/components/sheets-studio.tsx` `actions: CommandBinding[]` (2026-08-22).

| Binding id | Registry id | Inferred tab | Priority |
|---|---|---|---|
| undo | `sheets.undo` | General | essential |
| redo | `sheets.redo` | General | essential |
| format | `sheets.format` | General | essential |
| chart | `sheets.chart` | Insert | essential |
| find | `sheets.find` | General | essential |
| sort | `sheets.sort` | Data | default |
| filter | `sheets.filter` | Data | default |
| freeze-rows | `sheets.freeze.rows` | Data | default |
| freeze-columns | `sheets.freeze.columns` | Data | advanced |
| sort-descending | `sheets.sort.descending` | Data | advanced |
| name-range | `sheets.name.range` | Formula | advanced |
| validation | `sheets.validation` | Data | advanced |
| conditional | `sheets.conditional` | Format | advanced |
| insert-row | `sheets.insert.row` | Insert | advanced |
| insert-column | `sheets.insert.column` | Insert | advanced |
| delete-row | `sheets.delete.row` | Insert | advanced |
| delete-column | `sheets.delete.column` | Insert | advanced |
| copy | `sheets.copy` | General | advanced |
| clear | `sheets.clear` | General | advanced |
| zoom-in | `sheets.zoom.in` | General | advanced |
| zoom-out | `sheets.zoom.out` | General | advanced |
| sheet-new | `sheets.sheet.new` | Insert | advanced |
| sheet-rename | `sheets.sheet.rename` | Insert | advanced |
| sheet-delete | `sheets.sheet.delete` | Insert | advanced |
| import | `sheets.import` | Insert | advanced |
| export-xlsx | `sheets.export.xlsx` | Insert | advanced |
| export-csv | `sheets.export.csv` | Insert | advanced |
| export-ods | `sheets.export.ods` | Insert | advanced |

## Appendix B — XLSX fixture catalog

| Fixture | Purpose |
|---|---|
| `fixtures/office/xlsx/representative.xlsm` | SUM + XLOOKUP, macro, custom XML |
| `fixtures/office/xlsx/complex-preservation.xlsx` | Chart, table, diagram, image |
| `fixtures/office/xlsx/comments-preservation.xlsx` | Comments + VML |
| `fixtures/office/xlsx/active-x-preservation.xlsm` | ActiveX + charts |
| `fixtures/office/xlsx/pivot-preservation.xlsx` | Pivot (engine reject — do not promote) |
| Generated 200k cell workbook | Performance (`office.ts` harness) |

## Appendix C — Key code paths

| Path | Responsibility |
|---|---|
| `src/features/spectra/components/sheets-studio.tsx` | UI, workbar bindings, inspectors |
| `src/features/spectra/sheets/model.ts` | Semantic model, evaluator, normalization |
| `src/features/spectra/lenses/xlsx-lens.ts` | OPC projection, formula policy, materialize |
| `src/features/spectra/commands/registry.ts` | Tab inference, `commandForBinding` |
| `src/features/spectra/artifacts/registry.ts` | Manifest operations, schema v4 |
| `scripts/fidelity-harness/office.ts` | Tier R corpus runner |

---

*End of inventory. Implementation agent should treat SHIPPED studio behavior as source of truth when this doc and code diverge; update this file when promotions change fidelity classes.*
