# R-D4e — Office depth

Lane `lane/officedepth`, three feature commits on top of main at `62bf9fc3`:

| Commit | Scope |
| --- | --- |
| `9b9a6773` | Excel: charts, pictures, notes, conditional formats, widths |
| `557fb7af` | Word: tracked changes, comments, notes, header/footer |
| `2dd1c6cb` | PowerPoint: placeholders, groups, shapes, connectors, OLE/SmartArt |

The changes are in the shared importers (the xlsx/docx/pptx lenses and the
rich-content model), so import-original and the editors get the same reading
as the read-only viewer. All parsing stays in the existing worker.

## What renders now

### Excel
- Charts are placed by their cell anchors. Each one plots from its own
  series refs, on any sheet, using the editor's recharts chart, which loads
  on demand.
- Embedded pictures are anchored to their cells. EMF/WMF pictures say they
  can't be shown.
- Notes are marked on their cells.
- Conditional formats: dxf fills and fonts, theme and indexed colours with
  tint, two- and three-colour scales, and data bars. They apply by priority
  and honour `stopIfTrue`. The editor grid and the viewer share one evaluator.
- Column widths and row heights convert as Excel rounds them, and an
  unchanged width writes back exactly.
- Merged cells, frozen panes and number formats still render (they already
  did).

### Word
- Insertions and deletions show who made them and when, read-only in
  Spectra's tones.
- Commented text is marked and numbered, with its threads beside the page.
- Footnotes and endnotes follow the text after a rule, numbered as Word does
  (1, 2 / i, ii).
- Highlighter colours show.
- The last section's header and footer are laid out on Word's tab stops.
- A plain note names what the view can't draw: SmartArt, embedded objects,
  text boxes, and EMF/WMF pictures.
- Images and tables still render (they already did).

### PowerPoint
- Placeholders without a transform of their own take the layout's, then the
  master's, geometry. Before this, titles and bodies on many decks sat at
  0,0 with a size of 100×50.
- Grouped shapes, including nested groups, map out of the group's child
  space. Writes go back through the inverse transform:
  - moving a grouped shape;
  - moving the group itself, which before this moved its first child;
  - creating a group (identity child space);
  - ungrouping (members are baked into the parent space).
- Shapes draw their fill, outline (colour, width, dash), preset geometry and
  flips, text anchor (top/middle/bottom) and arrowheads. These come from
  `spPr`, then the `p:style` references, then the inherited placeholders.
  Theme colours resolve through a new DrawingML colour reader
  (`lenses/drawingml-colors.ts`): colour map and overrides, plus lumMod,
  lumOff, tint, shade, satMod and alpha.
- Table cell fills resolve theme colours too.
- Connectors (`p:cxnSp`) and line presets draw as SVG, with arrowheads.
- OLE objects and SmartArt no longer show up as empty tables. They are
  `embed` objects that carry what they are:
  - PowerPoint's fallback picture, when the file saved one;
  - otherwise a card that names the object (for example "Chart" or "Excel
    workbook");
  - for SmartArt, the card lists the diagram's words.
- Pictures, tables, text and chart values still render (they already did).

## Limits, stated plainly

- **PowerPoint charts** are still the canvas's simple bars from the saved
  values. They are not yet drawn with recharts on slides.
- **PowerPoint slide backgrounds and theme text colour** are not read. Native
  slides draw on Spectra's page colour, and text without its own colour uses
  the canvas default.
- **Table styles** (banding, header-row fills from `tableStyleId`) are not
  applied. Only explicit cell fills are.
- **Shape presets beyond the common ones**:
  - Shapes outside rect, roundRect, ellipse, triangle, diamond, chevron,
    homePlate and rightArrow draw as their frame (fill and outline), not
    their outline path.
  - Custom geometry also draws as its frame.
  - Bent and curved connectors draw as straight lines.
  - Arrowheads stretch with a non-square frame.
- **Group rotation and flips** are not composed into the children; only
  offset and scale are.
- **Group geometry precision**: some groups' child space is coarser than an
  EMU, so moving a member inside one lands on the nearest unit of that space
  (under 0.1 of the 1000-unit canvas).
- **OLE objects in `mc:AlternateContent`** wrappers are still skipped, as
  before.
- **Word**: only the last section's default header and footer are shown;
  first-page and even-page variants are not. Comments are read-only and have
  no replies.
- **Excel**: sparklines and pivot charts are not drawn.

## Convex

No Convex functions or schemas were touched. Display-only data was added in
three places:
- pptx projection: `nativeAppearance`, `nativeObject`, and `embed` objects;
- xlsx projection: display fields, kept out of the readback digest;
- Word: the viewer's preview (comments, header/footer, unshown features).
  The docx projection is unchanged.

The pptx fields start with `native`, so `pptxProjectionFromContent` carries
them unchanged and they never produce write operations.

Compatibility: a deck projection stored before this change reads differently
now (placeholder and group geometry, OLE type). The brief needs no backwards
compatibility. Even so, a save whose request was built from a stale
projection can fail the readback check once, until the artifact is
re-imported.

## Tests

- `src/features/spectra/files/__tests__/office-preview-sheet-depth.test.ts`
- `src/features/spectra/__tests__/sheets-office-depth.test.ts`
- `src/features/spectra/files/__tests__/office-preview-document-depth.test.ts`
- `src/features/spectra/__tests__/rich-content-model.test.ts`: the "Word
  review" section.
- `src/features/spectra/__tests__/pptx-office-depth.test.ts` covers:
  - the colour reader;
  - placeholder inheritance;
  - group mapping;
  - appearance and connectors;
  - OLE;
  - set-geometry and ungroup round trips;
  - grouping without moving members.
- `src/features/spectra/files/__tests__/file-viewer.component.test.tsx`
  renders revisions, comments, page chrome, native shapes, lines and object
  cards.

Gates run for the PowerPoint commit:
- both `tsc` projects;
- eslint on the touched files;
- `check:copy`, `check:design-tokens`, `check:architecture`;
- every vitest file that touches the pptx lens, office content or the slide
  canvas (26 files).

## What's left

1. Plot slide charts with the shared recharts plot in the viewer's main stage.
2. Read slide backgrounds (slide, then layout, then master `p:bg`) and the
   master's text colour, together, so dark decks stay readable.
3. Apply `tableStyles.xml` styles to tables (header row, banding).
4. Draw custom geometry and more presets as SVG paths, and compose group
   rotation and flips.
5. Show Word's first-page and even-page headers, and comment replies.
