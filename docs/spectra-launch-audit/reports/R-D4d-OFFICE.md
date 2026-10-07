# R-D4d — Office viewers

Lane D4d, branch `lane/office`, from main at `0b548fd6`. This lane had three goals:

1. Word, PowerPoint and Excel files open read-only inside Spectra, wherever Spectra shows a file.
2. Close the D4c follow-ups: nested studio keys, Done with the same work open twice, and three slide text edge cases.
3. Give the viewer its life moments (LIFE.md).

## 1. Commits

| Commit | What |
|---|---|
| 3bc12aeb | The shared file viewer (`files/`): Office parsing in a worker, Word on the shared renderer, PowerPoint as rail plus stage, Excel as a windowed grid with sheet tabs. Size limits, the older-format message and the ghost. School task and CAS files use it. `SlideCanvas` moves out of the presentation studio, and the cell styling out of the Sheets studio, so the viewer draws slides and cells the same way the studios do. |
| 9c7fd144 | Library resources and Bridge files get "View read-only". An imported deck's original can be viewed from the import history. |
| ce3f298d | Window-level shortcuts check the studio they belong to, not only the work. `work.requestClose` can name one copy. |
| 4bcea2ab | Slide text keeps callouts, keeps blocks inside their list item, and keeps an empty parent bullet. |

## 2. Office viewers

### One viewer

`files/file-viewer.tsx` (`FileViewer`) is the one viewer for every file Spectra shows in place. It is a Dialog. Its footer always has "Open in a new tab", plus the caller's own next step (for school files: "Copy into Library").

| Kind (`files/file-kind.ts`) | Shown as |
|---|---|
| Photo | The image. |
| PDF | The browser's PDF view in a frame. |
| `.docx` | The shared rich-content renderer (`SpectraRichContent`, spectra-prose) on a page. Pictures come along. |
| `.pptx` / `.ppsx` | A rail of thumbnails, the current slide, and speaker notes. Arrow keys, Page Up/Down, Space, Home and End move between slides. Slides draw with the studio's own `SlideCanvas`, pictures included. |
| `.xlsx` / `.xlsm` | A read-only grid with sheet tabs (arrow keys switch tabs). It has frozen rows and columns, merges, column widths and row heights, hidden rows and columns, gridlines on or off, tab colours, cell styling from the Sheets studio, and formulas shown as their calculated values. |
| `.doc` / `.ppt` / `.pps` / `.xls` | No viewer. One line explains that Spectra shows the newer formats, with a new tab and the caller's action still offered. |

The extension decides first, then the MIME type, so a ManageBac file sent as `application/octet-stream` still opens.

### Reuse, and off the main thread

- **Parsers.** The viewer reuses Spectra's own lenses: `importDocxPayload`, `pptxLens.open` and `xlsxLens.open` (strict-native), with `normalizeSheetsContent` and `sheetsCalculation`. There are no new dependencies.
- **Off the main thread.** `files/office-preview.ts` turns a file into plain, cloneable data. `files/office-preview.worker.ts` runs it in a module worker, and pictures come back as transferred bytes. The OfficeView code is loaded lazily.
- **Fallback.** If the worker fails, or doesn't exist, the page parses the file itself (`files/office-preview-client.ts`). The bytes are copied, not transferred, for this reason.
- **Object URLs.** Pictures become `blob:` URLs and are revoked when the viewer closes. `safeMediaSrc` in the rich renderer accepts `blob:` for images only; links still go through `safeHref`.

### Limits

| Format | Largest file shown | Grid cap |
|---|---|---|
| Word | 40 MB | — |
| PowerPoint | 80 MB | — |
| Excel | 30 MB | 10,000 rows, 256 columns, 250,000 cells |

The size is checked three times: from the known size, from `Content-Length` before reading, and from the bytes read. A file over the limit says so plainly ("This Excel workbook is 42 MB. Spectra shows Excel workbooks up to 30 MB here.") and offers a new tab.

A clipped sheet shows a note: "Showing the first 10,000 rows and 256 columns. Open it in a new tab to see the rest."

An unreadable or unreachable file shows "{name} didn't show here." and also offers a new tab.

### Where the viewer is used

| Place | Change |
|---|---|
| School task files and resources (`school-tasks.tsx`) | Every kind the viewer knows opens in it, with Copy into Library in the footer. Unknown kinds open a new tab, as before. |
| CAS evidence (`school-cas.tsx`) | The same. |
| Library resources and Bridge files (`bridge/resource-surface.tsx`) | "View read-only" opens the kept file. This also covers an Office file whose editable import failed, so a lens refusal is no longer a dead end. Older formats get the honest line instead. |
| Embeds of resource works | These open the Side, and the Side is the ResourceSurface, so they get View too. |
| Imported originals (`files/import-original.tsx`) | The presentation studio's import history offers View beside the Original download for a `.pptx`. |
| Chat attachments | Not changed. Sent attachments show as name chips with no stored file to read, so there is nothing to view. |
| Library's own Office imports | Not changed. They already become editable works. |

## 3. D4c follow-ups

### Shortcut audit across `EDITABLE_IN_PLACE`

The audit covered document, flashcard deck, quiz, planner task, presentation, sheets, timetable and whiteboard, plus their two hosts: the document, through the reference node view, and the whiteboard. Every window-level or document-level key listener was checked.

| Listener | Status |
|---|---|
| Workbar shortcuts (`artifact-workbar.tsx`, every type) | **Fixed.** `eventBelongsToFocusedStudio(event, workId, scope)` now compares studio elements, not work ids. The host never answers a nested work's keys, and the nested work never answers the host's. With the same work open in the Side and inline, only the copy that has focus answers. |
| Deck object nudge/delete, and deck undo/redo (`presentation-studio.tsx`) | **Fixed** with the same scope. |
| Document focus-mode Escape (window capture) | **Fixed.** It acts only for its own studio, or when nothing has focus and the document is not nested. Before, it swallowed the nested work's Escape. |
| Studio Escape-to-close, and shell undo (`artifact-studio.tsx`) | Already guarded by D4c (`[data-embed-editor]`). Checked. |
| Whiteboard canvas keys | Already guarded by D4c (`[data-embed-editor] *`). Checked. |
| Document editor (ProseMirror) | The reference node's `stopEvent` keeps nested keys out. Checked. |
| Sheets, quiz, flashcards, timetable, task | Element-level handlers only. Neither type hosts embeds. No change needed. |

### Done with the same work open twice

`work.requestClose` takes an optional `instance`. `ArtifactStudio` takes `instanceKey`, and the inline editor passes its embed id. A request reaches a studio only when its instance matches (`closeRequestReaches`). As a result:

- Done with unsynced changes asks only the inline copy.
- A tab or tile close reaches only the work's own studio, never an inline copy.

### Slide text edge cases (PowerPoint round trip unchanged)

1. **Callouts.** Paragraphs gain `block: "callout"` and `tone` (info, tip or warning, normalised). They read back as a callout of that tone. PowerPoint still gets italic text, as for a quote, and the tone never reaches the file.
2. **A code block, equation or quote inside a list item.** These are written with an explicit `bullet: "none"` at the item's level. The reader is now a single pass with one list stack, so such a block goes back into its item instead of ending the list. A code line that opens an item keeps its bullet.
3. **An empty parent bullet above a deeper bullet.** `richContentToProseMirror` marks the empty line it has to put at the top of a list item that opens with something else (`listFiller`; the `ListFiller` field extension keeps it, and it does not carry over on Enter). `richContentFromProseMirror` drops only that line, and only while it is empty. `flatten` no longer drops empty leading lines, so a real empty bullet survives the first edit. A deeper bullet with no parent still round-trips.

## 4. Life moments

- **Forming.** The viewer is a Dialog, so it forms from the press that opened it (`useLifeSurface`, from the last cause) and parts back when it closes. The open buttons are left without `data-life-launch` on purpose: that mark would make the next work opened within 2.5 s morph from a file button.
- **Ghosts.** While the file is fetched or parsed, `OfficeGhost` shows a ghost shaped like what is coming (`data-life-ghost`, with `data-life-ghost-bar` lines): a rail and stage for slides, a grid for workbooks, page lines for documents. It hands over to the content in place.
- **Slides.** Changing slides is a morph. The stage lands from the thumbnail or button that was pressed (`launchFrom` and `useLifeLanding`). The first slide does not use up the row's launch.
- **Glyphs.** Spectra glyphs are used everywhere the lane touched. The canvas extraction swapped lucide's image and play icons for glyphs.

## 5. Tests

New:

- `files/__tests__/office-preview.test.ts`: real parsing of the docx and pptx fixtures and a generated xlsx with a formula, plus corrupt input.
- `files/__tests__/file-viewer.component.test.tsx` (24 tests): every kind, the limits, the legacy line, ghost handover, slide keys and morph, grid and tabs, refusals.
- `files/__tests__/import-original.component.test.tsx`.
- `school/__tests__/school-task-files.component.test.tsx`.
- `bridge/__tests__/resource-surface-view.component.test.tsx`.
- `__tests__/nested-studio-keys.test.ts`.

Extended:

- `embed-inline-edit.component.test.tsx`: Done with unsynced changes names its own copy.
- `rich-content-model.test.ts`: callouts, blocks in list items, empty parent bullets, the filler.
- `presentation-model.test.ts`: callout normalisation and its native form.
- `slide-text-field.component.test.tsx`: all three edge cases through the real field.

The old `school-file-viewer.tsx` and its test were replaced and deleted.

Full suite (`npx vitest run --maxWorkers=3`): 587 files and 5,083 tests pass, with 1 skipped. On the first full run, `convex/school-purge-scale.test.ts` hit its timer-pump cap once under load. It passed 3 of 3 times on its own and passed on a second full run. This lane changes no Convex code.

All gates pass: both `tsc` configs, `eslint . --max-warnings=0`, and `check:architecture`, `copy`, `design-tokens`, `capabilities`, `secrets` and `skills`.

## 6. Remaining gaps

- **What the viewer leaves out.** Excel charts, pictures and conditional formats are not drawn in the grid. Word comments and tracked changes show only as the docx importer reads them. PowerPoint animations and transitions don't play.
- **Older formats.** `.doc`, `.ppt` and `.xls` have no reader, by design. They get the honest line.
- **Embeds of imported originals.** Only the presentation studio's import history has View. The code studio's notebook imports don't need it.
- **Two full copies of one work.** The same work open in both the main view and the Side, neither inline, still both answer a plain `work.requestClose`. This predates the lane and was left alone.
- **A quote inside a list item that holds its own list** at a deeper level reads back with extra empty parents. This is rare: the field can't produce it.
- **Not checked in a browser in this lane**, because dev servers were out of scope. That covers worker start-up in the Next build, the feel of the slide morph, and how the grid scrolls on a large sheet.

## 7. Convex

Nothing to deploy. No Convex function, schema or validator changed.

## 8. Visual checks to run

1. **A ManageBac task with a `.pptx` hand-in.**
   - Open it: the dialog forms from the Open button, and a slides-shaped ghost hands over to the rail and stage.
   - Arrow keys morph between slides, and the thumbnails follow. Notes show under the stage.
   - Copy into Library is in the footer.
2. **The same task with a `.docx`.** It reads like a Spectra document, with headings, lists, tables and pictures.
3. **A `.xlsx` with frozen panes, merges and a hidden sheet.**
   - The header and frozen panes stay put while you scroll.
   - Merged cells span. Formulas show values.
   - Sheet tabs switch with the arrow keys. The hidden sheet is not listed.
4. **A workbook over 30 MB, and one with more than 10,000 rows.** You get the size line in the first case and the clip note in the second, each with Open in a new tab.
5. **A `.doc` hand-in.** One honest line, no viewer, and Copy into Library still offered.
6. **A Library resource whose Excel import failed.** The refusal shows, and View read-only opens the grid.
7. **A deck imported from PPTX.** Files → import history → View opens the original next to its download.
8. **A document with an inline deck embed, with the same deck open in the Side.**
   - Edit a slide inline and press Done: only the inline copy asks or closes, and the Side stays.
   - Ctrl+Z and the workbar keys act only where focus is.
   - With the document in focus mode, Escape inside the embed closes the embed, not focus mode.
9. **A slide text box with a callout, a code block inside a bullet, and an empty bullet above a sub-bullet.**
   - Type a word: all three stay as they were.
   - Export to PowerPoint: the callout is italic text.
