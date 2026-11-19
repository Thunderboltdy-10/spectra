# Document ↔ Word: upgrade plan

The Document artifact is where Spectra is used about 95% of the time: quick notes, grid worksheets, lab reports, research papers and the Extended Essay. It has to look like the paper it will be handed in on, and its sync with Word has to be something Pablo stops thinking about.

This plan comes from three kinds of work:
- reading the editor, the DOCX lens, the projection, the merge, the Yjs adapter, the gateway, sync orchestration and Convex;
- running copies of Pablo's real documents through the real pipeline (lens → editor schema → Yjs → lens), never the originals;
- rendering those documents in the real editor and comparing them page by page with PDFs that Word itself produced.

Every finding was reproduced. Numbers are measured, not estimated.

## In one page

Today Spectra imitates a Word document instead of modelling one. Four design choices cause almost every problem Pablo has hit:

1. **Resolved formatting is stored as if it were direct formatting.** Every run carries its final font, size and colour, while the editor knows nothing about styles. Anything new (typing on a fresh line, a paste, an AI insertion, a list item) falls back to Spectra's own Figtree prose CSS. This is the "new writing is in a different font" complaint, and it also causes the readback failures that stop sync.
2. **The block mirror flattens Word's structure.** A table cell is stored as a string joined with `\n`, and a Word list is one block. Edits inside cells and lists can't be expressed as Word operations, so they fail or corrupt.
3. **A Word update rewrites the whole Yjs document.** The adapter compares nodes with key-order-sensitive JSON. Once the editor has touched a document, every reconcile from Word deletes and reinserts every node. For EE 5 that is 913 of 913 nodes and a 587 KB update for one typed sentence. Cursors, undo history and comment anchors are lost, and Convex pays for it.
4. **The page is drawn by Spectra's prose stylesheet, not by the document.** Margins snap to three presets, unknown paper falls back to A4, headers are plain text, page breaks never split a paragraph or a table, and the fonts Word uses are never loaded.

The plan replaces those four choices:

| Today | After |
| --- | --- |
| Resolved formats on every run | **Direct formatting plus the document's style catalogue**, rendered by the editor |
| Flat block mirror | **One region per Word paragraph**, wherever it lives: body, table cell, list item, note, header |
| Delete and reinsert nodes | **Minimal Yjs updates** (`updateYFragment` after aligning nodes by id) with semantic equality |
| Prose CSS on preset pages | **A page renderer driven by the document**: exact paper and margins, its fonts, its spacing, line-accurate page breaks, real headers and footers |

On top of that come a server outbox (Word gets every change without an open tab), merges inside a paragraph, captions, cross-references, TOC, Word charts, real equation editing, a Word file for documents created in Spectra, and a projection about a third of today's size.

Bridge ↔ Convex messages don't change, so every installed Bridge keeps working.

## How it was tested

The corpus was copied into the session scratchpad from IBDP1. The originals were never opened for writing.
- Maths EE 5: 1.3 MB, 913 blocks, 942 equations, 68 pages in Word.
- Maths IA 2 and the IA figures document: 295 equations, 23 Word charts.
- Physics IA 4, Econ IA 1, the CAS portfolio, the TOK exhibition.
- A French fill-in worksheet: 3 pages, 4 tables, images in cells.
- The repo's `tests/fixtures/docx` and a generated EE-style essay.

Five probes, all now deleted from the repo:
1. **Round trip:** lens → editor JSON through the real schema → blocks → diff against the base, then seven scripted edits, each mutated, reopened and read back.
2. **Word:** every probe output opened in real Word through COM and saved as PDF, to check that Word accepts it and to compare layouts.
3. **Yjs churn:** the size and node count of the update produced when a Word revision is applied to a live room, on a fresh room and on one the editor has written to.
4. **Render:** the real editor extensions and Spectra's built CSS in a standalone page, with screenshots compared against the Word PDFs.
5. **Export and size:** `exportDocxCopy` on native and Word documents, reopened in Word; projection, editor JSON and Yjs state sizes per document.

## What the probes showed

### Urgent: data loss

1. **Images next to text are deleted from Word.**
   - `NativeDocxImage` defaults `assetId` to `""`, and `imageFromJsonNode` (`shared/document-projection.mjs:775`) rejects an empty `assetId`. The image drops out of the blocks and the diff emits `delete-image`.
   - An image alone in its paragraph takes another path and survives, which is why tests missed it.
   - TOK exhibition: any save removes the figure. French worksheet: every save fails readback, so the document never syncs again.
2. **Enter in a Word list merges items in Word.**
   - Each Word list item is a one-item list node. Enter adds a second item to that node, but `documentBlocksFromJson` turns a list node into one block with the items' text concatenated.
   - Word receives "Rate rises up to an optimumNew list item" as one item. It passes readback because the request itself is wrong.

### Round-trip results per document

| Document | Typed edit | Plain append | Table cell | List Enter | Notes |
| --- | --- | --- | --- | --- | --- |
| Maths EE 5 | ok | **fails** | **fails** | **corrupts** | numbered H1–H3 import as list items; 53 TOC lines read-only |
| Maths IA 2 | ok | ok | **fails** | – | 6 charts show as "Embedded Office object" |
| Maths IA figures | ok | ok | **fails** | – | 17 charts are placeholders; 18 captions read-only |
| Physics IA 4 | ok | **fails** | **fails** | **corrupts** | numbered headings as lists |
| Econ IA 1 | ok | **fails** | – | – | |
| French worksheet | **fails** | **fails** | **fails** | **fails** | an image in a table is dropped on every save |
| TOK exhibition | ok* | **fails** | – | – | *a save deletes an image from Word |

Across the corpus, 84 of 87 table-cell edits and 68 of 94 new list items failed. An untouched round trip is clean (zero operations) on every file without inline images, so opening a document never rewrites it.

### Sync and Yjs

| Finding | Evidence | Effect |
| --- | --- | --- |
| **A Word reconcile rewrites the whole document** once the editor has written to the room | EE 5: 913/913 top-level nodes deleted and reinserted, 587 KB update, for one typed sentence. Re-applying *identical* content to a fresh room still rewrites 123 nodes (67 KB) | Lost cursors, undo and comment anchors; a 587 KB append in Convex; collaborators' selections jump |
| Cause: equality is JSON text | `adoptProjectionFragment` and `applyProjection` compare with `JSON.stringify`. Mark `attrs: {}` vs `undefined` and attribute key order make equal nodes differ (EE 5: 123 nodes) | As above |
| Cause: node replacement | Formatted paragraphs are deleted and reinserted; only unformatted ones get a text splice | As above |
| A fix measured | y-prosemirror's `updateYFragment` after aligning by block id: EE 5 identical content → **67 bytes**; essay with real Word edits → 12 KB instead of 15 KB, touching only the changed paragraphs | |
| False merge conflicts | `mergeThreeWay`'s `defaultEqual` compares `nativePath` and `ommlXml`, which change without the user changing anything | Conflicts the user can't explain |
| Sync to Word needs an open tab | `materialize` is driven by the client (`nativeLiveNeedsPromotion`) | Close the tab, or let the AI edit, and Word never gets the change |
| Any concurrent edit is a whole-document conflict | `commitPayloadUpload` marks the replica `diverged` whenever the cloud moved since the replica base | Edits in different paragraphs on both sides still interrupt the user |
| Writes are slow on equation-heavy documents | Mutate, reopen and digest take 2.2 s for EE 5 and 7.1 s for the TMUA booklet | Slow saves; retries multiply server load |

### Formatting and fonts

| Finding | Evidence | Effect |
| --- | --- | --- |
| **New text takes Spectra's font, not the page's** | Pressing Enter at the end of an EE 5 paragraph gives Figtree 15 px, left-aligned, next to STIX Two Text 16 pt justified (`typed-new-paragraph.png`). The prose CSS (`--prose-font`, `--prose-gap: 0.75em`, line-height 1.65, display-font headings) is never overridden by the document | The "new font" complaint |
| Theme fonts never load | `loadThemeFonts` is never called, so Aptos/Calibri through the theme resolve to no font | Modern Word documents render in Figtree |
| Paragraph-mark formatting lands on the text | French worksheet: list items whose paragraph mark is bold render fully bold | Visibly wrong |
| Spurious borders | A paragraph with `w:pBdr` from its style renders a box Word doesn't draw | Visibly wrong |
| Styled-paragraph writes fail readback | Text appended without marks to a styled paragraph reopens with the style's font and size, so the check throws `DOCX_READBACK_MISMATCH` | Sync stops with an error the user can't fix |
| Readback is a pile of exceptions | `INHERITED_RUN_FORMAT`, `STYLE_RUN_FORMAT` (headings only), a sparse defaults table | Fails legitimate edits, can pass wrong ones |
| Localised styles aren't recognised | Spanish Word `Ttulo1`/`Ttulo2`: 605 headings import as paragraphs | No outline; a new heading creates a second "Heading 1" |
| **Numbered headings import as list items** | EE 5, Physics IA: outline-numbered `Heading1`–`3` become list blocks | No outline or navigation; the TOC can't be rebuilt |
| Heading levels stop at 3 | StarterKit `levels: [1,2,3]`, regex `Heading([1-3])` | EE H4s import as paragraphs |
| The fallback fonts are named but never loaded | `SHARED_FONT_STACKS` lists Carlito, Caladea, Liberation Serif; no `@font-face` exists. STIX Two Text renders only because it is installed on Pablo's laptop | On any other device, documents fall back to whatever serif the OS has, and line breaks move |

### Structure

| Finding | Evidence |
| --- | --- |
| Table cells are strings | `cellInline` and the block mirror join cell paragraphs with `\n`; formatting, equations and images inside cells can't be edited as Word operations |
| Lists are one block | Item edits, nesting and new items can't be addressed per Word paragraph |
| Page breaks import as empty lines, nesting is flat, list start values are lost, merged cells come back as plain grids | `FEEDBACK.md` 2026-11-18 known limits, reconfirmed |
| Captions, TOC and cross-references are read-only | `SEQ`, `TOC` and `REF` fields lock the whole paragraph |
| Word charts are placeholders | 27 DrawingML charts across three IAs show "Embedded Office object"; Word stores no preview image for them |
| A paragraph holding only `m:oMath` imports as inline | Display equations look inline |
| The editor schema drops equation attributes | `inlineEquation` has no `display`, `ommlXml` or `ommlSourceLatex`; OMML survives only through a latex-match heuristic that can swap two equal equations |
| `ns1:` prefix on `w14:paraId` | New paragraphs declare their own namespace prefix |

### Equations

| Finding | Evidence |
| --- | --- |
| OMML → LaTeX emits raw `〈 〉` | KaTeX can't parse them; inner products in EE 5 render as errors |
| LaTeX → OMML misplaces limits | `\int_0^1 f` writes the limits on `f`, not on the integral (`m:nary` not used) |
| "Bridge equations aren't editable" | Native equations open read-only when the latex round trip isn't exact; the user can't edit them at all |
| OMML dominates the room | `ommlXml` is 235 KB of EE 5's 562 KB editor JSON (42%), and it is in Yjs, so every client syncs it |

### Page view against Word

The render probe drew EE 5 and the French worksheet in the real editor and compared them with Word's PDFs.

| Finding | Evidence |
| --- | --- |
| Pages don't match | EE 5: 61 sheets in Spectra vs 68 pages in Word. `PageFlow` only inserts gaps before whole top-level blocks: it never splits a paragraph or a table, so pages run long, then short |
| The French worksheet's table moves to page 2 | Prose spacing (0.75 em gaps, 1.65 line-height) inflates every line |
| Paper and margins snap to presets | `pageSetupFromDocument` rounds to narrow/normal/wide, unknown sizes become A4 |
| Headers and footers are plain text | Small, left-aligned, in Figtree, no page numbers |
| Tables draw a full grid with tall rows | Word's booktabs-style tables (top and bottom rules only) render as boxed grids |

### Export and documents created in Spectra

| Finding | Evidence |
| --- | --- |
| Exported body is Aptos while Spectra shows Figtree | `exportDocxCopy` starts from `Document.create()` with no styles |
| Title, Subtitle and Quote styles are lost; TOC becomes plain text | Mapped to direct formatting |
| Images without an asset are dropped; cells have no padding | Probe export reopened in Word |
| Documents created in Spectra never get a Word file | `new-works-to-disk.tsx`: "Native Spectra documents have no file form" |

### Convex

| Finding | Evidence |
| --- | --- |
| Stored `blocks` are 1.5–1.9× the editor JSON | EE 5: 842 KB blocks vs 562 KB editor JSON; CAS portfolio 490 KB vs 262 KB |
| 12 documents exceed 300 KB | Close to the gateway's 900 KB bound for the Maths EEs |
| Checkpoints rewrite everything | After 30 s idle the gateway replays the room and writes the full projection (up to ~850 KB) even when one word changed |
| The replica base sits on every replica row | `workReplicas.projectionBaseContent` is read by every replica list and sync query |

## Principles

1. **Word's model, not Spectra's guess.** Styles, theme fonts, numbering and fields are read from Word and shown faithfully. Spectra writes only what the user changed, as direct formatting only when the user applied it directly.
2. **Compare meaning, write minimum.** Diffing, merging, Yjs application and readback compare *effective* formatting and *canonical* attributes. Writes emit the smallest change.
3. **One region per Word paragraph.** Every `w:p` has exactly one editor node and one region id, wherever it lives. No other unit of identity exists.
4. **The document draws the page.** In page view, the document's own styles, fonts and page setup decide how it looks. Spectra's prose stylesheet applies only to documents that don't define a look, and they get a real style catalogue too.
5. **No new Bridge protocol.** All changes live in the lens, projection, editor, gateway, routes and Convex.
6. **Safety net first.** The golden harness and the fidelity lab land before any behaviour change, and every later commit keeps them green.
7. **One version field, no mass migration.** Stored content gets `projectionVersion: 2`. Version 1 stays readable, compares correctly under principle 2, and upgrades the next time it is written.

## Architecture changes

### A1. Region tree instead of a flat mirror

The projection's `blocks` becomes a tree that follows Word:
- body → paragraph | heading | list paragraph | table | image | equation block | field block | section break;
- table → row → cell → paragraphs (the same paragraph node as the body, with its own region);
- notes, headers and footers → paragraphs.

Each paragraph's region id stays `docx:paragraph:<w14:paraId>`. The lens already addresses any `w:p` by paraId, so cell and list-item edits become ordinary paragraph operations instead of table or list rewrites.

In the editor:
- Tables keep TipTap's table nodes. Each cell holds real paragraphs, each with a block id. `cellInline` and the `\n` join go away.
- Lists keep TipTap's nested list nodes, so Spectra's list commands and markdown paths don't change. Consecutive Word paragraphs with the same `numId` group into one list node, nested by `ilvl`. Every list item's paragraph has its own block id and carries `numId`, `ilvl` and the start value. A new item inherits them, so it is written into the same Word list.
- Ids: the first paragraph keeps the paraId. A paragraph created in Spectra gets a fresh 8-hex paraId at creation (`StableBlockId`), so it has its final region id before it reaches Word.

### A2. Minimal Yjs updates

`adoptProjectionFragment` and `applyProjection` are rebuilt on one routine:
1. Align the incoming top-level nodes with the fragment's by block id (longest common subsequence for order, so a moved paragraph is a move and not a delete plus insert).
2. For each aligned pair, compare canonical forms (sorted keys, empty `attrs` removed, default attributes dropped). Skip equal nodes.
3. For changed nodes, call y-prosemirror's `updateYFragment` on that node's `Y.XmlElement`, which writes a text-level diff.
4. Insert and delete only unaligned nodes.

Measured: EE 5 unchanged → 67 bytes (from 67 KB on a fresh room, 587 KB on an edited one). Cursors, undo and comment anchors survive a Word reconcile.

### A3. Styles as data, rendered by the editor

- **Catalogue.** `content.styles` holds `defaults` (docDefaults plus Normal) and the paragraph and character styles the document uses, plus the built-in roles: name, role, `basedOn`, `next`, outline level, resolved run and paragraph format.
- **Roles** come from Word's built-in `w:name` ("heading 1", "Title", "caption"), then the outline level, then the style id. `Ttulo1` is heading 1.
- **Runs carry direct formatting only**: the difference between the run's resolved format and its paragraph style's. Paragraph-mark formatting (`w:pPr/w:rPr`) stays on the paragraph and never spreads to the text.
- **Rendering.** `paragraph`, `heading` and `listItem` get a `styleId` attribute. The studio generates scoped CSS from the catalogue (`.document-page [data-style="Heading2"] {…}`): font, size, colour, spacing before and after, line spacing, indent, alignment, borders and shading. Unmarked text then looks exactly as Word shows it, and Enter follows the style's `w:next`.
- **Comparison.** Diff, merge and readback resolve formats through the catalogue on both sides. `INHERITED_RUN_FORMAT`, `STYLE_RUN_FORMAT` and the defaults table are deleted.
- **Spectra documents get a catalogue too.** Each document template has one: an academic set with a serif body for essays and papers, a sans set for notes, a grid set for worksheets. The page view, the style picker and the Word export all read it, so a document made in Spectra exports with real Word styles.

When a resolved value can't be computed (a missing style, a broken theme), that run keeps the v1 behaviour and stores the resolved value. Correctness beats size.

### A4. Semantic equality everywhere

One `canonicalNode` function (sorted keys, defaults removed, transient attributes such as `nativePath` and carried OMML ignored) backs the Yjs adapter, `mergeThreeWay`'s `defaultEqual`, the projection diff and the readback digest. The four places can no longer disagree about whether something changed.

### A5. Equations by reference

- Equation nodes store `latex`, `display`, `ommlHash` and `ommlSourceLatex`. The OMML XML isn't stored in the node.
- The lens resolves `ommlHash` → XML from the document's carried package (the replica base). If the user edited the equation (`latex` ≠ `ommlSourceLatex`), the lens writes new OMML from the latex instead.
- This removes 42% of EE 5's room and makes two equal equations in one paragraph unambiguous.
- Converter fixes: `〈 〉` → `\langle \rangle` (and a sweep over every Unicode operator Word emits); `\int`, `\sum`, `\prod` with limits → `m:nary`; Cambria Math run font kept; no redundant `xmlns:m` per `m:oMath`.
- Every native equation is editable. If the latex can't reproduce the OMML exactly, the equation still opens for editing; the original OMML is kept until the user changes something.
- Target: all 1,361 equations of EE 5 and the IAs parse in KaTeX, and latex → OMML → latex is stable on all of them.

### A6. The page renderer

Page view becomes a faithful page, not a styled column.
- **Exact page setup.** Paper size, orientation and each margin are stored in twentieths of a point, as Word stores them. The presets stay as quick choices in the page menu and set exact values.
- **Line-accurate pagination.** `PageFlow` measures line boxes (`Range.getClientRects`) instead of whole blocks:
  - A paragraph that crosses the page edge is split visually by an inline, full-width spacer at the first line that doesn't fit. It is a soft wrap, so justification is kept.
  - A table splits between rows and repeats its header row when Word marks one.
  - Word's widow/orphan control, keep-with-next and keep-lines-together, page-break-before, and explicit page and section breaks are honoured.
  - Layout runs incrementally from the edited page onward, in an idle callback.
- **Headers and footers** render in the margins: rich text, page number and page count fields, a different first page, and odd/even when the document defines it.
- **Tables** draw the borders the document defines (table style, `w:tblBorders`, cell borders, shading, padding, column widths). Booktabs tables look like booktabs.
- **Fonts.** `@font-face` rules load metric-compatible substitutes when a document uses a font the device doesn't have. Each rule tries `local()` first, so installed fonts always win:

  | Word font | Substitute (licence) |
  | --- | --- |
  | Calibri | Carlito (OFL) |
  | Cambria | Caladea (OFL) |
  | Times New Roman | Tinos (Apache 2.0) |
  | Arial | Arimo (Apache 2.0) |
  | Courier New | Cousine (Apache 2.0) |
  | STIX Two Text, Cambria Math | STIX Two (OFL) |
  | Aptos | Figtree with `size-adjust` (no metric twin exists; the closest open match) |

  They are self-hosted woff2 latin and latin-ext subsets, loaded only when a document uses them, with `font-display: swap`. Layout re-runs once fonts have loaded.
- **Target:** EE 5 on 68 pages ± 1, and every page of the French worksheet in the same place as Word.

### A7. A Word file for every document

- **Export from a styled template.** `exportDocxCopy` starts from a package built from the document's catalogue (A3), not from a blank `Document.create()`. Title, Subtitle, Quote and Caption are real styles, the TOC is a `TOC` field, images are fetched from their assets, and cells get the template's padding.
- **Documents created in Spectra get a Word file on disk.** When the Bridge places a new Spectra document in a synced folder, `new-works-to-disk` writes the exported `.docx` through the existing write path and binds the replica. From then on the document is Word-backed like any other. Bridge messages don't change.

### A8. Server outbox

- A Convex `nativeOutbox` row per Word-bound artifact, overwritten (never appended), is set whenever content changes from any source: gateway checkpoint, AI edit, import.
- A scheduled action debounces it to one run per 20 s idle window, and 5 s after the last collaborator leaves.
- It calls the existing `materialize` path through an HMAC-signed server request, the same pattern as the gateway's policy push. The client hook stays as a fast path. Both go through the same base-hash check and operation ids, so they can't double-write.
- While the Bridge is offline, the outbox waits on the existing replica write queue and drains when it reconnects.

### A9. Lean storage and checkpoints

- **Store the editor JSON, derive the regions.** Compact storage keeps the canonical editor JSON (with A3 direct-only formats and A5 equation references) and derives the region tree on demand in the lens, merge and routes. The duplicate `outline` is dropped (derived from headings), and so is `nativePath` (derived from order).
- **Checkpoints write only when the content hash changed**, and the gateway compares canonical hashes, so a reconnect or a cursor move never writes.
- **Projection base sidecar.** `workReplicas.projectionBaseContent` and the matching cloud field move to `replicaProjectionBases`, keyed by replica and hash, so list and sync queries stop reading tens or hundreds of KB per row.
- **Targets:** EE 5 stored content from 843 KB to under 250 KB; Yjs state from 563 KB to under 330 KB; a one-sentence edit costs a few hundred bytes of Yjs and one projection write.

## The fidelity lab

A permanent, testable home for "does it look like Word".

- **`/dev/document` route** (behind the existing Clerk `/dev/*` protection). It renders any fixture with the real studio components in page view, side by side with Word's PDF of the same file, with a page-by-page overlay and a difference slider. It is used to build A6 and to review every UI change.
- **Golden round-trip harness** (`document-word-golden.test.ts`). It runs every `tests/fixtures/docx` file plus a committed `extended-essay.docx` and `grid-worksheet.docx`, both generated by Spectra tooling, never taken from Pablo:
  - open → editor JSON through the real schema, asserting no node, attribute or mark is lost;
  - back to regions, asserting zero operations;
  - a scripted edit set: unmarked text in a styled paragraph, new paragraph after a heading, new list item, nested item, table-cell edit, equation edit, caption edit, new heading, moving a paragraph, deleting an image's neighbour text;
  - mutate, then exact readback and the preservation proof;
  - Yjs: apply the result to a live room and assert the update touches only the edited regions.
- **Visual check with playwright-cli.** A script renders each fixture in the lab and screenshots each page. `scripts/word-verify.ps1` opens each harness output in Word through COM, confirms no repair prompt and saves a PDF. The comparison reports the page count and per-page differences. It runs locally when Word is installed and is skipped in CI.
- **Local acceptance corpus.** The same harness runs over copies of Pablo's IBDP1 documents (`PROBE_FILES`, never committed): EE 5, the IAs, the French worksheet, TOK, CAS. Every edit kind must pass on every one of them before a phase ships.
- **One extension list.** The editor's extensions move from `document-studio.tsx` to `editor/document-extensions.ts`, exporting `documentExtensions(options)` for the editor and `documentSchema()` for tests and the server, so the schema can't drift unnoticed.

## Design

The page is the product. Everything around it is quiet Spectra chrome; the page itself takes its look from the document.

- **Page.** True paper colour and size at 100% zoom, a soft shadow and the desk colour around it from Spectra's tokens (light and dark). In dark mode the desk darkens and the page stays paper-white by default, with a "dark page" toggle for notes. Page numbers in the gap between pages, set small in the document's body font.
- **Style picker.** A compact control in the toolbar that shows the current style's name in that style's own type. It opens a gallery: Normal, Title, Subtitle, Heading 1–6, Quote and Caption first, then the document's own styles, each previewed in its real font, size and colour. Keyboard: Ctrl+Alt+1–6 for headings, Ctrl+Shift+N for Normal, as in Word.
- **Sync status.** One chip in the document header, worded from the user's side:
  - "Saved to Word · 2 min ago"
  - "Saving to Word…"
  - "Waiting for your computer" (Bridge offline)
  - "Bringing in changes from Word"
  - "1 paragraph needs a choice"

  The chip opens the existing Bridge sync log, filtered to this document. Failures say what failed and what to do: "Word has this file open with unsaved changes. Save or close it in Word and Spectra will continue."
- **Conflicts in place.** A clashing paragraph shows both versions inline, Word's above Spectra's, with "Keep Word's", "Keep mine" and "Keep both". Nothing else in the document is blocked.
- **Captions and references.** "Add caption" on images, tables, charts and display equations. Typing `@` offers headings, figures, tables and equations ("Figure 2 · Apparatus"). Captions renumber live.
- **Equations.** Click to edit in place with a live KaTeX preview under the input; display equations can carry a right-aligned number "(3)" that references can point to.
- **Read-only islands** (text boxes, SmartArt, unknown fields) are drawn from their fallback image at their real size, with a quiet "Edit in Word" on hover, instead of a grey label.

UI work loads `frontend-design`, is built in the fidelity lab first, and is checked with playwright-cli in light and dark at desktop and phone widths.

## Phases

Order: 0 → 1 → 2 → 3 → 4 → 5. Each numbered item is one commit on `main` with its tests and the golden harness green, and each phase is pushed when it completes.

### Phase 0: stop the data loss, build the safety net

0.1 **Image deletion fix.** An empty `assetId`, `partName` or `occurrenceId` means "absent" in `imageFromJsonNode`. `NativeDocxImage` defaults them to `null`. `docxProjectionFromContent` refuses to emit `delete-image` for an image whose node still exists in the editor JSON. Regression tests from the TOK and French cases.

0.2 **List item fix.** Every list item becomes its own block, inheriting `numId` and level, for every list node, Word-backed or not. Regression test from the EE 5 case. (A1 later generalises this.)

0.3 **Semantic equality (A4)** in the Yjs adapter and `mergeThreeWay`. It is small, it removes the false conflicts and most of the Yjs churn on day one, and every later step relies on it.

0.4 **Shared extension list and `documentSchema()`.**

0.5 **Golden harness, fidelity lab route and `word-verify.ps1`.**

### Phase 1: one region per paragraph, minimal Yjs

1.1 **Region tree (A1)** for tables: cells hold paragraphs; the lens maps cell edits to paragraph operations.
1.2 **Region tree for lists**: grouping by `numId`, nesting by `ilvl`, start values, restart and continue, numbering formats.
1.3 **Region tree for notes, headers and footers.**
1.4 **Minimal Yjs updates (A2).**
1.5 **Page breaks, section breaks and dividers** import as their nodes. A bottom-border empty paragraph becomes a divider.

### Phase 2: styles, fonts and the page

2.1 **Theme fonts** (`loadThemeFonts`) and the **style catalogue** in the projection.
2.2 **Roles from built-in names; a heading role beats numbering.** Outline-numbered headings stay headings, with a read-only `number` attribute ("2.1") from Word's numbering, kept native in Word. Levels 1–6.
2.3 **Direct-only run formats** (projection v2) and paragraph-mark formatting kept on the paragraph.
2.4 **Editor renders the catalogue**; Enter follows `w:next`.
2.5 **Effective-format diff and exact readback**; the exception tables are deleted.
2.6 **Style picker** and the default catalogues for Spectra templates.
2.7 **Web-font substitutes.**
2.8 **Exact page setup and the page renderer (A6)**: paper, margins, line-accurate pagination, table borders, headers and footers in the margins.

### Phase 3: sync you can trust

3.1 **Server outbox (A8).**
3.2 **Merge on Word upload.** When the Bridge uploads a Word revision and the cloud moved since the replica base, `commitPayloadUpload` merges server-side (base = replica base, ours = cloud, theirs = Word). Disjoint changes merge silently and flow back to Word through the outbox. If the merge fails or times out, it falls back to today's whole-document conflict and never overwrites silently.
3.3 **Merge inside a paragraph.** Diff3 over word tokens that carry their effective format and inline atoms (equations, images, notes, citations). A conflict remains only when both sides changed the same words.
3.4 **Conflicts in place** and **one sync status chip**.
3.5 **Write latency.** Cache equation forms by XML hash, re-read only touched parts for readback, and drop the full `untouchedAfterEditorTrip` re-projection. Target: under 1 s for EE 5, under 2 s for TMUA.

### Phase 4: academic structures

4.1 **Equations (A5)**: references, converter fixes, display detection, every equation editable, numbered display equations.
4.2 **Captions**: a `caption` block mapped to a Caption-style paragraph with a `SEQ` field and a correct cached number.
4.3 **Cross-references**: a `crossReference` atom mapped to `REF` plus a bookmark.
4.4 **Table of contents**: a `tableOfContents` block mapped to a `TOC` field. Spectra rebuilds the cached entries from headings and marks the field dirty so Word refreshes page numbers.
4.5 **Footnotes and endnotes** edited as rich text in a popover. Zotero, Mendeley and Word citations (`CITATION`, `ADDIN`) show as read-only chips with their cached text; a bibliography field shows its cached entries.
4.6 **Tables**: merged cells both ways (`gridSpan`, `vMerge`), table styles and borders, column widths, repeating header row, shading, vertical alignment. Grid worksheets keep their exact geometry.
4.7 **Word charts render** as SVG from the chart part's cached values (scatter, line, bar, column, with trendlines, error bars, axis titles and legend). They stay read-only and their parts stay untouched. Unsupported kinds show a frame at the chart's real size with "Edit in Word".
4.8 **Text boxes, SmartArt and embedded objects** render their fallback image.
4.9 **Unmodelled fields** (`DATE`, `MERGEFIELD`, `IF`, …) become inline read-only chips instead of locking the paragraph.

### Phase 5: Word files, storage and housekeeping

5.1 **Export from a styled template (A7).**
5.2 **Word file on disk for Spectra documents (A7).**
5.3 **Lean storage and checkpoints (A9)**, including the projection base sidecar.
5.4 **ManageBac `commitNormalizedPage` hash sidecar** (from `FEEDBACK.md`): an unchanged page skips the heavy read.
5.5 **`w14` declared once on the root**, so no `ns1:` prefixes.

## Delivery

- Each commit runs its tests, the golden harness, `npx vitest run` for the touched areas, `npm run typecheck` and lint.
- UI commits are checked in the fidelity lab with playwright-cli against the EE and worksheet fixtures, and `word-verify.ps1` opens every harness output in Word.
- Bridge code is untouched. If that ever changes, the Bridge skill applies: `cargo test`, the local Windows release simulation, and no `bridge-v*` tag.
- Convex changes are additive (new tables, optional fields). No backfill job runs; v1 content upgrades when it is next written.

### Decisions already taken (agent rules)

- **Ambiguous style role:** the style is custom. It shows under the document's own styles and is never remapped.
- **A resolved format can't be computed:** that run keeps v1 behaviour (resolved value stored as direct).
- **Fonts:** an installed font always wins over a substitute. With no metric twin (Aptos), the substitute is Figtree with `size-adjust`, and the page renderer accepts ±1 page on such documents.
- **Lists in the editor:** TipTap's nested list nodes stay; each item's paragraph is the region. No flat-list model.
- **Equation that can't round-trip exactly:** it is editable; the original OMML is kept until the latex changes.
- **Partial merge failure:** fall back to today's whole-document conflict, never a silent overwrite.
- **Outbox with the Bridge offline:** wait on the replica write queue; drain on reconnect.
- **Pablo's files** are never committed. The committed fixtures are generated by Spectra tooling.
- **v1 content** is never bulk-rewritten.
