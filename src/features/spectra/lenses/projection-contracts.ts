import { z } from "zod";

const compatibilityProfileSchema = z.enum([
  "strict-native",
  "enhanced",
  "spectra-native",
]);
const semanticDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

const wordRevisionMarkSchema = z
  .object({
    id: z.string().min(1).max(200),
    kind: z.enum(["ins", "del", "moveFrom", "moveTo"]),
    author: z.string().max(400).optional(),
    date: z.string().max(80).optional(),
    text: z.string().max(20_000),
  })
  .strict();

const wordNoteSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: z.enum(["footnote", "endnote"]),
    text: z.string().max(100_000),
  })
  .strict();

const wordCommentSchema = z
  .object({
    id: z.string().min(1).max(64),
    author: z.string().max(400).optional(),
    date: z.string().max(80).optional(),
    initials: z.string().max(40).optional(),
    text: z.string().max(100_000),
  })
  .strict();

const nativeBindingBase = {
  version: z.literal(1),
  profile: compatibilityProfileSchema,
  macroEnabled: z.boolean(),
  semanticDigest: semanticDigestSchema,
  // Presentations carry their real canvas dimensions in presentation.xml.
  // Keeping them on the projection prevents a 4:3 deck from being silently
  // normalised to the editor's 16:9 default during a native write.
  canvasWidthEmu: z.number().positive().optional(),
  canvasHeightEmu: z.number().positive().optional(),
};

const docxRunFormatSchema = z
  .object({
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strike: z.boolean().optional(),
    fontFamily: z.string().nullable().optional(),
    fontSizePoints: z.number().nullable().optional(),
    color: z.string().nullable().optional(),
    highlight: z.string().nullable().optional(),
    shading: z.string().nullable().optional(),
  })
  .strict();

const docxParagraphFormatSchema = z
  .object({
    alignment: z.enum(["left", "center", "right", "justify"]).nullable().optional(),
    lineSpacing: z.number().nullable().optional(),
    spacingAfterPoints: z.number().nullable().optional(),
    indentLevel: z.number().nullable().optional(),
    border: z.string().nullable().optional(),
    shading: z.string().nullable().optional(),
  })
  .strict();

/**
 * Ordered content that Word keeps inside a paragraph or table cell.
 *
 * `text` alone is not a faithful DOCX projection: OMML and drawings sit
 * between ordinary runs, so flattening with `Paragraph.text()` makes both the
 * object and its position disappear. Native media is referenced by package
 * part rather than copied into Convex; the authenticated route resolves it
 * from the retained DOCX payload at render time.
 */
export const docxRichInlineSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("text"),
      text: z.string().max(2_000_000),
      /** Resolved native run formatting; omitted when the run uses defaults. */
      format: docxRunFormatSchema.optional(),
      /** External hyperlink target for this run, when one is present. */
      href: z.string().max(4_000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("equation"),
      latex: z.string().max(2_000_000),
      display: z.enum(["inline", "block"]),
      /** Exact OMML is carried for native readback/export. */
      ommlXml: z.string().max(4_000_000).optional(),
      /** LaTeX value represented by the retained OMML subtree at open time. */
      ommlSourceLatex: z.string().max(2_000_000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("image"),
      /** Retained native media has a package part; authored media has a durable asset. */
      partName: z.string().regex(/^\/word\/media\/[^/\\\u0000-\u001f]{1,400}$/u).optional(),
      /** Stable identity for one DrawingML occurrence, independent of its media part. */
      occurrenceId: z.string().min(1).max(300).optional(),
      assetId: z.string().min(1).max(300).optional(),
      mediaType: z.enum(["image/png", "image/jpeg"]),
      altText: z.string().max(4_000),
      widthEmu: z.number().int().positive().optional(),
      heightEmu: z.number().int().positive().optional(),
      placement: z.enum(["inline", "anchored"]),
      crop: z
        .object({
          left: z.number().min(0).max(1).optional(),
          top: z.number().min(0).max(1).optional(),
          right: z.number().min(0).max(1).optional(),
          bottom: z.number().min(0).max(1).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("noteRef"),
      noteType: z.enum(["footnote", "endnote"]),
      noteId: z.string().min(1).max(64),
      /** Note body text from footnotes.xml / endnotes.xml for display. */
      text: z.string().max(100_000),
    })
    .strict(),
]);

export const docxProjectionBlockSchema = z
  .object({
    id: z.string().min(1).max(300),
    type: z.enum(["paragraph", "heading", "list", "table", "equation"]),
    text: z.string().max(2_000_000),
    latex: z.string().max(2_000_000).optional(),
    rows: z.array(z.array(z.string().max(250_000)).max(1_000)).max(100_000).optional(),
    inlineContent: z.array(docxRichInlineSchema).max(100_000).optional(),
    richRows: z
      .array(
        z
          .array(z.array(docxRichInlineSchema).max(100_000))
          .max(1_000),
      )
      .max(100_000)
      .optional(),
    attrs: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const docxProjectionSchema = z
  .object({
    blocks: z.array(docxProjectionBlockSchema).max(100_000),
    outline: z
      .array(
        z
          .object({
            id: z.string().min(1),
            title: z.string(),
            level: z.number(),
          })
          .strict(),
      )
      .max(100_000),
    pageSetup: z
      .object({
        size: z.string().min(1).max(40).optional(),
        orientation: z.enum(["portrait", "landscape"]).optional(),
        margins: z.string().min(1).max(40).optional(),
        columns: z.number().int().min(1).max(3).optional(),
        header: z.string().max(4_000).optional(),
        footer: z.string().max(4_000).optional(),
        sectionIndex: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    nativeBinding: z
      .object({
        ...nativeBindingBase,
        format: z.enum(["docx", "docm", "dotx", "dotm"]),
        // Missing on legacy projections means native anchors were not proven.
        identityStable: z.boolean().optional(),
        // Bound by the authenticated route, never by the format lens. These
        // two small values let the client resolve native image parts without
        // duplicating package bytes into artifact content.
        sourceArtifactId: z.string().min(1).optional(),
        sourcePayloadHash: semanticDigestSchema.optional(),
        nativePlaceholders: z.array(
          z
            .object({
              id: z.string(),
              label: z.string(),
              detail: z.string(),
              feature: z.string(),
            })
            .strict(),
        ),
        /** Individual Word revision marks inventory (read path). */
        wordRevisions: z.array(wordRevisionMarkSchema).max(10_000).optional(),
        /** Footnote/endnote bodies from Word parts (read path). */
        wordNotes: z.array(wordNoteSchema).max(10_000).optional(),
        /** Native Word comments from comments.xml (distinct from Spectra threads). */
        wordComments: z.array(wordCommentSchema).max(10_000).optional(),
      })
      .passthrough(),
  })
  .strict();

export type DocxProjectionBlock = z.infer<typeof docxProjectionBlockSchema>;
export type DocxProjection = z.infer<typeof docxProjectionSchema>;
export type DocxRichInline = z.infer<typeof docxRichInlineSchema>;
export type DocxRunFormat = z.infer<typeof docxRunFormatSchema>;
export type DocxParagraphFormat = z.infer<typeof docxParagraphFormatSchema>;

export const docxOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("replace-paragraph"), regionId: z.string(), text: z.string(), inlineContent: z.array(docxRichInlineSchema).optional() }).strict(),
  z.object({ kind: z.literal("edit-table-cell"), regionId: z.string(), row: z.number().int().nonnegative(), column: z.number().int().nonnegative(), text: z.string(), inlineContent: z.array(docxRichInlineSchema).optional() }).strict(),
  z.object({ kind: z.literal("insert-paragraph"), regionId: z.string().optional(), afterRegionId: z.string().nullable().optional(), text: z.string(), style: z.string().optional(), inlineContent: z.array(docxRichInlineSchema).optional() }).strict(),
  z.object({ kind: z.literal("delete-region"), regionId: z.string() }).strict(),
  z.object({
    kind: z.literal("delete-image"),
    regionId: z.string(),
    partName: z.string().regex(/^\/word\/media\/[^/\\\u0000-\u001f]{1,400}$/u),
    occurrenceId: z.string().min(1).max(300).optional(),
  }).strict(),
  z.object({ kind: z.literal("reorder-regions"), order: z.array(z.string()) }).strict(),
  z.object({ kind: z.literal("apply-style"), regionId: z.string(), style: z.string() }).strict(),
  z.object({ kind: z.literal("format-runs"), regionId: z.string(), format: docxRunFormatSchema }).strict(),
  z.object({ kind: z.literal("format-paragraph"), regionId: z.string(), format: docxParagraphFormatSchema }).strict(),
  z.object({ kind: z.literal("insert-table-row"), regionId: z.string(), row: z.number().int().nonnegative().optional() }).strict(),
  z.object({ kind: z.literal("delete-table-row"), regionId: z.string(), row: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("insert-table-column"), regionId: z.string(), column: z.number().int().nonnegative().optional() }).strict(),
  z.object({ kind: z.literal("delete-table-column"), regionId: z.string(), column: z.number().int().nonnegative() }).strict(),
  z.object({
    kind: z.literal("update-image"),
    regionId: z.string(),
    partName: z.string().regex(/^\/word\/media\/[^/\\\u0000-\u001f]{1,400}$/u),
    occurrenceId: z.string().min(1).max(300).optional(),
    altText: z.string().max(4_000).optional(),
    widthEmu: z.number().int().positive().optional(),
    heightEmu: z.number().int().positive().optional(),
    crop: z
      .object({
        left: z.number().min(0).max(1).optional(),
        top: z.number().min(0).max(1).optional(),
        right: z.number().min(0).max(1).optional(),
        bottom: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
  }).strict(),
  z.object({
    kind: z.literal("insert-image"),
    regionId: z.string(),
    row: z.number().int().nonnegative().optional(),
    column: z.number().int().nonnegative().optional(),
    partName: z.string().regex(/^\/word\/media\/[^/\\\u0000-\u001f]{1,400}$/u).optional(),
    occurrenceId: z.string().min(1).max(300).optional(),
    assetId: z.string().min(1).max(300).optional(),
    mediaType: z.enum(["image/png", "image/jpeg"]),
    altText: z.string().max(4_000).optional(),
    widthEmu: z.number().int().positive().optional(),
    heightEmu: z.number().int().positive().optional(),
    crop: z.object({
      left: z.number().min(0).max(1).optional(),
      top: z.number().min(0).max(1).optional(),
      right: z.number().min(0).max(1).optional(),
      bottom: z.number().min(0).max(1).optional(),
    }).strict().optional(),
  }).strict().refine((value) => Boolean(value.assetId) !== Boolean(value.partName), {
    message: "An image insertion must identify either a durable asset or a retained native media part.",
  }),
  z.object({
    kind: z.literal("replace-image"),
    regionId: z.string(),
    partName: z.string().regex(/^\/word\/media\/[^/\\\u0000-\u001f]{1,400}$/u),
    occurrenceId: z.string().min(1).max(300).optional(),
    assetId: z.string().min(1).max(300),
    mediaType: z.enum(["image/png", "image/jpeg"]),
    altText: z.string().max(4_000).optional(),
    widthEmu: z.number().int().positive().optional(),
    heightEmu: z.number().int().positive().optional(),
    crop: z.object({
      left: z.number().min(0).max(1).optional(),
      top: z.number().min(0).max(1).optional(),
      right: z.number().min(0).max(1).optional(),
      bottom: z.number().min(0).max(1).optional(),
    }).strict().optional(),
  }).strict(),
  z.object({
    kind: z.literal("set-equation-layout"),
    regionId: z.string(),
    display: z.enum(["inline", "block"]).optional(),
    alignment: z.enum(["left", "center", "right"]).optional(),
  }).strict(),
  z.object({
    kind: z.literal("update-section"),
    sectionIndex: z.number().int().nonnegative().optional(),
    size: z.string().min(1).max(40).optional(),
    orientation: z.enum(["portrait", "landscape"]).optional(),
    margins: z.string().min(1).max(40).optional(),
    columns: z.number().int().min(1).max(3).optional(),
  }).strict(),
  z.object({
    kind: z.literal("update-header-footer"),
    sectionIndex: z.number().int().nonnegative().optional(),
    slot: z.enum(["header", "footer"]),
    text: z.string().max(4_000),
  }).strict(),
]);
export const DOCX_LENS_DELTA_KINDS = docxOperationSchema.options.map(
  (operation) => operation.shape.kind.value,
);
export const docxSemanticDeltaSchema = z.union([
  docxOperationSchema,
  z.object({ kind: z.literal("ai-edit"), operations: z.array(docxOperationSchema) }).strict(),
]);
export type DocxOperation = z.infer<typeof docxOperationSchema>;
export type DocxSemanticDelta = z.infer<typeof docxSemanticDeltaSchema>;

export const xlsxCellValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.date(),
]);
export const xlsxCellProjectionSchema = z
  .object({
    id: z.string(),
    ref: z.string().regex(/^[A-Z]+[1-9][0-9]*$/),
    value: xlsxCellValueSchema,
    formula: z.string().optional(),
    formulaSupport: z.enum(["recognized", "cached-only"]).optional(),
    /** A formula result is either a native cached value or deliberately absent. */
    formulaCache: z.enum(["present", "absent"]).optional(),
    style: z.record(z.string(), z.unknown()).optional(),
    format: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const xlsxTableProjectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    range: z.string(),
    columns: z.array(z.string()),
    headerRow: z.boolean(),
    totalsRow: z.boolean(),
    style: z.string().nullable().optional(),
    filters: z.array(
      z.object({ column: z.number().int().nonnegative(), allowedValues: z.array(xlsxCellValueSchema) }).strict(),
    ).optional(),
    sort: z.object({ column: z.number().int().nonnegative(), direction: z.enum(["asc", "desc"]) }).strict().optional(),
    partName: z.string().optional(),
  })
  .strict();

const xlsxChartSeriesProjectionSchema = z
  .object({
    name: z.string().optional(),
    categories: z.string().optional(),
    values: z.string().optional(),
    /** Native combo charts retain the plot family and axis for each series. */
    chartType: z.enum(["column", "bar", "line", "area", "scatter"]).optional(),
    axis: z.enum(["primary", "secondary"]).optional(),
  })
  .strict();

export const xlsxChartProjectionSchema = z
  .object({
    id: z.string(),
    type: z.enum(["column", "bar", "line", "area", "pie", "scatter", "combo", "histogram"]),
    sourceRange: z.string(),
    title: z.string(),
    showLegend: z.boolean().optional(),
    position: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).strict(),
    series: z.array(xlsxChartSeriesProjectionSchema).optional(),
    partName: z.string().optional(),
    drawingPartName: z.string().optional(),
    anchorId: z.string().optional(),
  })
  .strict();

const xlsxNativeRuleSchema = z.record(z.string(), z.unknown());
export const xlsxSheetProjectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    cells: z.array(xlsxCellProjectionSchema),
    merges: z.array(z.string()).readonly(),
    frozenRows: z.number().int().nonnegative().optional(),
    frozenColumns: z.number().int().nonnegative().optional(),
    rowCount: z.number().int().positive().optional(),
    columnCount: z.number().int().positive().optional(),
    hiddenRows: z.array(z.number().int().nonnegative()).optional(),
    hiddenColumns: z.array(z.number().int().nonnegative()).optional(),
    columnWidths: z.record(z.string(), z.number()).optional(),
    rowHeights: z.record(z.string(), z.number()).optional(),
    hidden: z.boolean().optional(),
    showGridlines: z.boolean().optional(),
    showHeadings: z.boolean().optional(),
    tabColor: z.string().optional(),
    tables: z.array(xlsxTableProjectionSchema).optional(),
    charts: z.array(xlsxChartProjectionSchema).optional(),
    validations: z.array(xlsxNativeRuleSchema).optional(),
    conditionalFormats: z.array(xlsxNativeRuleSchema).optional(),
    /** The workbook relationship target, stable across worksheet reorder. */
    partName: z.string().optional(),
  })
  .strict();
export const xlsxProjectionSchema = z
  .object({
    sheets: z.array(xlsxSheetProjectionSchema),
    definedNames: z.array(
      z.object({ name: z.string(), ref: z.string(), sheet: z.string().optional() }).strict(),
    ),
    calculationMode: z.enum(["automatic", "manual"]).optional(),
    activeSheetId: z.string().optional(),
    nativeBinding: z
      .object({
        ...nativeBindingBase,
        format: z.enum(["xlsx", "xlsm", "xltx", "xltm", "xlam"]),
        sourceArtifactId: z.string().min(1).optional(),
        sourcePayloadHash: semanticDigestSchema.optional(),
        recognizedFormulaFunctions: z.array(z.string()),
        date1904: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();
export type XlsxCellProjection = z.infer<typeof xlsxCellProjectionSchema>;
export type XlsxTableProjection = z.infer<typeof xlsxTableProjectionSchema>;
export type XlsxChartProjection = z.infer<typeof xlsxChartProjectionSchema>;
export type XlsxSheetProjection = z.infer<typeof xlsxSheetProjectionSchema>;
export type XlsxProjection = z.infer<typeof xlsxProjectionSchema>;

export const xlsxOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set-cell"), sheetId: z.string(), ref: z.string(), value: xlsxCellValueSchema }).strict(),
  z.object({ kind: z.literal("set-formula"), sheetId: z.string(), ref: z.string(), formula: z.string() }).strict(),
  z.object({ kind: z.literal("clear-cell"), sheetId: z.string(), ref: z.string() }).strict(),
  z.object({ kind: z.literal("set-cell-format"), sheetId: z.string(), ref: z.string(), format: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ kind: z.literal("merge-cells"), sheetId: z.string(), range: z.string() }).strict(),
  z.object({ kind: z.literal("unmerge-cells"), sheetId: z.string(), range: z.string() }).strict(),
  z.object({ kind: z.literal("set-freeze-panes"), sheetId: z.string(), rows: z.number().int().nonnegative(), columns: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("add-sheet"), sheetId: z.string(), name: z.string(), index: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("remove-sheet"), sheetId: z.string() }).strict(),
  z.object({ kind: z.literal("rename-sheet"), sheetId: z.string(), name: z.string() }).strict(),
  z.object({ kind: z.literal("reorder-sheets"), order: z.array(z.string()) }).strict(),
  z.object({ kind: z.literal("set-sheet-properties"), sheetId: z.string(), properties: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ kind: z.literal("mutate-sheet-axis"), sheetId: z.string(), axis: z.enum(["row", "column"]), at: z.number().int().nonnegative(), delta: z.number().int().min(-1).max(1) }).strict(),
  z.object({ kind: z.literal("set-defined-names"), names: z.array(z.object({ name: z.string(), ref: z.string(), sheet: z.string().optional() }).strict()) }).strict(),
  z.object({ kind: z.literal("set-workbook-properties"), calculationMode: z.enum(["automatic", "manual"]).optional(), activeSheetId: z.string().optional() }).strict(),
  z.object({ kind: z.literal("upsert-table"), sheetId: z.string(), table: xlsxTableProjectionSchema }).strict(),
  z.object({ kind: z.literal("remove-table"), sheetId: z.string(), tableId: z.string() }).strict(),
  z.object({ kind: z.literal("upsert-chart"), sheetId: z.string(), chart: xlsxChartProjectionSchema }).strict(),
  z.object({ kind: z.literal("remove-chart"), sheetId: z.string(), chartId: z.string() }).strict(),
  z.object({ kind: z.literal("set-validations"), sheetId: z.string(), validations: z.array(xlsxNativeRuleSchema) }).strict(),
  z.object({ kind: z.literal("set-conditional-formats"), sheetId: z.string(), conditionalFormats: z.array(xlsxNativeRuleSchema) }).strict(),
]);
export const XLSX_LENS_DELTA_KINDS = xlsxOperationSchema.options.map(
  (operation) => operation.shape.kind.value,
);
export const xlsxSemanticDeltaSchema = z.union([
  xlsxOperationSchema,
  z.object({ kind: z.literal("ai-edit"), operations: z.array(xlsxOperationSchema) }).strict(),
]);
export type XlsxOperation = z.infer<typeof xlsxOperationSchema>;
export type XlsxSemanticDelta = z.infer<typeof xlsxSemanticDeltaSchema>;

export const presentationObjectProjectionSchema = z
  .object({
    id: z.string(),
    type: z.enum(["text", "shape", "image", "chart", "table", "embed", "video", "group"]),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    rotation: z.number(),
    content: z.unknown(),
    style: z.record(z.string(), z.unknown()).optional(),
    altText: z.string().optional(),
    locked: z.boolean().optional(),
    hidden: z.boolean().optional(),
    readingOrder: z.number().optional(),
    parentId: z.string().optional(),
    componentId: z.string().optional(),
    hyperlink: z.union([
      z.string(),
      z.object({ kind: z.literal("external"), url: z.string() }).strict(),
      z.object({ kind: z.literal("slide"), slideId: z.string() }).strict(),
    ]).optional(),
    sourceBinding: z
      .object({
        artifactId: z.string(),
        kind: z.enum(["artifact", "sheets_range"]),
        range: z.string().optional(),
        versionId: z.string().optional(),
        live: z.boolean().optional(),
      })
      .strict()
      .optional(),
    animation: z
      .object({
        kind: z.enum(["none", "fade", "rise", "scale", "wipe"]),
        durationMs: z.number().optional(),
        delayMs: z.number().optional(),
      })
      .strict()
      .optional(),
  })
  .passthrough();
export const pptxSlideProjectionSchema = z
  .object({
    id: z.string(),
    index: z.number().int().nonnegative(),
    title: z.string(),
    text: z.array(z.string()),
    objects: z.array(presentationObjectProjectionSchema),
    layoutPartName: z.string().optional(),
    hasTransition: z.boolean(),
    hasTiming: z.boolean(),
    hidden: z.boolean().optional(),
    speakerNotes: z.string(),
    notesPartName: z.string().optional(),
  })
  .strict();
export const pptxProjectionSchema = z
  .object({
    slides: z.array(pptxSlideProjectionSchema),
    nativeBinding: z
      .object({
        ...nativeBindingBase,
        format: z.enum(["pptx", "pptm", "potx", "potm", "ppsx", "ppsm", "ppam"]),
        // Bound by the authenticated route, never by the format lens. These
        // two small values let the client resolve native picture parts without
        // duplicating package bytes into artifact content.
        sourceArtifactId: z.string().min(1).optional(),
        sourcePayloadHash: semanticDigestSchema.optional(),
        themeFonts: z
          .object({ heading: z.string().optional(), body: z.string().optional() })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();
export type PptxSlideProjection = z.infer<typeof pptxSlideProjectionSchema>;
export type PptxProjection = z.infer<typeof pptxProjectionSchema>;

export const pptxOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set-title"), slideId: z.string(), text: z.string() }).strict(),
  z.object({ kind: z.literal("set-text"), slideId: z.string(), paragraphIndex: z.number().int().nonnegative(), text: z.string(), shapeId: z.string().optional() }).strict(),
  z.object({ kind: z.literal("add-text-box"), slideId: z.string(), text: z.string(), hyperlink: z.union([
    z.string(),
    z.object({ kind: z.literal("external"), url: z.string() }).strict(),
    z.object({ kind: z.literal("slide"), slideId: z.string() }).strict(),
  ]).optional() }).strict(),
  z.object({ kind: z.literal("set-notes"), slideId: z.string(), text: z.string() }).strict(),
  z.object({ kind: z.literal("set-slide-hidden"), slideId: z.string(), hidden: z.boolean() }).strict(),
  z.object({ kind: z.literal("set-alt-text"), slideId: z.string(), shapeId: z.string(), text: z.string() }).strict(),
  z.object({ kind: z.literal("set-geometry"), slideId: z.string(), shapeId: z.string(), x: z.number(), y: z.number(), width: z.number(), height: z.number(), rotation: z.number() }).strict(),
  z.object({ kind: z.literal("format-rich-text"), slideId: z.string(), shapeId: z.string(), paragraphs: z.array(z.object({ runs: z.array(z.object({ text: z.string(), fontFamily: z.string().optional(), fontSizePt: z.number().positive().optional(), bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(), strike: z.boolean().optional(), color: z.string().optional(), hyperlink: z.union([z.string(), z.object({ kind: z.literal("external"), url: z.string() }).strict(), z.object({ kind: z.literal("slide"), slideId: z.string() }).strict()]).optional() }).strict()), alignment: z.enum(["left", "center", "right", "justify"]).optional(), level: z.number().int().nonnegative().optional(), bullet: z.enum(["none", "bullet", "numbered"]).optional() }).strict()) }).strict(),
  z.object({ kind: z.literal("set-object-link"), slideId: z.string(), shapeId: z.string(), hyperlink: z.union([
    z.string(),
    z.object({ kind: z.literal("external"), url: z.string() }).strict(),
    z.object({ kind: z.literal("slide"), slideId: z.string() }).strict(),
  ]).nullable() }).strict(),
  z.object({ kind: z.literal("format-text"), slideId: z.string(), shapeId: z.string(), format: z.object({ fontFamily: z.string().nullable().optional(), fontSizePt: z.number().positive().nullable().optional(), bold: z.boolean().nullable().optional(), italic: z.boolean().nullable().optional(), underline: z.boolean().nullable().optional(), strike: z.boolean().nullable().optional(), color: z.string().nullable().optional(), align: z.enum(["left", "center", "right", "justify"]).nullable().optional(), level: z.number().int().nonnegative().nullable().optional() }).strict() }).strict(),
  z.object({ kind: z.literal("set-shape-style"), slideId: z.string(), shapeId: z.string(), style: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ kind: z.literal("set-image-crop"), slideId: z.string(), shapeId: z.string(), crop: z.object({ left: z.number().min(0).max(100), top: z.number().min(0).max(100), right: z.number().min(0).max(100), bottom: z.number().min(0).max(100) }).strict() }).strict(),
  z.object({ kind: z.literal("set-table-cell-text"), slideId: z.string(), shapeId: z.string(), row: z.number().int().nonnegative(), column: z.number().int().nonnegative(), text: z.string() }).strict(),
  z.object({ kind: z.literal("set-table-cell-format"), slideId: z.string(), shapeId: z.string(), row: z.number().int().nonnegative(), column: z.number().int().nonnegative(), format: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ kind: z.literal("set-chart"), slideId: z.string(), shapeId: z.string(), chartType: z.enum(["bar", "column", "line", "pie", "area"]).optional(), title: z.string().nullable().optional(), categories: z.array(z.string()), series: z.array(z.object({ id: z.string().optional(), name: z.string(), categories: z.array(z.string()), values: z.array(z.number()) }).strict()), showLegend: z.boolean().optional(), axisTitle: z.string().nullable().optional(), valueAxisTitle: z.string().nullable().optional(), sourceArtifactId: z.string().optional(), sourceChartId: z.string().optional(), sourceRevision: z.string().optional(), sourceKind: z.enum(["artifact", "sheets_range"]).optional(), sourceRange: z.string().optional(), sourceLive: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("group-objects"), slideId: z.string(), groupId: z.string(), childShapeIds: z.array(z.string()).min(2), x: z.number(), y: z.number(), width: z.number(), height: z.number(), rotation: z.number(), readingOrder: z.number().int().nonnegative().optional() }).strict(),
  z.object({ kind: z.literal("set-object-state"), slideId: z.string(), shapeId: z.string(), hidden: z.boolean().optional(), readingOrder: z.number().int().nonnegative().optional(), parentId: z.string().nullable().optional(), childIds: z.array(z.string()).optional() }).strict(),
  z.object({ kind: z.literal("remove-object"), slideId: z.string(), shapeId: z.string() }).strict(),
  z.object({ kind: z.literal("set-theme-fonts"), heading: z.string().optional(), body: z.string().optional() }).strict(),
  z.object({ kind: z.literal("duplicate-slide"), slideId: z.string(), newSlideId: z.string(), title: z.string().optional() }).strict(),
  z.object({ kind: z.literal("add-slide"), slideId: z.string(), layoutPartName: z.string().optional(), title: z.string().optional(), text: z.array(z.string()).optional(), objects: z.array(presentationObjectProjectionSchema).optional() }).strict(),
  z.object({ kind: z.literal("remove-slide"), slideId: z.string() }).strict(),
  z.object({ kind: z.literal("reorder-slides"), order: z.array(z.string()) }).strict(),
]);
export const PPTX_LENS_DELTA_KINDS = pptxOperationSchema.options.map(
  (operation) => operation.shape.kind.value,
);
export const pptxSemanticDeltaSchema = z.union([
  pptxOperationSchema,
  z.object({ kind: z.literal("ai-edit"), operations: z.array(pptxOperationSchema) }).strict(),
]);
export type PptxOperation = z.infer<typeof pptxOperationSchema>;
export type PptxSemanticDelta = z.infer<typeof pptxSemanticDeltaSchema>;

export const nativeEditorIntentSchema = z.discriminatedUnion("format", [
  z.object({ format: z.literal("docx"), operations: z.array(docxOperationSchema) }).strict(),
  z.object({ format: z.literal("xlsx"), operations: z.array(xlsxOperationSchema) }).strict(),
  z.object({ format: z.literal("pptx"), operations: z.array(pptxOperationSchema) }).strict(),
]);
export type NativeEditorIntent = z.infer<typeof nativeEditorIntentSchema>;
