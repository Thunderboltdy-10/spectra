export const PRESENTATION_TEXT_FORMAT_NATIVE_REASON =
  "Text inside a linked shape is edited natively, but its run properties stay as PowerPoint saved them.";

export const DOCUMENT_NATIVE_REASONS = {
  hyperlink:
    "Spectra cannot write hyperlinks into a linked Word file yet, so this stays unavailable while the original is linked.",
  footnote:
    "Spectra cannot write footnotes or endnotes into a linked Word file yet, so this stays unavailable while the original is linked.",
  tableStructure:
    "Spectra edits the text inside a linked Word table, not its shape, so adding a row is unavailable here.",
  image:
    "Pictures in a linked Word file are preserved. Spectra does not author or restyle them in the package yet.",
  equation:
    "Equations in a linked Word file are preserved. Spectra does not write OMML into the package yet.",
  section:
    "Section properties in a linked Word file are preserved exactly as Word saved them.",
  headerFooter:
    "Headers and footers in a linked Word file are preserved. Spectra does not rewrite those parts yet.",
  field:
    "Word fields in a linked file are preserved. Spectra does not update or insert fields there yet.",
  listStructure:
    "List structure in a linked Word file is preserved. Spectra does not nest or promote items there yet.",
  styleCreate:
    "Named styles in a linked Word file are preserved. Spectra does not add a new style definition there yet.",
  embed:
    "A live Spectra reference cannot be represented in a Word file, so it stays unavailable while the original is linked.",
  template:
    "Templates replace the whole document and are unavailable for a linked Word file.",
  trackChanges:
    "Word revision marks are preserved exactly as Word wrote them, so accepting or rejecting them has to happen in Word.",
  importCopy:
    "Import a copy from the Library so the linked file is not replaced.",
} as const;

export const SHEETS_NATIVE_REASONS = {
  sheetStructure:
    "Spectra does not add, remove, hide, or reorder worksheets in a linked Excel file.",
  dimensions:
    "Row height, column width, and hide state in a linked Excel file are preserved as Excel saved them.",
  chart:
    "Charts in a linked Excel file are preserved with their cached data. Spectra does not author a new chart part.",
  table:
    "Excel tables in a linked file are preserved. Spectra does not create or restyle them there yet.",
  filter:
    "AutoFilter in a linked Excel file is preserved. Spectra does not write filter state there yet.",
  sort:
    "Spectra does not write a sort into a linked Excel file. Sorting would have to rewrite cell order without a native sort operation.",
  validation:
    "Data validation in a linked Excel file is preserved. Spectra does not write validation rules there yet.",
  conditional:
    "Conditional formatting in a linked Excel file is preserved. Spectra does not write those rules there yet.",
  namedRange:
    "Defined names in a linked Excel file are preserved. Spectra does not add or edit them there yet.",
  calculation:
    "Calculation settings in a linked Excel file are preserved as Excel saved them.",
  note:
    "Cell notes in a linked Excel file are preserved. Spectra does not write notes into the package yet.",
  protect:
    "Sheet protection in a linked Excel file is preserved. Spectra does not change that flag there yet.",
  importCopy:
    "Import a copy from the Library so the linked workbook is not replaced.",
} as const;

export const PRESENTATION_STRICT_REASONS = {
  addSlide:
    "Adding a slide to the linked PowerPoint file needs a layout from its master. Spectra does not write new slides into the linked package yet.",
  duplicateSlide:
    "Duplicating into the linked PowerPoint file would have to clone its slide part and relationships, which Spectra does not write yet.",
  layout:
    "This file gets its layouts from its own slide masters. Spectra preserves them and cannot reassign a layout in the linked file.",
  theme:
    "The PowerPoint theme is preserved exactly as saved, so a Spectra theme cannot replace it while the original is linked.",
  background:
    "Slide background fills are not written into the linked PowerPoint file, so this stays unavailable while the original is linked.",
  slideSize:
    "The linked file keeps the slide size it was saved with. Changing it would rewrite every layout and master.",
  transition:
    "Only an exact PowerPoint equivalent may replace a transition in a linked file, and Spectra does not write transitions yet.",
  animation:
    "PowerPoint animation timing is preserved exactly. Spectra does not author timing entries in a linked file.",
  textStyle: PRESENTATION_TEXT_FORMAT_NATIVE_REASON,
  shapeStyle:
    "Shape fills, lines and effects are preserved from the linked file rather than rewritten.",
  newShape:
    "Spectra cannot author this shape into the linked PowerPoint file yet. A text box is the one shape it writes natively.",
  newChart:
    "Charts in the linked file are preserved with their cached data and workbook. Spectra does not author a new chart part.",
  newTable:
    "Tables in the linked file are preserved as graphic frames. Spectra does not author a new table into them.",
  newMedia:
    "Adding media would need a new media part and relationship in the linked file, which Spectra does not write yet.",
  embed:
    "A linked Spectra work has no PowerPoint representation, so it is available only when this deck is not mirroring a native file.",
  group:
    "PowerPoint group shapes in this file are preserved. Spectra does not write its own groups into the linked package.",
  order:
    "Shape stacking order is preserved from the linked file's own shape tree.",
  deleteObject:
    "Removing a shape from the linked PowerPoint file is not written yet.",
  crop: "Image cropping is held in Spectra and is not written into the linked picture.",
  chartData:
    "The linked chart keeps its own cached data. A live Spectra binding is a Spectra-side view of it.",
  citations:
    "Citations have no PowerPoint representation, so they stay in Spectra while the original file is linked.",
  component:
    "Reusable components are a Spectra library, so inserting one is unavailable while a native file is linked.",
  sections:
    "Sections are held in Spectra. The linked file keeps its own section list untouched.",
  slideHidden:
    "Hidden-slide state is preserved from PowerPoint. Spectra does not write that flag into a linked slide yet.",
  slideNumbers:
    "PowerPoint slide-number placeholders are preserved. Spectra does not add or remove them in a linked deck.",
  objectState:
    "Object lock and visibility flags are preserved from PowerPoint and are not written into a linked shape yet.",
  autoAdvance:
    "PowerPoint slide timing is preserved. Spectra does not write auto-advance timing into a linked deck yet.",
  importCopy:
    "Import a copy from the Library so the linked deck is not replaced.",
} as const;
