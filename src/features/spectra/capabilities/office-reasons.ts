export const PRESENTATION_TEXT_FORMAT_NATIVE_REASON =
  "Spectra writes the words inside a linked PowerPoint shape, but not its font or paragraph styling. Make this formatting change in PowerPoint.";

export const DOCUMENT_NATIVE_REASONS = {
  hyperlink:
    "Spectra preserves hyperlinks in a linked Word file but cannot add, change, or remove them. Make this change in Word.",
  footnote:
    "Spectra preserves Word footnotes and endnotes but cannot add or edit them in the linked file. Make this change in Word.",
  tableStructure:
    "Spectra edits safe text inside a linked Word table but preserves its rows, columns, merges, and formatting. Reshape the table in Word.",
  image:
    "Set or add supported PNG/JPEG pictures natively in Spectra, including durable asset bytes, alternative text, dimensions, crop, insertion, and replacement; change text wrapping or remove a retained picture in Word.",
  equation:
    "Edit supported Word equation source in place. Unsupported native math remains preserved until it is explicitly replaced.",
  equationInsert:
    "Spectra edits supported existing Word equations but cannot insert a new equation into a linked native file yet. Add the new equation in Word or use an unlinked copy.",
  equationLayout:
    "Change equation placement or alignment in Word; the native writer edits equation source but does not rewrite layout properties yet.",
  section:
    "Set basic Word section page size, orientation, margins, and column count in Spectra. To add a section break or change advanced section layout, use Word.",
  headerFooter:
    "Spectra writes basic header/footer text natively and clones shared parts before a section-specific edit. Advanced header/footer content remains preserved.",
  field:
    "Spectra preserves Word fields but cannot insert, update, or recalculate them. Make this change in Word.",
  listStructure:
    "Spectra preserves Word numbering definitions but cannot change list structure safely. Nest or promote the item in Word.",
  styleCreate:
    "Spectra applies existing Word styles but cannot add a new style definition to the linked file. Create the style in Word.",
  embed:
    "A live Spectra reference has no Word representation. Unlink the file before inserting it, or add a normal link in Word.",
  template:
    "A template replaces the whole document, so it cannot run on a linked Word file. Import a separate copy first.",
  trackChanges:
    "Spectra preserves Word revision marks exactly but cannot resolve them safely. Accept or reject the changes in Word.",
  importCopy:
    "Import a copy from the Library so the linked file is not replaced.",
} as const;

export const SHEETS_NATIVE_REASONS = {
  sheetStructure:
    "Spectra writes worksheet order, identity, visibility, names, and tab metadata through the native Excel package. Unsupported workbook objects remain preserved.",
  rowColumnStructure:
    "Spectra updates native cell references, formulas, tables, charts, merges, dimensions, and validation ranges for one-row or one-column changes. Complex Excel objects remain preserved.",
  dimensions:
    "Spectra writes native row heights, column widths, and hidden row or column state. Excel remains the owner of unsupported advanced layout settings.",
  chart:
    "Spectra writes native editable Excel chart parts, series references, titles, legends, axes, anchors, and cached source values, including combo and histogram charts.",
  chartLinkToDeck:
    "Spectra can edit the native workbook chart, but linking it into a deck is an output action. Add or relink the chart from the presentation surface.",
  table:
    "Spectra writes native Excel tables, including range, headers, totals, style, and table relationships. Advanced filter criteria remain preserved when not modeled.",
  filter:
    "Spectra preserves Excel AutoFilter state but cannot write its native criteria. Change the filter in Excel.",
  sort:
    "Sorting here would rewrite cell order without updating every preserved Excel object that can reference those cells. Sort the range in Excel.",
  duplicateRows:
    "Removing duplicate rows can shift formulas and preserved Excel objects without a native row operation. Remove duplicates in Excel.",
  validation:
    "Spectra edits common native Excel list, numeric, and date validation rules, including their ranges and error or prompt settings. Unsupported validation extensions remain preserved.",
  conditional:
    "Spectra edits common native Excel cell, text, and two-color-scale conditional rules, including priority and stop-if-true. Unsupported rule families remain preserved.",
  namedRange:
    "Spectra writes modeled Excel defined names and preserves built-in names and unknown workbook extensions.",
  calculation:
    "Spectra writes automatic or manual calculation mode and marks formula caches absent when an edit makes them unsafe to claim.",
  note:
    "Spectra preserves Excel cell notes but cannot add or edit them in the linked workbook. Edit the note in Excel.",
  protect:
    "Spectra preserves Excel sheet protection but cannot change its native settings. Protect or unprotect the sheet in Excel.",
  importCopy:
    "Import a copy from the Library so the linked workbook is not replaced.",
} as const;

export const PRESENTATION_STRICT_REASONS = {
  duplicateSlide:
    "Duplicating this slide would have to clone every linked PowerPoint relationship, including media and charts. Duplicate it in PowerPoint.",
  layout:
    "This file gets layouts from its PowerPoint masters, which Spectra preserves but cannot reassign. Choose the layout in PowerPoint.",
  theme:
    "Spectra preserves the PowerPoint theme exactly as saved and cannot replace its theme parts. Change the theme in PowerPoint.",
  background:
    "Spectra preserves slide background fills but cannot write them into the linked file. Change the background in PowerPoint.",
  slideSize:
    "The linked file keeps the slide size it was saved with because resizing would rewrite every layout and master. Change the slide size in PowerPoint.",
  transition:
    "Spectra preserves PowerPoint transitions but cannot change them in the linked deck. Change the transition in PowerPoint.",
  animation:
    "Spectra preserves PowerPoint animation timing exactly but cannot author timing entries. Change the animation in PowerPoint.",
  textStyle: PRESENTATION_TEXT_FORMAT_NATIVE_REASON,
  shapeStyle:
    "Spectra preserves PowerPoint shape fills, lines, and effects but cannot rewrite them. Restyle the shape in PowerPoint.",
  geometry:
    "Spectra can move one native PowerPoint shape precisely, but multi-object alignment needs every selected shape to have a stable native identity. Align or distribute this selection in PowerPoint.",
  newShape:
    "Spectra writes basic text boxes into a linked deck but not other PowerPoint shape types. Add this shape in PowerPoint.",
  newEquation:
    "Spectra preserves equations already in a PowerPoint file but cannot author a new equation shape. Add it in PowerPoint.",
  newChart:
    "Spectra preserves PowerPoint charts with their data but cannot create a new native chart. Add the chart in PowerPoint.",
  newTable:
    "Spectra preserves PowerPoint tables but cannot create a new native table. Add the table in PowerPoint.",
  newMedia:
    "Spectra preserves linked PowerPoint media but cannot add a new picture, audio clip, or video to the file. Add the media in PowerPoint.",
  embed:
    "A live Spectra reference has no PowerPoint representation. Unlink the deck before inserting it, or add a normal link in PowerPoint.",
  group:
    "Spectra preserves existing PowerPoint groups but cannot create or break apart native shape groups. Group or ungroup the shapes in PowerPoint.",
  order:
    "Spectra preserves the linked slide's native shape tree and cannot rewrite stacking order safely. Reorder the shape in PowerPoint.",
  deleteObject:
    "Spectra cannot remove a PowerPoint shape and everything attached to it safely. Delete it in PowerPoint.",
  crop:
    "Spectra preserves the linked picture's native crop but cannot change it safely. Crop the picture in PowerPoint.",
  chartData:
    "The linked PowerPoint chart keeps its own data, which Spectra preserves but cannot rewrite. Edit or relink the chart data in PowerPoint.",
  citations:
    "PowerPoint has no matching object for a Spectra citation. Unlink the deck first, or add the citation as ordinary slide text in PowerPoint.",
  component:
    "A reusable Spectra component has no native PowerPoint representation. Unlink the deck before inserting it, or recreate the content in PowerPoint.",
  sections:
    "Spectra preserves the linked deck's PowerPoint sections but cannot rewrite their native list. Add, rename, or move sections in PowerPoint.",
  slideNumbers:
    "Spectra preserves PowerPoint slide-number placeholders but cannot add or remove them in a linked deck. Change slide numbers in PowerPoint.",
  objectState:
    "Spectra preserves a PowerPoint shape's lock and visibility settings but cannot rewrite them. Lock, unlock, hide, or show the shape in PowerPoint.",
  autoAdvance:
    "Spectra preserves PowerPoint slide timing but cannot write auto-advance timing into a linked deck. Set the advance timing in PowerPoint.",
  importCopy:
    "Import a copy from the Library so the linked deck is not replaced.",
} as const;
