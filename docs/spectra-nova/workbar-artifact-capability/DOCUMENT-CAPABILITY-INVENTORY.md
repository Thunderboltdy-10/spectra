# Document Capability Inventory

## P12.I7 authoritative post-P3 closure — 2026-08-31

**Named industry leader:** Microsoft Word for Microsoft 365 (desktop).

**Authority:** the capability IR and DOCX lens schemas on `reform/P12.I7`; this section supersedes every 2026-08-22 status, proposal, priority, and gap statement below.
**Closure rule:** `SHIP` means the operation is reachable through the IR and works in its declared profile; `REFUSE-HONESTLY` means strict-native shows the exact IR-owned sentence to both a person and the AI; `DEFER-WITH-OWNER` names work outside this bounded re-audit. There are no silent rows.

### Standing IR census

| Classification | Rows | Closure |
|---|---:|---|
| SHIP — DOCX lens writer | 39 | Each row names a delta imported from the DOCX lens schema. |
| SHIP — UI/read/export operation | 18 | These operations do not claim a native package write. |
| REFUSE-HONESTLY — no native delta | 46 | Exact Word-specific reason plus a next action; human and AI gates share it. |
| **Total** | **103** | Standing P12.I7 baseline; unchanged from the post-P3 census. |

### Microsoft Word family closure

| Classification | Capability families | IR rows | Product answer |
|---|---|---:|---|
| SHIP | Paragraph and safe table-cell text, existing styles, safe block insertion/removal, native materialization | 39 | Writes through the DOCX lens; untouched parts remain preserved. |
| SHIP | History, find/navigation, inspection, view chrome, comments surface, and copy/export actions | 18 | Works without claiming a native package delta. |
| REFUSE-HONESTLY | List numbering and promote/demote | 4 | Preserve the numbering; direct the user to Word. |
| REFUSE-HONESTLY | Import-copy boundary and new named-style definitions | 2 | Offer a separate copy or style creation in Word. |
| REFUSE-HONESTLY | Table structure | 11 | Text remains editable; rows, columns, merges, headers, and deletion stay in Word. |
| REFUSE-HONESTLY | Pictures and wrapping | 4 | Preserve image parts; direct image insertion/restyling to Word. |
| REFUSE-HONESTLY | Hyperlinks and cross-references | 3 | Preserve links; direct link changes to Word. |
| REFUSE-HONESTLY | Equations | 5 | Preserve Word equations; direct equation authoring to Word. |
| REFUSE-HONESTLY | Sections, page size/orientation/margins/columns | 5 | Preserve section properties; direct page setup to Word. |
| REFUSE-HONESTLY | Live Spectra reference | 1 | Offer unlinking or a normal Word link. |
| REFUSE-HONESTLY | Footnotes/endnotes, fields/TOC, headers/footers | 6 | Preserve native parts; name the corresponding Word action. |
| REFUSE-HONESTLY | Whole-document templates and revision resolution | 5 | Offer a separate import or accepting/rejecting changes in Word. |

### Deferred leader gaps with owners

| Field Note | Classification | Microsoft Word gap | Named later owner |
|---|---|---|---|
| P12.I7-WORD-1 | DEFER-WITH-OWNER | Tracked-changes authoring, revision navigation, and native review/comments parity | Orchestrator — future **Word Review native-authoring unit**, after P12.V2 |
| P12.I7-WORD-2 | DEFER-WITH-OWNER | Structural OOXML: tables, page sections, headers/footers, footnotes/endnotes, fields/TOC, and numbering definitions | Orchestrator — future **Word Structure package-writer unit**, after P12.V2 |
| P12.I7-WORD-3 | DEFER-WITH-OWNER | Rich objects: pictures/wrapping, hyperlinks/cross-references, and equation authoring | Orchestrator — future **Word Rich Objects package-writer unit**, after P12.V2 |
| P12.I7-WORD-4 | DEFER-WITH-OWNER | Mail merge, forms/content controls, and macro authoring beyond safe preservation | Orchestrator — future **Word Automation unit**; macro execution remains prohibited |

### Archaeology boundary

Everything below this line is the original 2026-08-22 pre-IR research record. It remains useful for historical evidence and leader-feature discovery, but its statuses, command wiring claims, gaps, and implementation priorities are **superseded and non-authoritative**.

**Scope:** Spectra Nova Document artifact — workbar, command registry, studio handlers, DOCX/OOXML fidelity, fixtures, and tests.  
**Generated:** 2026-08-22 (Composer 2.5 Explorer, Phase 3 research).  
**Sources:** `docs/spectra-nova/CANON.md`, `STATE.md`, `PLAYBOOK.md` §3–7, `ARCHITECTURE-*.md`, `missions/N7-serious-editors.md`, `missions/N8-ai-operates-spectra.md`, `WORKBAR-ARTIFACT-CAPABILITY-CONTRACT.md`, `WORKBAR-ARTIFACT-CAPABILITY-AGENT-PROMPT.md` (Phase 3), and codebase truth under `src/features/spectra/`.

---

## 1. Executive summary

### What exists and works

| Layer | State | Evidence |
|---|---|---|
| **Command protocol** | VERIFIED | `commandForBinding`, `ArtifactWorkbar`, `tabsFor`, account-synced `workbar` preferences (`src/features/spectra/commands/registry.ts`, `components/artifact-workbar.tsx`) |
| **Document tab taxonomy** | VERIFIED | `General · Insert · Format · Layout · References` + contextual `Equation · Table · Image` (`COMMAND_TABS.document`, `command-surface.test.ts`) |
| **DOCX lens (Tier R)** | VERIFIED (N4) | `@ariadng/office@0.3.0` behind `docx-lens.ts`; 16 fixtures / 101 harness assertions green (`npm run fidelity:docx` → `fixtures/office/docx/harness-report.json`) |
| **Native Yjs + projection** | VERIFIED | `Y.XmlFragment`, heading style repair, block ↔ TipTap round-trip (`document-native-projection.test.ts`, `document-adapter.ts`) |
| **Serious authoring surface** | PARTIAL | TipTap editor with tables, tasks, equations, citations, callouts, slash menu, find/replace panel, outline/sources rails, export copies |
| **AI manifest operations** | REGISTERED (namespaced) | 22 `document.*` ops in `artifacts/registry.ts` (e.g. `document.insert.blocks`, `document.format.blocks`) |
| **Strict-native gating** | PARTIAL | `strictNative` on individual `CommandBinding`s (templates, import); lens `capabilities()` for human/AI op sets |

### What is missing or misaligned

| Gap | Severity | Detail |
|---|---|---|
| **C1 violation — formatting bypasses registry** | BLOCKING | `RichTextFormatBar` (`artifact-studio.tsx`) and slash commands (`slash-command-extension.ts`) call TipTap directly; they are not `Command` records with shared `execute` for human + AI |
| **Contract General defaults unmet** | HIGH | Contract requires General pins: Find, Undo, Redo, Outline, Comments, Font, Size, Bold, Italic. Current General has Find + Outline only; Undo/Redo absent; Comments live in artifact shell overflow, not workbar; Font/Size absent entirely |
| **N7 Document depth (W2) largely undeferred** | HIGH | N7 mission log focused PPTX; STATE Field Note (2026-08-22) explicitly hands off Document workbar depth to this pass |
| **Lens ↔ editor semantic gap** | HIGH | Lens models paragraph/table/style deltas; editor models TipTap marks (bold, highlight, links) that do not map to OOXML runs on native materialization today |
| **Layout / References tabs empty shells** | MEDIUM | Workbar tabs exist but Insert/Format content is `RichTextFormatBar` children; Layout/References have no dedicated command rows beyond overflow placement |
| **Export/import vs sync path** | MEDIUM | Import copy uses mammoth/fflate/pdfjs (ADAPTED); export DOCX uses `docx` npm package — not lens materialization. Correct for "copy" but must stay fenced from Bridge sync (D25) |
| **Run-level formatting** | MEDIUM | No font family, font size, text color, or character-style commands; highlight uses fixed `#dff3ed` |
| **Page/section model** | HIGH | No page size, margins, columns, section breaks, editable headers/footers in UI or lens mutations |
| **References machinery** | MEDIUM | In-editor citations + bibliography rebuild exist; no Word bibliography/TOC/field authoring; DOCX bibliography parts PRESERVED only |
| **Review / tracked changes** | MEDIUM | `review` doc mode exists in types but no track-changes UI; lens preserves revision XML, blocks edits inside revised runs |
| **Tests for UI commands** | HIGH | Harness covers lens mutations; no capability-matrix test proving each workbar control maps to a registry id + execute |

### Bottom line

Spectra has a **trustworthy DOCX preservation substrate** and a **capable Spectra-native editor**, but the **product command surface for Document is shallow and split**: workbar bindings cover navigation/export/find; real formatting lives in a non-registry format bar and slash menu. Phase 3 must **register, unify, and fidelity-class every user-facing verb** before claiming N7 Document depth or contract completion.

---

## 2. Inventory matrix

**Legend — Status:** `EXISTS` = shipped behavior; `PARTIAL` = works but not registry-unified or incomplete native path; `PROPOSED` = required by contract/N7 but not implemented; `PRESERVED-ONLY` = honest read-only native feature.

**Format columns:** DOCX · DOCM · ODT · PDF — classes apply per format for the *native write* path when the feature mutates a linked file; Spectra-native work is NATIVE unless noted.

### 2.1 General tab — navigation, history, favorites

| Status | Capability | Semantic model | Command ID | Tab / Group | Formats (DOCX/DOCM/ODT/PDF) | Fidelity | Risks / gaps vs contract | Fixture / harness assertions |
|---|---|---|---|---|---|---|---|---|
| EXISTS | Find in document | TipTap doc scan → selection ranges | `document.general.find` | General / Navigate | all N/A (UI) | NATIVE (Spectra) | Bound via `CommandBinding` `find`; replace UI is separate panel, not `document.general.replace` | Unit: find pattern + selection; P1 browser |
| PARTIAL | Find and replace | Scoped text replace in `Y.XmlFragment` | `document.general.replace` | General / Navigate | all N/A | NATIVE | Replace UI exists (`replaceAllMatches`) but **no command id**; AI cannot invoke | Test: replace preserves block ids; harness N/A |
| EXISTS | Document outline | `content.outline[]` + heading scan | `document.general.outline` | General / Structure | all N/A | NATIVE | Works; not in contract default pin set order | `document.inspect.outline` AI op exists |
| PROPOSED | Undo | Yjs undo stack / collaboration undo manager | `document.general.undo` | General / History | DOCX: EQUIVALENT* · DOCM: EQUIVALENT* · ODT/PDF: N/A | EQUIVALENT | **Missing** from workbar; Presentation has undo. Collab disables StarterKit undo — need unified undo command | Test: undo restores prior block; F2 after undo materializes |
| PROPOSED | Redo | Inverse of undo | `document.general.redo` | General / History | same as undo | EQUIVALENT | **Missing** | Same as undo |
| PARTIAL | Comments panel | `artifactComments` threads anchored to regions | `document.general.comments` | General / Review | DOCX: PRESERVED · DOCM: PRESERVED · ODT/PDF: ADAPTED | PRESERVED (native comments parts) | Panel in `artifact-studio.tsx` header, **not workbar command**; Word comment parity not implemented | `comments.docx` part preservation XPath; P8 flow |
| PROPOSED | Pin: Bold | `marks.bold` on selection | `document.format.bold` | General (pinned) / Text | DOCX: **PROPOSED EQUIVALENT** (run `w:b`) · DOCM: same · ODT/PDF: N/A | EQUIVALENT | Contract default pin; today only in Format tab format bar | Harness: new `apply-bold` mutation changes only `document.xml` runs |
| PROPOSED | Pin: Italic | `marks.italic` | `document.format.italic` | General (pinned) / Text | DOCX: EQUIVALENT (`w:i`) | EQUIVALENT | Same C1 gap | Harness: `apply-italic` |
| PROPOSED | Pin: Font family | `marks.fontFamily` → `w:rFonts` | `document.format.fontFamily` | General (pinned) / Text | DOCX: EQUIVALENT · DOCM: EQUIVALENT | EQUIVALENT | **Not implemented** in TipTap extensions | Fixture: font-roundtrip.docx; part-level run assert |
| PROPOSED | Pin: Font size | `marks.fontSize` → `w:sz` | `document.format.fontSize` | General (pinned) / Text | DOCX: EQUIVALENT | EQUIVALENT | **Not implemented** | Fixture: font-roundtrip.docx |
| EXISTS | Word count (overflow) | Derived from editor text | — (display only) | Overflow / Status | N/A | N/A | Not a command; OK as chrome | — |

### 2.2 Format tab — character and paragraph

| Status | Capability | Semantic model | Command ID | Tab / Group | Formats | Fidelity | Risks / gaps | Fixture / assertions |
|---|---|---|---|---|---|---|---|---|
| PARTIAL | Text style (Normal, H1–H3) | Block type + `attrs.styleId` | `document.format.style` | Format / Styles | DOCX: NATIVE (`apply-style` delta) · DOCM: NATIVE | NATIVE | Works in editor; **not a registered command**; lens supports `apply-style` | Harness: `apply a style` on `complex-structure.docx` |
| PARTIAL | Bold / Italic / Underline / Strike | TipTap marks | `document.format.bold` etc. | Format / Text | DOCX: **gap — not in lens** | EQUIVALENT (target) | Direct TipTap; native materialization may drop marks | New harness mutations per mark |
| PARTIAL | Bullet / numbered list | `bulletList` / `orderedList` blocks | `document.format.list.bullet` · `document.format.list.numbered` | Format / Lists | DOCX: EQUIVALENT (`w:numPr`) · DOCM: EQUIVALENT | EQUIVALENT | Editor lists work; lens maps list paragraphs; multi-level numbering fixture exists but **no UI** | `multilevel-numbering.docx` preservation + edit unrelated paragraph |
| PROPOSED | Multi-level list | `attrs.listLevel`, `numId` | `document.format.list.multilevel` | Format / Lists | DOCX: EQUIVALENT | EQUIVALENT | N7 W2; fixture exists, no UI | `multilevel-numbering.docx` |
| PARTIAL | Text alignment | `textAlign` mark | `document.format.align` | Format / Paragraph | DOCX: **gap** | EQUIVALENT (target) | Left/center/right only; no justify | — |
| PARTIAL | Highlight | `highlight` mark fixed color | `document.format.highlight` | Format / Text | DOCX: **gap** | EQUIVALENT (target) | Fixed color only | — |
| PROPOSED | Text color | `textStyle.color` | `document.format.color` | Format / Text | DOCX: EQUIVALENT (`w:color`) | EQUIVALENT | Missing | font-roundtrip fixture |
| PROPOSED | Line spacing | `attrs.spacing` / `w:spacing` | `document.format.lineSpacing` | Format / Paragraph | DOCX: EQUIVALENT | EQUIVALENT | N7 W2 | — |
| PROPOSED | Paragraph spacing (before/after) | `w:spacing` | `document.format.paragraphSpacing` | Format / Paragraph | DOCX: EQUIVALENT | EQUIVALENT | Missing | — |
| PROPOSED | Indentation (left/right/first line) | `w:ind` | `document.format.indent` | Format / Paragraph | DOCX: EQUIVALENT | EQUIVALENT | Missing | — |
| PROPOSED | Borders and shading | `w:pBdr`, `w:shd` | `document.format.border` · `document.format.shading` | Format / Paragraph | DOCX: EQUIVALENT | EQUIVALENT | N7 W2 | — |
| PROPOSED | Named styles (apply/create) | `styles.xml` + `pStyle` | `document.format.namedStyle.apply` · `document.format.namedStyle.create` | Format / Styles | DOCX: NATIVE/EQUIVALENT | NATIVE | Lens applies known style ids; **no style gallery UI** | Harness `apply a style` |
| PARTIAL | Blockquote | `blockquote` node | `document.format.quote` | Format / Blocks | DOCX: EQUIVALENT | EQUIVALENT | Via format bar / slash | — |
| PARTIAL | Inline / block code | `code` mark / `codeBlock` | `document.format.code.inline` · `document.format.code.block` | Format / Blocks | DOCX: EQUIVALENT | EQUIVALENT | Present | — |
| PROPOSED | Clear formatting | Strip marks + reset para style | `document.format.clear` | Format / Text | DOCX: EQUIVALENT | EQUIVALENT | Missing | — |
| PROPOSED | Spell check | External or browser spellcheck surface | `document.review.spellcheck` | Format or Review | N/A | N/A | N7 "if cheap" — not started | — |

### 2.3 Insert tab

| Status | Capability | Semantic model | Command ID | Tab / Group | Formats | Fidelity | Risks / gaps | Fixture / assertions |
|---|---|---|---|---|---|---|---|---|
| PARTIAL | Insert table (3×3) | `table` block / `w:tbl` | `document.insert.table` | Insert / Tables | DOCX: NATIVE (top-level) · nested: PRESERVED | NATIVE / PRESERVED | TipTap `insertTable`; lens `edit-table-cell`; nested tables read-only | `complex-structure.docx` table cell edit; nested = read-only |
| PARTIAL | Table row/column | TipTap table commands | `document.insert.table.rowAfter` etc. | Insert or contextual Table | DOCX: **gap** (structural tbl edits) | EQUIVALENT (target) | UI in contextual Table tab; **not lens-backed** | New harness: insert row changes only `document.xml` |
| PROPOSED | Merge / split cells | `gridSpan`, `vMerge` | `document.table.merge` · `document.table.split` | Table (contextual) | DOCX: EQUIVALENT | EQUIVALENT | N7 W2 | — |
| PARTIAL | Insert image | `image` node base64 or asset ref | `document.insert.image` | Insert / Media | DOCX: **gap** (`w:drawing`) | EQUIVALENT (target) | Slash + file picker; no wrapping/positioning | `embedded-ole.docx` OLE preserved on unrelated edit |
| PROPOSED | Image wrap / position | `wp:anchor` / `wp:inline` | `document.image.wrap` | Image (contextual) | DOCX: EQUIVALENT | EQUIVALENT | N7 W2 | — |
| PARTIAL | Insert link | `link` mark | `document.insert.link` | Insert / Links | DOCX: EQUIVALENT (`w:hyperlink`) | EQUIVALENT | Format bar; not registered | — |
| PARTIAL | Insert equation (block) | `equation` node → OMML | `document.insert.equation` | Insert / Math | DOCX: NATIVE (OMML part) · DOCM: NATIVE | NATIVE | `equation-omml.docx` fixture; slash + format bar | `equation-omml.docx` harness rows |
| PARTIAL | Insert inline equation | `inlineEquation` | `document.insert.equation.inline` | Insert / Math | DOCX: NATIVE | NATIVE | Same | Same fixture |
| PARTIAL | Insert callout | `callout` node (Spectra) | `document.insert.callout` | Insert / Blocks | DOCX: EXTENSION / ADAPTED on export | EXTENSION | Spectra-native; strict-native should disable or fallback | strict-native availability test |
| PARTIAL | Insert horizontal rule | `horizontalRule` | `document.insert.divider` | Insert / Blocks | DOCX: EQUIVALENT | EQUIVALENT | Slash only | — |
| PARTIAL | Insert task list | `taskList` / `taskItem` | `document.insert.taskList` | Insert / Lists | DOCX: ADAPTED (no native checkbox) | ADAPTED | Spectra-native semantics | — |
| PARTIAL | Insert reference / embed | `spectraReference` / embed ops | `document.insert.reference` · `document.insert.embed` | Insert / Media | DOCX: EXTENSION | EXTENSION | Uses `reference.beginPicking` app command; `document.add.embed` manifest op | N8 authority + embed contract (N9) |
| PARTIAL | Insert citation | `spectraCitation` + `sources[]` | `document.insert.citation` | Insert / References | DOCX: ADAPTED (not Word bibliography) | ADAPTED / PRESERVED | In-editor citations; Word `customXml` bibliography PRESERVED | `bibliography-source.docx` |
| PROPOSED | Insert footnote / endnote | `footnotes.xml` / `endnotes.xml` | `document.insert.footnote` · `document.insert.endnote` | Insert / References | DOCX: **PRESERVED today** | PRESERVED → NATIVE (promotion) | Parts detected; **not editable** in Spectra | `footnotes-endnotes.docx`; promotion needs harness before UI |
| PROPOSED | Insert page break | `w:br type=page` | `document.insert.pageBreak` | Insert / Breaks | DOCX: EQUIVALENT | EQUIVALENT | Missing | — |
| PROPOSED | Insert section break | `sectPr` | `document.insert.sectionBreak` | Insert / Breaks | DOCX: PRESERVED → NATIVE | PRESERVED | Sections PRESERVED in N4 map | `section-headers-footers.docx` |
| PROPOSED | Insert caption | `SEQ` field or styled paragraph | `document.insert.caption` | Insert / References | DOCX: PRESERVED (fields) | PRESERVED | N7 W2 "where safe" | `fields-toc.docx` |
| PROPOSED | Insert TOC | `TOC` field | `document.insert.toc` | Insert / References | DOCX: PRESERVED | PRESERVED | Read-only native | `fields-toc.docx` XPath preservation |
| PROPOSED | Insert text box | `w:txbxContent` | `document.insert.textBox` | Insert / Objects | DOCX: PRESERVED | PRESERVED | `floating-textbox.docx` | Preservation on unrelated edit |
| PRESERVED-ONLY | SmartArt / OLE | Package parts | — | — | DOCX: PRESERVED | PRESERVED | Placeholders in UI | `smartart.docx`, `embedded-ole.docx` harness |

### 2.4 Layout tab

| Status | Capability | Semantic model | Command ID | Tab / Group | Formats | Fidelity | Risks / gaps | Fixture / assertions |
|---|---|---|---|---|---|---|---|---|
| EXISTS | Focus mode | UI chrome state | `document.layout.focus` | Layout / View | N/A | N/A | Works; local UI state | Tier P screenshot |
| EXISTS | Page vs continuous canvas | CSS layout mode | `document.layout.pageCanvas` | Layout / View | N/A | N/A | Spectra view only; not OOXML page model | — |
| EXISTS | Preview as reader | `docMode=read` | `document.layout.previewReader` | Layout / View | N/A | N/A | Works | P1 |
| PARTIAL | Apply template (notes/essay/lab) | Replace editor HTML | `document.layout.applyTemplate` | Layout / Templates | DOCX: **blocked strict-native** | ADAPTED | `strictNative` disabled with honest reason; maps to `document.apply.template` manifest op | command-surface.test.ts strict-native case |
| PROPOSED | Page size | `w:pgSz` | `document.layout.pageSize` | Layout / Page | DOCX: PRESERVED → NATIVE | PRESERVED | N7 W2 | `section-headers-footers.docx` |
| PROPOSED | Orientation | `w:pgSz orient` | `document.layout.orientation` | Layout / Page | DOCX: PRESERVED → NATIVE | PRESERVED | Missing | Same fixture |
| PROPOSED | Margins | `w:pgMar` | `document.layout.margins` | Layout / Page | DOCX: PRESERVED → NATIVE | PRESERVED | Missing | Same fixture |
| PROPOSED | Columns | `w:cols` | `document.layout.columns` | Layout / Page | DOCX: PRESERVED | PRESERVED | ARCHITECTURE-FIDELITY §8 | — |
| PROPOSED | Edit header / footer | `header*.xml` / `footer*.xml` | `document.layout.header` · `document.layout.footer` | Layout / Page | DOCX: PRESERVED (read) | PRESERVED → NATIVE | N7 promotion with fixtures first | `section-headers-footers.docx` |
| PROPOSED | Print | Print CSS / PDF | `document.layout.print` | Layout / Export | PDF: ADAPTED | ADAPTED | `window.print()` exists as advanced overflow, not Layout group | — |

### 2.5 References tab

| Status | Capability | Semantic model | Command ID | Tab / Group | Formats | Fidelity | Risks / gaps | Fixture / assertions |
|---|---|---|---|---|---|---|---|---|
| EXISTS | Sources navigator | `content.sources[]` + citation scan | `document.references.sources` | References / Sources | N/A | NATIVE | Secondary/advanced workbar; good | `document.check.sources` manifest op |
| PARTIAL | Insert bibliography section | Rebuild `bibliography` block from citations | `document.references.bibliography.insert` | References / Bibliography | DOCX: ADAPTED vs Word bib | ADAPTED | Spectra bibliography; Word sources PRESERVED | `bibliography-source.docx` |
| PROPOSED | Citation style | `bibliographyStyle` enum | `document.references.citationStyle` | References / Bibliography | DOCX: ADAPTED | ADAPTED | Schema has `numeric` / `author_date` | — |
| PROPOSED | Cross-reference | `REF` field | `document.references.crossRef` | References / Links | DOCX: PRESERVED | PRESERVED | N7 W2 read/insert where safe | `fields-toc.docx` |
| PROPOSED | Manage sources | CRUD `sources[]` | `document.references.source.add` etc. | References / Sources | N/A | NATIVE | Partial via citation UI | — |

### 2.6 Review, import/export, native bridge

| Status | Capability | Semantic model | Command ID | Tab / Group | Formats | Fidelity | Risks / gaps | Fixture / assertions |
|---|---|---|---|---|---|---|---|---|
| PARTIAL | Import a copy | mammoth / fflate / pdfjs → TipTap | `document.import.copy` | Layout (advanced) | DOCX/ODT/PDF: **ADAPTED** | ADAPTED | Correctly fenced; `strictNative` disabled; quarantine path exists | Import job API tests |
| PARTIAL | Export Word copy | `docx` npm generation | `document.export.docx` | Overflow / Export | DOCX: ADAPTED | ADAPTED | Not lens; lossy; OK for "copy" label | — |
| PARTIAL | Export PDF/HTML/MD/TXT | jspdf / HTML / markdown | `document.export.pdf` etc. | Overflow / Export | PDF: ADAPTED | ADAPTED | jsPDF plain text only | — |
| EXISTS | Download native copy / materialize | Bridge + `docxLens.materialize` | `app.native.download` · `app.native.materialize` | Artifact overflow menu | DOCX/DOCM: NATIVE lens path | NATIVE | In `artifact-studio.tsx`, not document workbar | F2, F3 flows; harness |
| PRESERVED-ONLY | Tracked changes view | Revision XML | `document.review.trackChanges.show` | References or Review | DOCX: PRESERVED | PRESERVED | Lens blocks edits in revised runs | `tracked-changes.docx` |
| PROPOSED | Accept / reject revisions | `w:ins`/`w:del` resolution | `document.review.trackChanges.accept` | Review | DOCX: PRESERVED | PRESERVED until promoted | Lens `capabilities()` disables | Promotion needs fixture-first |
| PROPOSED | Update fields | Field refresh | `document.review.updateFields` | References | DOCX: PRESERVED | PRESERVED | Lens disables in strict-native | `fields-toc.docx` |
| PARTIAL | Native feature notice | `nativePlaceholders[]` | — | UI banner | DOCX: PRESERVED | PRESERVED | Dismissal persisted per artifact (N6) | `.shots/missions/N6/` |
| UNSUPPORTED | Password-protected DOCX | — | — | — | DOCX: UNSUPPORTED | UNSUPPORTED | Honest fallback | `password-protected.docx` harness |
| UNSUPPORTED | Corrupt DOCX | — | — | — | DOCX: UNSUPPORTED | UNSUPPORTED | Bytes unchanged | `corrupt.docx` harness |

### 2.7 Contextual tabs

| Status | Capability | Command ID | Tab | Formats | Fidelity | Notes |
|---|---|---|---|---|---|---|
| PARTIAL | Table tools | `document.table.*` | Table | DOCX: partial | EQUIVALENT target | Row/col/delete only |
| PARTIAL | Equation tools | `document.equation.edit` | Equation | DOCX: NATIVE | NATIVE | No dedicated contextual commands — reuse insert |
| PROPOSED | Image tools | `document.image.*` | Image | DOCX: gap | EQUIVALENT | Selection sets contextual tab but **no Image tab content** |
| — | Equation tab activation | — | Equation | — | — | `selectionContext` maps `math`/`equation` |

### 2.8 AI manifest operations (registered, not workbar)

These are namespaced in `artifacts/registry.ts` and intended for AI/tooling — each needs a matching human command + execute during Phase 3:

| Manifest ID | Maps to proposed command | Native write? |
|---|---|---|
| `document.inspect.outline` | `document.general.outline` (read) | No |
| `document.inspect.blocks` | read-only | No |
| `document.inspect.selection` | read-only | No |
| `document.insert.blocks` | block insert pipeline | Yes (lens paragraph insert) |
| `document.rewrite.blocks` | selection rewrite | Yes |
| `document.move.blocks` | block reorder | Yes (risk: index vs paraId) |
| `document.split.block` | split | Yes |
| `document.merge.blocks` | merge | Yes |
| `document.format.blocks` | format marks/styles | Yes (partial today) |
| `document.create.table` | `document.insert.table` | Yes |
| `document.edit.table.cell` | lens `edit-table-cell` | Yes |
| `document.insert.equation` | `document.insert.equation` | Yes (OMML) |
| `document.insert.callout` | `document.insert.callout` | Spectra-only |
| `document.add.citation` | `document.insert.citation` | ADAPTED |
| `document.add.embed` | `document.insert.embed` | EXTENSION |
| `document.summarize` | AI-only summary | No |
| `document.apply.template` | `document.layout.applyTemplate` | ADAPTED / blocked strict |
| `document.check.accessibility` | AI audit | No |
| `document.check.sources` | AI audit | No |
| `document.check.layout` | AI audit | No |
| `document.prepare.export` | export pipeline | ADAPTED |
| `document.validate` | schema validate | No |

### 2.9 Slash commands (unregistered — must migrate)

All items in `SLASH_COMMANDS` (`slash-command-extension.ts`) need `document.insert.*` or `document.format.*` ids:

`heading1–3`, `bullet`, `numbered`, `todo`, `quote`, `code`, `equation`, `divider`, `table`, `image`, `reference`, `callout-info|warning|tip`.

---

## 3. Word OOXML research notes

### 3.1 Engine and mutation contract

- **Engine:** `@ariadng/office@0.3.0` (MIT), selected per N4 addendum (`ARCHITECTURE-FIDELITY` §7).
- **Mutation rule:** Only dirty parts re-serialize; untouched OPC parts byte-identical (`comparePackages` in harness).
- **Modeled part:** `/word/document.xml` only for semantic edits today.
- **Preserved parts:** footnotes, endnotes, headers, footers, comments, customXml, embeddings, diagrams (SmartArt), vbaProject.bin, unknown extensions — detected in `docx-lens.ts` `partRule()` and fidelity map.

### 3.2 Semantic deltas (lens API)

```ts
// src/features/spectra/lenses/docx-lens.ts — DocxSemanticDelta
replace-paragraph | edit-table-cell | insert-paragraph | apply-style | ai-edit(operations[])
```

**Projection block types:** `paragraph | heading | list | table` with `attrs.styleId`, `nativeReadOnly`, `paragraphIndex`, list metadata.

**Read-only paragraph detection:** Presence of `ins`, `del`, `fldChar`, `instrText`, `sdt`, etc. → `nativeReadOnly: true` → `DOCX_REGION_READ_ONLY` on mutate.

### 3.3 Part-level mutation patterns (implementation targets)

| Feature | OOXML location | Current Spectra handling | Promotion path |
|---|---|---|---|
| Body text | `word/document.xml` `w:p` / `w:r` | NATIVE replace/insert | Add run-level marks (`w:rPr`) |
| Paragraph style | `w:pPr/w:pStyle` | NATIVE `apply-style` | Style gallery UI |
| Lists | `w:numPr` | EQUIVALENT projection | Multi-level UI + `multilevel-numbering.docx` |
| Tables (top-level) | `w:tbl` | NATIVE cell text edit | Row/col/merge → tbl mutations |
| Nested tables | `w:tbl` nested | PRESERVED read-only | Fixture-first promotion |
| Fields / TOC | `fldChar`, `instrText` | PRESERVED | No edit; optional refresh later |
| Tracked changes | `w:ins`, `w:del`, … | PRESERVED | Safe insert outside runs only |
| Content controls | `w:sdt` | PRESERVED | `content-controls-customxml.docx` |
| Text boxes | `w:txbxContent` | PRESERVED | `floating-textbox.docx` |
| OMML equations | `m:oMath` | NATIVE (fixture) | `equation-omml.docx` |
| Bibliography | `/customXml/item*.xml` | PRESERVED | `bibliography-source.docx` |
| Sections | `w:sectPr` | PRESERVED | `section-headers-footers.docx` |
| Macros | `vbaProject.bin` | PRESERVED, never executed | `macro-enabled.docm` |

### 3.4 Unsupported OOXML preservation (harness proof)

Harness mutations per fixture (from `harness-report.json`):

1. **no-op open+save** → `round-trip preservation`, `changedParts: []`
2. **edit one paragraph** → `mutation safety`, `changedParts: ["word/document.xml"]`
3. **edit a table cell** → NATIVE or `unsupported-read-only` (fixture-dependent)
4. **insert a paragraph** → `mutation safety`
5. **apply a style** → `mutation safety`
6. **AI edit via operations** → `mutation safety`, lens-valid op bundle

**XPath / feature spot-checks** (N4 STATE): fields, tracked changes, transitions (PPTX analog), preserved placeholders across three unrelated edits.

**Collateral rewrite forbidden:** `verifyOutput()` throws if any changed part outside allowlist (default `{word/document.xml}`).

### 3.5 Spectra editor ↔ OOXML gap (critical)

| Editor concept | Yjs / TipTap | DOCX lens today |
|---|---|---|
| Bold, italic, underline | marks | **Not materialized** |
| Font family / size | not modeled | **Not materialized** |
| Highlight | mark | **Not materialized** |
| Link | mark | **Not materialized** |
| Heading | block + styleId | NATIVE via style |
| Table structure ops | TipTap commands | **Text only** in lens |
| Images | base64 node | **Not in lens** |
| Equations | LaTeX node | OMML path in fixture |

**Risk:** Users edit in Spectra; Bridge materialization via lens may **drop unmodeled marks** even when body paragraphs sync — violates D25 if those marks existed in native runs. Mitigation: either model runs in lens, or fence marks as Spectra-only until mappable.

---

## 4. Gap analysis vs WORKBAR-ARTIFACT-CAPABILITY-CONTRACT

| Contract § | Requirement | Current state | Gap |
|---|---|---|---|
| §1 Shared semantic model | One `execute` per command; human = AI | Format bar + slash bypass registry | **C1 violation** — highest priority |
| §2 Workbar defaults | Document General: Find, Undo, Redo, Outline, Comments, Font, Size, Bold, Italic | Find, Outline only | **5/8 defaults missing** |
| §2 Contextual tabs | Equation, Table, Image | Table partial; Image empty | Image tab shell only |
| §3 Classifications | Per-format NATIVE/EQUIVALENT/PRESERVED/ADAPTED/UNSUPPORTED | Lens map strong; UI commands unclassified | Need per-command fidelity metadata |
| §4 Document feature map | Styles, layout, refs, review, tables, images, equations, … | ~40% Spectra-native; ~25% lens-backed; rest missing or PRESERVED-only | N7 W2 largely open |
| §7 AI + Bridge | Commands eligible after registry + authority | AI DOCX materialization verified (N8); UI commands not in registry | AI cannot format via toolbar parity |
| §8 Evidence per capability | 10-point checklist per command | Harness for lens only | No capability matrix test file |
| §9 Cut line | No ghost controls | Export/import honest; some advanced work | Format controls imply native parity they lack |

**STATE Field Note (2026-08-22):** *"shared protocol is ready, but Document/Sheets/Presentation capability depth and default Workbar population still need a dedicated implementation pass."* — **confirmed** for Document.

**N8 handoff:** AI plane closed; editor depth explicitly deferred to this work (`missions/N8-ai-operates-spectra.md` log).

---

## 5. Recommended implementation priorities

Ordered for dependency and contract closure. Each item should land with: registry entry, workbar placement, focused test, and harness row if native write.

### P0 — Protocol integrity (block everything else)

1. **Extract `documentCommandRegistry`** — single module registering all document commands with `execute` calling typed operations → Yjs → optional lens delta queue.
2. **Migrate `RichTextFormatBar` controls** to registry commands; bar becomes pure renderer (props: `commands[]` or context).
3. **Migrate slash commands** to same ids (`document.insert.*`).
4. **Add `command-surface-capability-matrix.test.ts`** — every binding in `document-studio` workbar actions resolves to registered id; no orphan `onSelect` closures.
5. **Wire manifest ops** (`document.format.blocks`, etc.) to same execute functions AI uses.

### P1 — Contract General tab + undo

6. Register and pin: **Undo, Redo, Comments, Bold, Italic** (+ Font, Size when extensions exist).
7. Implement **collaboration-safe undo** command (Yjs UndoManager or custom stack).
8. **`document.general.comments`** toggles same panel as artifact shell (D41 — one component).

### P2 — Native parity for first-hour writing (N7 W2 core)

9. **Run-level formatting in lens** — bold/italic/underline/color/font → `w:rPr` mutations; harness fixtures `font-roundtrip.docx` (new).
10. **List depth** — multi-level UI + `multilevel-numbering.docx` assertions.
11. **Table structure** — insert/delete row/col, merge/split with tbl-level mutations; extend harness beyond cell text.
12. **Find/replace as commands** — `document.general.find`, `document.general.replace` with scoped params (AI parity).

### P3 — Layout and references (fixture-first promotions)

13. **Page layout** — size/orientation/margins; promote from PRESERVED using `section-headers-footers.docx`.
14. **Headers/footers editable** — only after harness proves part-level safety.
15. **Footnotes/endnotes insert** — `footnotes-endnotes.docx` promotion.
16. **Image insert to DOCX** — drawingML path; wrap contextual tab.

### P4 — Review, export honesty, Image contextual

17. **Track changes** — read-only view + honest disable accept/reject (or promote with `tracked-changes.docx` suite).
18. **Re-label export paths** — ensure UI never implies sync; ADAPTED badges on export/import commands.
19. **Image contextual tab** — wrap, alt text, size.
20. **Spell check** — if cheap (browser or service), else Field Note.

### P5 — Evidence gate (mission close)

21. Regenerate `fixtures/office/docx/harness-report.json` with new mutations.
22. Update STATE Document fidelity table for each promotion.
23. Tier P screenshots: strict-native disabled reasons, General pins, contextual tabs, 40-page density doc.
24. F2/F3 re-verify on deepened editor.

### Explicit deferrals (honest PRESERVED)

- SmartArt authoring, OLE editing, macro authoring, VBA execution
- Accept/reject revisions until fixture proof
- TOC field authoring (insert frozen field → PRESERVED)
- ODT/PDF as live sync formats (import/export ADAPTED only)

---

## Appendix A — Key file paths

| Area | Path |
|---|---|
| Document studio + workbar actions | `src/features/spectra/components/document-studio.tsx` |
| Shared format bar (needs registry migration) | `src/features/spectra/components/artifact-studio.tsx` (`RichTextFormatBar`) |
| Workbar renderer | `src/features/spectra/components/artifact-workbar.tsx` |
| Command registry helpers | `src/features/spectra/commands/registry.ts` |
| DOCX lens | `src/features/spectra/lenses/docx-lens.ts` |
| Lens API route | `src/app/api/spectra/lenses/docx/route.ts` |
| Slash commands | `src/features/spectra/editor/slash-command-extension.ts` |
| Manifest operations list | `src/features/spectra/artifacts/registry.ts` (document ops) |
| DOCX harness | `scripts/fidelity-harness/docx.ts` |
| Harness report | `fixtures/office/docx/harness-report.json` |
| DOCX fixtures (16) | `fixtures/office/docx/*.docx` + `*.fixture.json` |
| Lens tests | `src/features/spectra/__tests__/docx-lens.test.ts` |
| Projection tests | `src/features/spectra/__tests__/document-native-projection.test.ts` |
| Command surface tests | `src/features/spectra/__tests__/command-surface.test.ts` |
| Contract | `docs/spectra-nova/WORKBAR-ARTIFACT-CAPABILITY-CONTRACT.md` |

## Appendix B — DOCX fixture catalog

| Fixture | Marquee content | Expected class (sidecar) |
|---|---|---|
| `complex-structure.docx` | nested tables, notes, footer | tables NATIVE/PRESERVED; notes/footer PRESERVED |
| `bibliography-source.docx` | Word bibliography customXml | bibliography PRESERVED |
| `tracked-changes.docx` | revision marks | PRESERVED |
| `fields-toc.docx` | TOC fields, multilingual | fields PRESERVED |
| `equation-omml.docx` | OMML | NATIVE |
| `footnotes-endnotes.docx` | notes parts | PRESERVED |
| `section-headers-footers.docx` | section layout | headers/footers PRESERVED |
| `multilevel-numbering.docx` | list defs | EQUIVALENT target |
| `floating-textbox.docx` | text boxes | PRESERVED |
| `content-controls-customxml.docx` | SDT + customXml | PRESERVED |
| `embedded-ole.docx` | OLE embeddings | PRESERVED |
| `smartart.docx` | diagrams | PRESERVED |
| `macro-enabled.docm` | VBA container | PRESERVED / never executed |
| `unknown-extension.docx` | extension parts | PRESERVED |
| `password-protected.docx` | encryption | UNSUPPORTED |
| `corrupt.docx` | truncated zip | UNSUPPORTED |

---

*End of inventory. Implementation agent should treat PROPOSED rows as the Phase 3 backlog and EXISTS/PARTIAL rows as migration sources — not as permission to skip registry unification.*
