import { z } from "zod";
import { preservedRegionRefusal } from "../commands/registry";
import type { FidelityRegionKey } from "../commands/types";
import type { WorkCapability } from "../work/registry";
import { availabilityFor } from "./native";
import {
  DOCUMENT_EXPORT_COPIES,
  PRESENTATION_EXPORT_COPIES,
  SHEETS_EXPORT_COPIES,
} from "./office-exports";
import {
  DOCUMENT_NATIVE_REASONS,
  PRESENTATION_STRICT_REASONS,
  SHEETS_NATIVE_REASONS,
} from "./office-reasons";
import type {
  AuthorityRisk,
  CapabilityDefinition,
  NativeCapability,
  OfficeLensDeltaKind,
  OfficeWorkType,
} from "./types";

const none = z.null();
const text = z.string();
const num = z.number();
const bool = z.boolean();
const maybeText = z.string().nullable();
const record = z.record(z.string(), z.unknown());

type SpecOptions<T extends OfficeWorkType> = {
  params?: z.ZodType;
  risk?: AuthorityRisk;
  requires?: WorkCapability | false;
  exposed?: boolean;
  delta?: OfficeLensDeltaKind<T>;
  reason?: string;
  touches?: readonly FidelityRegionKey[];
  manifest?: string;
  field?: boolean;
};

type Spec<T extends OfficeWorkType> = readonly [
  id: string,
  description: string,
  options?: SpecOptions<T>,
];

function defineRemaining<T extends OfficeWorkType>(
  type: T,
  specs: readonly Spec<T>[],
): CapabilityDefinition<T>[] {
  const definitions = specs.map(([localId, description, options = {}]) => {
    const requires =
      options.requires === false ? undefined : (options.requires ?? "edit");
    let native: NativeCapability<T> | undefined;
    if (options.delta) {
      native = {
        touches: options.touches ?? [],
        delta: options.delta,
        ...(options.reason ? { unavailableReason: options.reason } : {}),
      };
    } else if (options.reason) {
      native = {
        touches: options.touches ?? [],
        unavailableReason: options.reason,
      };
    }
    const exposed =
      options.exposed ?? Boolean(options.manifest || options.delta);
    return {
      id: `${type}.${localId}` as CapabilityDefinition<T>["id"],
      params: options.params ?? none,
      scope: "artifact",
      availability: availabilityFor(
        native as NativeCapability<OfficeWorkType> | undefined,
        requires,
      ),
      ...(native ? { native } : {}),
      execute: { editor: `${type}.${localId}` },
      ai: {
        exposed,
        description,
        riskClass: options.risk ?? "safe",
      },
      choreography: {
        target: options.field ? "workbar-field" : "workbar-command",
        region: `${type}.${localId}`,
      },
      ...(requires ? { requires } : {}),
      ...(options.manifest ? { manifestOperation: options.manifest } : {}),
    };
  });
  // `type`, the capability id, and the native delta are produced together.
  // Keep the assertion local because TypeScript cannot simplify the generic
  // conditional `CapabilityDefinition<T>["native"]` at this boundary.
  return definitions as unknown as CapabilityDefinition<T>[];
}

function sharedFamily<T extends OfficeWorkType>(
  type: T,
  extras: {
    importReason: string;
    importManifest?: string;
    exportFormats: readonly string[];
    exportManifest?: string;
    zoom: boolean;
    /** Fit-to-window is a real control only where the studio mounts one. */
    zoomFit?: boolean;
    /** Replace is a real control only where the studio passes `toggleReplace`. */
    replace?: boolean;
  },
): Spec<T>[] {
  return [
    ["history.undo", "Step back through your edits."],
    ["history.redo", "Step forward through undone edits."],
    [
      "navigate.find",
      "Find text in this work.",
      { requires: false, exposed: false },
    ],
    ...(extras.replace
      ? ([
          [
            "navigate.replace",
            "Find and replace text in this work.",
            { exposed: false },
          ],
        ] satisfies Spec<T>[])
      : []),
    [
      "review.comments",
      "Show or hide Spectra comments on this work.",
      { requires: false, exposed: false },
    ],
    ...(extras.zoom
      ? ([
          ["view.zoom.in", "Zoom in.", { requires: false, exposed: false }],
          ["view.zoom.out", "Zoom out.", { requires: false, exposed: false }],
          [
            "view.zoom.reset",
            "Reset zoom to 100%.",
            { requires: false, exposed: false },
          ],
          ...(extras.zoomFit
            ? ([
                [
                  "view.zoom.fit",
                  "Fit the canvas to the window.",
                  { requires: false, exposed: false },
                ],
              ] satisfies Spec<T>[])
            : []),
        ] satisfies Spec<T>[])
      : []),
    [
      "import.copy",
      "Import a separate copy without replacing a linked file.",
      {
        reason: extras.importReason,
        exposed: true,
        ...(extras.importManifest ? { manifest: extras.importManifest } : {}),
      },
    ],
    [
      "export.print",
      "Print or save a PDF of this work.",
      { requires: false, exposed: false },
    ],
    ...extras.exportFormats.map(
      (format): Spec<T> => [
        `export.${format}`,
        `Download a separate ${format} copy. A linked native file is never replaced.`,
        {
          requires: false,
          exposed: Boolean(extras.exportManifest),
          ...(extras.exportManifest ? { manifest: extras.exportManifest } : {}),
        },
      ],
    ),
  ];
}

const DOCUMENT_SPECS: Spec<"document">[] = [
  ...sharedFamily("document", {
    importReason: DOCUMENT_NATIVE_REASONS.importCopy,
    exportFormats: DOCUMENT_EXPORT_COPIES.map((copy) => copy.format),
    exportManifest: "prepare_export",
    zoom: false,
    replace: true,
  }),
  [
    "navigate.outline",
    "Show or hide the document outline.",
    { requires: false, exposed: false },
  ],
  [
    "format.paragraphSpacing",
    "Set space after the current paragraph.",
    { params: num, delta: "format-paragraph", touches: ["body"], field: true },
  ],
  [
    "format.border",
    "Set a border on the current paragraph.",
    { params: text, delta: "format-paragraph", touches: ["body"], field: true },
  ],
  [
    "format.shading",
    "Set shading on the current paragraph.",
    {
      params: maybeText,
      delta: "format-paragraph",
      touches: ["body"],
      field: true,
    },
  ],
  [
    "format.quote",
    "Turn the current block into a quote.",
    { params: bool, delta: "apply-style", touches: ["styles"], manifest: "format_blocks" },
  ],
  [
    "format.code.inline",
    "Mark the selection as inline code.",
    { params: bool, delta: "format-runs", touches: ["body"], manifest: "format_blocks" },
  ],
  [
    "format.code.block",
    "Turn the current block into a code block.",
    { params: bool, delta: "apply-style", touches: ["styles"], manifest: "format_blocks" },
  ],
  [
    "format.list.demote",
    "Nest the current list item one level deeper.",
    {
      reason: preservedRegionRefusal("lists"),
      touches: ["lists"],
      manifest: "format_blocks",
    },
  ],
  [
    "format.list.promote",
    "Promote the current list item one level.",
    {
      reason: preservedRegionRefusal("lists"),
      touches: ["lists"],
      manifest: "format_blocks",
    },
  ],
  [
    "format.block.moveUp",
    "Move the current block earlier in the document.",
    { delta: "reorder-regions", touches: ["body"], manifest: "move_blocks" },
  ],
  [
    "format.block.moveDown",
    "Move the current block later in the document.",
    { delta: "reorder-regions", touches: ["body"], manifest: "move_blocks" },
  ],
  [
    "format.namedStyle.apply",
    "Apply a named paragraph style to the current block.",
    {
      params: text,
      delta: "apply-style",
      touches: ["styles"],
      manifest: "format_blocks",
      field: true,
    },
  ],
  [
    "format.namedStyle.create",
    "Create a named style from the current formatting.",
    {
      reason: DOCUMENT_NATIVE_REASONS.styleCreate,
      touches: ["styles"],
    },
  ],
  [
    "review.spellcheck",
    "Show or hide spelling marks.",
    { params: bool, requires: false, exposed: false },
  ],
  [
    "insert.callout.info",
    "Insert an info callout at the caret.",
    { delta: "insert-paragraph", touches: ["body"], manifest: "insert_callout" },
  ],
  [
    "insert.callout.warning",
    "Insert a warning callout at the caret.",
    { delta: "insert-paragraph", touches: ["body"], manifest: "insert_callout" },
  ],
  [
    "insert.callout.tip",
    "Insert a tip callout at the caret.",
    { delta: "insert-paragraph", touches: ["body"], manifest: "insert_callout" },
  ],
  [
    "insert.table",
    "Insert a table at the caret.",
    {
      reason: DOCUMENT_NATIVE_REASONS.tableStructure,
      touches: ["tableStructure"],
      manifest: "create_table",
    },
  ],
  [
    "insert.image",
    "Place a picture from this device.",
    { delta: "insert-image", touches: ["images"] },
  ],
  [
    "insert.link",
    "Link the selected text to a web address.",
    { reason: DOCUMENT_NATIVE_REASONS.hyperlink, touches: ["hyperlinks"] },
  ],
  [
    "insert.link.remove",
    "Remove the hyperlink from the selected text.",
    { reason: DOCUMENT_NATIVE_REASONS.hyperlink, touches: ["hyperlinks"] },
  ],
  [
    "insert.equation",
    "Insert a display equation.",
    {
      reason: DOCUMENT_NATIVE_REASONS.equationInsert,
      touches: ["equations"],
      manifest: "insert_equation",
    },
  ],
  [
    "insert.equation.inline",
    "Insert an inline equation.",
    {
      reason: DOCUMENT_NATIVE_REASONS.equationInsert,
      touches: ["equations"],
      manifest: "insert_equation",
    },
  ],
  [
    "insert.pageBreak",
    "Insert a page break at the caret.",
    { delta: "insert-paragraph", touches: ["body"], manifest: "insert_blocks" },
  ],
  [
    "insert.sectionBreak",
    "Insert a section break at the caret.",
    {
      reason: DOCUMENT_NATIVE_REASONS.section,
      touches: ["sections"],
      manifest: "insert_blocks",
    },
  ],
  [
    "insert.divider",
    "Insert a divider at the caret.",
    { delta: "insert-paragraph", touches: ["body"], manifest: "insert_blocks" },
  ],
  [
    "insert.taskList",
    "Insert a task list at the caret.",
    { delta: "insert-paragraph", touches: ["lists"], manifest: "insert_blocks" },
  ],
  [
    "insert.reference",
    "Show another Spectra work here without copying it.",
    { reason: DOCUMENT_NATIVE_REASONS.embed, manifest: "add_embed" },
  ],
  [
    "insert.citation",
    "Cite a source this document carries.",
    { delta: "insert-paragraph", touches: ["body"], manifest: "add_citation" },
  ],
  [
    "insert.footnote",
    "Insert a footnote at the caret.",
    {
      reason: DOCUMENT_NATIVE_REASONS.footnote,
      touches: ["footnotes"],
      manifest: "insert_blocks",
    },
  ],
  [
    "insert.endnote",
    "Insert an endnote at the caret.",
    {
      reason: DOCUMENT_NATIVE_REASONS.footnote,
      touches: ["footnotes"],
      manifest: "insert_blocks",
    },
  ],
  [
    "insert.caption",
    "Insert a caption under the selected image or table.",
    { delta: "insert-paragraph", touches: ["body"], manifest: "insert_blocks" },
  ],
  [
    "insert.toc",
    "Insert a table of contents field.",
    {
      reason: DOCUMENT_NATIVE_REASONS.field,
      touches: ["fields"],
      manifest: "insert_blocks",
    },
  ],
  [
    "table.row.after",
    "Add a row under the caret.",
    { delta: "insert-table-row", touches: ["tableStructure"] },
  ],
  [
    "table.column.after",
    "Add a column to the right of the caret.",
    { delta: "insert-table-column", touches: ["tableStructure"] },
  ],
  [
    "table.row.before",
    "Add a row above the caret.",
    { delta: "insert-table-row", touches: ["tableStructure"] },
  ],
  [
    "table.column.before",
    "Add a column to the left of the caret.",
    { delta: "insert-table-column", touches: ["tableStructure"] },
  ],
  [
    "table.merge",
    "Join the selected cells into one.",
    { reason: DOCUMENT_NATIVE_REASONS.tableStructure, touches: ["tableStructure"] },
  ],
  [
    "table.split",
    "Return a merged cell to separate cells.",
    { reason: DOCUMENT_NATIVE_REASONS.tableStructure, touches: ["tableStructure"] },
  ],
  [
    "table.headerRow",
    "Treat the first row as headings.",
    {
      params: bool,
      reason: DOCUMENT_NATIVE_REASONS.tableStructure,
      touches: ["tableStructure"],
    },
  ],
  [
    "table.row.delete",
    "Remove the row the caret is in.",
    {
      delta: "delete-table-row",
      touches: ["tableStructure"],
      risk: "confirm",
    },
  ],
  [
    "table.column.delete",
    "Remove the column the caret is in.",
    {
      delta: "delete-table-column",
      touches: ["tableStructure"],
      risk: "confirm",
    },
  ],
  [
    "table.delete",
    "Remove the whole table and its contents.",
    {
      reason: DOCUMENT_NATIVE_REASONS.tableStructure,
      touches: ["tableStructure"],
      risk: "destructive",
    },
  ],
  [
    "image.wrap",
    "Set how text flows around this picture.",
    {
      params: text,
      reason: DOCUMENT_NATIVE_REASONS.image,
      touches: ["images"],
      field: true,
    },
  ],
  [
    "image.width",
    "Set the width of this picture.",
    {
      params: num,
      delta: "update-image",
      touches: ["images"],
      field: true,
    },
  ],
  [
    "image.alt",
    "Set alternative text for this picture.",
    {
      params: text,
      delta: "update-image",
      touches: ["images"],
      field: true,
    },
  ],
  [
    "image.replace",
    "Replace this picture with another PNG or JPEG.",
    { delta: "replace-image", touches: ["images"], risk: "confirm" },
  ],
  [
    "image.caption",
    "Add a caption under this picture.",
    { delta: "insert-paragraph", touches: ["body"] },
  ],
  [
    "image.remove",
    "Remove this picture.",
    { delta: "delete-region", touches: ["images"], risk: "confirm" },
  ],
  [
    "equation.edit",
    "Edit this equation.",
    { delta: "replace-paragraph", touches: ["equations"] },
  ],
  [
    "equation.display",
    "Switch this equation between inline and display.",
    {
      params: text,
      reason: DOCUMENT_NATIVE_REASONS.equationLayout,
      touches: ["equations"],
      field: true,
    },
  ],
  [
    "equation.align",
    "Set alignment for this equation.",
    {
      params: text,
      reason: DOCUMENT_NATIVE_REASONS.equationLayout,
      touches: ["equations"],
      field: true,
    },
  ],
  [
    "equation.remove",
    "Remove this equation.",
    { delta: "delete-region", touches: ["equations"], risk: "confirm" },
  ],
  [
    "layout.pageSize",
    "Set the paper size for the page canvas, print, and the PDF copy.",
    {
      params: text,
      delta: "update-section",
      touches: ["sections"],
      field: true,
    },
  ],
  [
    "layout.orientation",
    "Set portrait or landscape for the page.",
    {
      params: text,
      delta: "update-section",
      touches: ["sections"],
      field: true,
    },
  ],
  [
    "layout.margins",
    "Set page margins.",
    {
      params: text,
      delta: "update-section",
      touches: ["sections"],
      field: true,
    },
  ],
  [
    "layout.columns",
    "Set the number of columns on the page.",
    {
      params: num,
      delta: "update-section",
      touches: ["sections"],
      field: true,
    },
  ],
  [
    "layout.header",
    "Edit the page header.",
    {
      delta: "update-header-footer",
      touches: ["headersFooters"],
    },
  ],
  [
    "layout.footer",
    "Edit the page footer.",
    {
      delta: "update-header-footer",
      touches: ["headersFooters"],
    },
  ],
  [
    "layout.pageCanvas",
    "Show page edges as they will print, or one continuous surface.",
    { params: bool, requires: false, exposed: false },
  ],
  [
    "layout.focus",
    "Hide everything except the text.",
    { params: bool, requires: false, exposed: false },
  ],
  [
    "layout.previewReader",
    "Read the document the way a shared viewer sees it.",
    { requires: false, exposed: false },
  ],
  [
    "layout.template.notes",
    "Replace this document with the study-notes structure.",
    {
      reason: DOCUMENT_NATIVE_REASONS.template,
      manifest: "apply_template",
      risk: "confirm",
    },
  ],
  [
    "layout.template.essay",
    "Replace this document with the essay structure.",
    {
      reason: DOCUMENT_NATIVE_REASONS.template,
      manifest: "apply_template",
      risk: "confirm",
    },
  ],
  [
    "layout.template.lab",
    "Replace this document with the lab-report structure.",
    {
      reason: DOCUMENT_NATIVE_REASONS.template,
      manifest: "apply_template",
      risk: "confirm",
    },
  ],
  [
    "references.sources",
    "Show or hide the source list.",
    { requires: false, exposed: false },
  ],
  [
    "references.bibliography",
    "Insert a bibliography from the citations in this document.",
    { delta: "insert-paragraph", touches: ["body"] },
  ],
  [
    "references.citationStyle",
    "Set the citation style for this document.",
    { params: text, delta: "insert-paragraph", touches: ["body"], field: true },
  ],
  [
    "references.source.add",
    "Add a source to this document.",
    { delta: "insert-paragraph", touches: ["body"] },
  ],
  [
    "references.crossRef",
    "Insert a cross-reference.",
    { reason: DOCUMENT_NATIVE_REASONS.hyperlink, touches: ["hyperlinks"] },
  ],
  [
    "review.trackChanges.show",
    "Show tracked revisions in this document.",
    { requires: false, exposed: false },
  ],
  [
    "review.trackChanges.accept",
    "Accept every tracked revision in this document.",
    { reason: DOCUMENT_NATIVE_REASONS.trackChanges, risk: "confirm" },
  ],
  [
    "review.trackChanges.reject",
    "Reject every tracked revision in this document.",
    { reason: DOCUMENT_NATIVE_REASONS.trackChanges, risk: "confirm" },
  ],
  [
    "review.updateFields",
    "Update fields in this document.",
    { reason: DOCUMENT_NATIVE_REASONS.field, touches: ["fields"] },
  ],
  [
    "rewrite.paragraph",
    "Replace the text of a paragraph.",
    {
      params: text,
      delta: "replace-paragraph",
      touches: ["body"],
      manifest: "rewrite_blocks",
    },
  ],
  [
    "edit.tableCell",
    "Edit the text of a table cell.",
    {
      params: text,
      delta: "edit-table-cell",
      touches: ["tables"],
      manifest: "edit_table_cell",
    },
  ],
];

const SHEETS_SPECS: Spec<"sheets">[] = [
  ...sharedFamily("sheets", {
    importReason: SHEETS_NATIVE_REASONS.importCopy,
    importManifest: "import_data",
    exportFormats: SHEETS_EXPORT_COPIES.map((copy) => copy.format),
    zoom: true,
    replace: true,
  }),
  [
    "format",
    "Open number format, font, borders and fill for the selection.",
    { exposed: false },
  ],
  [
    "formula.bar",
    "Edit the active cell's formula.",
    { delta: "set-formula", touches: ["formulas"], manifest: "set_formula" },
  ],
  [
    "freeze.rows",
    "Keep the rows above the selection in view while scrolling.",
    { params: bool, delta: "set-freeze-panes", touches: ["freezePanes"] },
  ],
  [
    "chart.insert",
    "Chart the selected range.",
    {
      delta: "upsert-chart",
      touches: ["charts"],
      manifest: "create_chart",
    },
  ],
  [
    "clipboard.copy",
    "Copy the selected cells with their formulas and formatting.",
    { requires: false, exposed: false },
  ],
  [
    "clipboard.cut",
    "Copy the selection, then clear it when you paste.",
    { delta: "clear-cell", touches: ["cells"], manifest: "clear_range" },
  ],
  [
    "clipboard.paste",
    "Paste at the selection.",
    { delta: "set-cell", touches: ["cells"], manifest: "set_cells" },
  ],
  [
    "clipboard.pasteSpecial",
    "Paste values, formulas, or formatting.",
    {
      params: text,
      delta: "set-cell",
      touches: ["cells"],
      manifest: "set_cells",
      field: true,
    },
  ],
  [
    "clear.all",
    "Remove values and formatting in the selection.",
    { delta: "clear-cell", touches: ["cells"], manifest: "clear_range" },
  ],
  [
    "clear.values",
    "Remove values in the selection, keeping formatting.",
    { delta: "clear-cell", touches: ["cells"], manifest: "clear_range" },
  ],
  [
    "clear.formats",
    "Remove formatting in the selection, keeping values.",
    { delta: "set-cell-format", touches: ["styles"], manifest: "format_range" },
  ],
  [
    "fill.down",
    "Fill the selection down from the first row.",
    { delta: "set-cell", touches: ["cells"], manifest: "fill_range" },
  ],
  [
    "fill.right",
    "Fill the selection right from the first column.",
    { delta: "set-cell", touches: ["cells"], manifest: "fill_range" },
  ],
  [
    "fill.series",
    "Fill a series through the selection.",
    {
      params: text,
      delta: "set-cell",
      touches: ["cells"],
      manifest: "fill_range",
      field: true,
    },
  ],
  [
    "format.number",
    "Set the number format of the selection.",
    {
      params: text,
      delta: "set-cell-format",
      touches: ["numberFormats"],
      manifest: "format_range",
      field: true,
    },
  ],
  [
    "format.number.custom",
    "Set a custom number format code.",
    {
      params: text,
      delta: "set-cell-format",
      touches: ["numberFormats"],
      manifest: "format_range",
      field: true,
    },
  ],
  [
    "format.currency",
    "Set a currency format on the selection.",
    {
      params: text,
      delta: "set-cell-format",
      touches: ["numberFormats"],
      manifest: "format_range",
      field: true,
    },
  ],
  [
    "format.decimals",
    "Set how many decimal places the selection shows.",
    {
      params: num,
      delta: "set-cell-format",
      touches: ["numberFormats"],
      manifest: "format_range",
      field: true,
    },
  ],
  [
    "format.thousands",
    "Toggle thousands separators on the selection.",
    {
      params: bool,
      delta: "set-cell-format",
      touches: ["numberFormats"],
      manifest: "format_range",
    },
  ],
  [
    "format.borders",
    "Apply a border preset to the selection.",
    {
      params: text,
      delta: "set-cell-format",
      touches: ["styles"],
      manifest: "format_range",
      field: true,
    },
  ],
  [
    "format.borders.style",
    "Set the border style of the selection.",
    {
      params: text,
      delta: "set-cell-format",
      touches: ["styles"],
      manifest: "format_range",
      field: true,
    },
  ],
  [
    "format.borders.color",
    "Set the border colour of the selection.",
    {
      params: maybeText,
      delta: "set-cell-format",
      touches: ["styles"],
      manifest: "format_range",
      field: true,
    },
  ],
  [
    "format.fill",
    "Set the fill colour of the selection.",
    {
      params: maybeText,
      delta: "set-cell-format",
      touches: ["styles"],
      manifest: "format_range",
      field: true,
    },
  ],
  [
    "format.wrap",
    "Wrap text in the selected cells.",
    {
      params: bool,
      delta: "set-cell-format",
      touches: ["styles"],
      manifest: "format_range",
    },
  ],
  [
    "format.valign",
    "Set vertical alignment of the selection.",
    {
      params: text,
      delta: "set-cell-format",
      touches: ["styles"],
      manifest: "format_range",
      field: true,
    },
  ],
  [
    "format.rotation",
    "Set text rotation of the selection.",
    {
      params: num,
      delta: "set-cell-format",
      touches: ["styles"],
      manifest: "format_range",
      field: true,
    },
  ],
  [
    "format.indent.increase",
    "Increase indentation of the selection.",
    { delta: "set-cell-format", touches: ["styles"], manifest: "format_range" },
  ],
  [
    "format.indent.decrease",
    "Decrease indentation of the selection.",
    { delta: "set-cell-format", touches: ["styles"], manifest: "format_range" },
  ],
  [
    "format.merge",
    "Merge the selected cells.",
    { delta: "merge-cells", touches: ["merges"] },
  ],
  [
    "format.unmerge",
    "Unmerge the selected cells.",
    { delta: "unmerge-cells", touches: ["merges"] },
  ],
  [
    "format.copyStyle",
    "Copy formatting from the selection.",
    { exposed: false },
  ],
  [
    "format.pasteStyle",
    "Paste copied formatting onto the selection.",
    { delta: "set-cell-format", touches: ["styles"], manifest: "format_range" },
  ],
  [
    "insert.row",
    "Insert a row at the selection.",
    {
      delta: "mutate-sheet-axis",
      touches: ["sheetStructure"],
      manifest: "insert_structure",
    },
  ],
  [
    "insert.column",
    "Insert a column at the selection.",
    {
      delta: "mutate-sheet-axis",
      touches: ["sheetStructure"],
      manifest: "insert_structure",
    },
  ],
  [
    "delete.row",
    "Delete the selected rows.",
    {
      delta: "mutate-sheet-axis",
      touches: ["sheetStructure"],
      manifest: "insert_structure",
      risk: "confirm",
    },
  ],
  [
    "delete.column",
    "Delete the selected columns.",
    {
      delta: "mutate-sheet-axis",
      touches: ["sheetStructure"],
      manifest: "insert_structure",
      risk: "confirm",
    },
  ],
  [
    "format.column.width",
    "Set the width of the selected columns.",
    {
      params: num,
      delta: "set-sheet-properties",
      touches: ["dimensions"],
      manifest: "format_range",
      field: true,
    },
  ],
  [
    "format.row.height",
    "Set the height of the selected rows.",
    {
      params: num,
      delta: "set-sheet-properties",
      touches: ["dimensions"],
      manifest: "format_range",
      field: true,
    },
  ],
  [
    "format.column.autofit",
    "Fit the selected columns to their contents.",
    {
      delta: "set-sheet-properties",
      touches: ["dimensions"],
      manifest: "format_range",
    },
  ],
  [
    "hide.row",
    "Hide the selected rows.",
    {
      delta: "set-sheet-properties",
      touches: ["dimensions"],
      manifest: "format_range",
    },
  ],
  [
    "hide.column",
    "Hide the selected columns.",
    {
      delta: "set-sheet-properties",
      touches: ["dimensions"],
      manifest: "format_range",
    },
  ],
  [
    "unhide.all",
    "Unhide hidden rows and columns.",
    {
      delta: "set-sheet-properties",
      touches: ["dimensions"],
      manifest: "format_range",
    },
  ],
  [
    "freeze.columns",
    "Keep the columns left of the selection in view while scrolling.",
    { params: bool, delta: "set-freeze-panes", touches: ["freezePanes"] },
  ],
  [
    "freeze.clear",
    "Clear frozen rows and columns.",
    { delta: "set-freeze-panes", touches: ["freezePanes"] },
  ],
  [
    "view.formulas",
    "Show formulas instead of results.",
    { params: bool, requires: false, exposed: false },
  ],
  [
    "view.gridlines",
    "Show or hide gridlines.",
    { params: bool, requires: false, exposed: false },
  ],
  [
    "view.headings",
    "Show or hide row and column headings.",
    { params: bool, requires: false, exposed: false },
  ],
  [
    "sort.asc",
    "Sort the selection A to Z.",
    {
      reason: SHEETS_NATIVE_REASONS.sort,
      touches: ["sortFilter"],
      manifest: "sort_filter",
    },
  ],
  [
    "sort.desc",
    "Sort the selection Z to A.",
    {
      reason: SHEETS_NATIVE_REASONS.sort,
      touches: ["sortFilter"],
      manifest: "sort_filter",
    },
  ],
  [
    "sort.custom",
    "Sort the selection with a custom order.",
    {
      reason: SHEETS_NATIVE_REASONS.sort,
      touches: ["sortFilter"],
      manifest: "sort_filter",
    },
  ],
  [
    "filter.toggle",
    "Turn AutoFilter on or off for the selection.",
    {
      params: bool,
      reason: SHEETS_NATIVE_REASONS.filter,
      touches: ["sortFilter"],
      manifest: "sort_filter",
    },
  ],
  [
    "filter.edit",
    "Edit the current filter.",
    {
      reason: SHEETS_NATIVE_REASONS.filter,
      touches: ["sortFilter"],
      manifest: "sort_filter",
    },
  ],
  [
    "table.create",
    "Create an Excel table from the selection.",
    {
      delta: "upsert-table",
      touches: ["tables"],
      manifest: "create_table",
    },
  ],
  [
    "table.style",
    "Set the style of the current table.",
    {
      params: text,
      delta: "upsert-table",
      touches: ["tables"],
      manifest: "create_table",
      field: true,
    },
  ],
  [
    "table.totals",
    "Show or hide the totals row on the current table.",
    {
      params: bool,
      delta: "upsert-table",
      touches: ["tables"],
      manifest: "create_table",
    },
  ],
  [
    "table.delete",
    "Remove the current native Excel table while keeping its cells.",
    {
      delta: "remove-table",
      touches: ["tables"],
      manifest: "delete_table",
      risk: "destructive",
    },
  ],
  [
    "validation.set",
    "Set data validation on the selection.",
    {
      reason: SHEETS_NATIVE_REASONS.validation,
      touches: ["validation"],
      manifest: "validate_range",
    },
  ],
  [
    "conditional.apply",
    "Apply conditional formatting to the selection.",
    {
      reason: SHEETS_NATIVE_REASONS.conditional,
      touches: ["conditionalFormat"],
      manifest: "format_range",
    },
  ],
  [
    "data.duplicates",
    "Highlight or remove duplicate values.",
    {
      reason: SHEETS_NATIVE_REASONS.duplicateRows,
      touches: ["sortFilter"],
      manifest: "sort_filter",
    },
  ],
  [
    "data.splitText",
    "Split text in the selection across columns.",
    { delta: "set-cell", touches: ["cells"], manifest: "set_cells" },
  ],
  [
    "analyze.summary",
    "Summarise the selected range.",
    { requires: false, exposed: false },
  ],
  [
    "formula.insert",
    "Insert a function template in the formula bar.",
    {
      params: text,
      delta: "set-formula",
      touches: ["formulas"],
      manifest: "set_formula",
      field: true,
    },
  ],
  [
    "formula.autosum",
    "Total the numbers above or left of the selection.",
    { delta: "set-formula", touches: ["formulas"], manifest: "set_formula" },
  ],
  [
    "formula.library",
    "Browse every function Spectra can calculate.",
    { requires: false, exposed: false },
  ],
  [
    "formula.explain",
    "Read the active formula back in plain sentences.",
    { requires: false, exposed: false },
  ],
  [
    "formula.calculate",
    "Recalculate the workbook now.",
    { requires: false, exposed: false },
  ],
  [
    "formula.calcMode",
    "Set when the workbook recalculates.",
    {
      params: text,
      delta: "set-workbook-properties",
      touches: ["calculationSettings"],
      field: true,
    },
  ],
  [
    "formula.trace",
    "Trace precedents or dependents of the active cell.",
    { requires: false, exposed: false },
  ],
  [
    "namedRange.create",
    "Name the selected range.",
    {
      delta: "set-defined-names",
      touches: ["namedRanges"],
      manifest: "create_named_range",
    },
  ],
  [
    "namedRange.manage",
    "Manage named ranges in this workbook.",
    { requires: false, exposed: false },
  ],
  [
    "chart.type",
    "Set the type of the selected chart.",
    {
      params: text,
      delta: "upsert-chart",
      touches: ["charts"],
      manifest: "edit_chart",
      field: true,
    },
  ],
  [
    "chart.title",
    "Set the title of the selected chart.",
    {
      params: text,
      delta: "upsert-chart",
      touches: ["charts"],
      manifest: "edit_chart",
      field: true,
    },
  ],
  [
    "chart.range",
    "Set the data range of the selected chart.",
    {
      params: text,
      delta: "upsert-chart",
      touches: ["charts"],
      manifest: "edit_chart",
      field: true,
    },
  ],
  [
    "chart.legend",
    "Show or hide the legend on the selected chart.",
    {
      params: bool,
      delta: "upsert-chart",
      touches: ["charts"],
      manifest: "edit_chart",
    },
  ],
  [
    "chart.remove",
    "Remove the selected chart.",
    {
      delta: "remove-chart",
      touches: ["charts"],
      manifest: "edit_chart",
      risk: "confirm",
    },
  ],
  [
    "chart.linkToDeck",
    "Link this chart into a presentation.",
    { reason: SHEETS_NATIVE_REASONS.chartLinkToDeck, touches: ["charts"], manifest: "link_output" },
  ],
  [
    "chart.native",
    "Open this chart in Excel.",
    { requires: false, exposed: false },
  ],
  [
    "sheet.new",
    "Add a worksheet.",
    {
      delta: "add-sheet",
      reason: SHEETS_NATIVE_REASONS.sheetStructure,
      touches: ["sheetStructure"],
      manifest: "create_sheet",
    },
  ],
  [
    "sheet.rename",
    "Rename the current worksheet.",
    {
      params: text,
      delta: "rename-sheet",
      touches: ["sheetStructure"],
      manifest: "rename_sheet",
      field: true,
    },
  ],
  [
    "sheet.duplicate",
    "Duplicate the current worksheet.",
    {
      delta: "add-sheet",
      touches: ["sheetStructure"],
      manifest: "create_sheet",
    },
  ],
  [
    "sheet.moveLeft",
    "Move the current worksheet left.",
    { delta: "reorder-sheets", touches: ["sheetStructure"] },
  ],
  [
    "sheet.moveRight",
    "Move the current worksheet right.",
    { delta: "reorder-sheets", touches: ["sheetStructure"] },
  ],
  [
    "sheet.hide",
    "Hide the current worksheet.",
    { delta: "set-sheet-properties", touches: ["sheetStructure"] },
  ],
  [
    "sheet.showHidden",
    "Show hidden worksheets.",
    { delta: "set-sheet-properties", touches: ["sheetStructure"] },
  ],
  [
    "sheet.delete",
    "Delete the current worksheet.",
    {
      delta: "remove-sheet",
      touches: ["sheetStructure"],
      risk: "destructive",
    },
  ],
  [
    "sheet.tabColor",
    "Set the tab colour of the current worksheet.",
    {
      params: maybeText,
      delta: "set-sheet-properties",
      touches: ["sheetStructure"],
      field: true,
    },
  ],
  [
    "note.set",
    "Set a note on the active cell.",
    { params: text, reason: SHEETS_NATIVE_REASONS.note, field: true },
  ],
  [
    "protect.sheet",
    "Protect or unprotect this sheet.",
    { params: bool, reason: SHEETS_NATIVE_REASONS.protect },
  ],
  [
    "review.history",
    "Show recent changes on this workbook.",
    { requires: false, exposed: false },
  ],
  [
    "data.pivot",
    "Show the preserved Excel pivot table.",
    { requires: false, exposed: false },
  ],
];

const SHAPES: readonly FidelityRegionKey[] = ["shapes"];
const R = PRESENTATION_STRICT_REASONS;

const PRESENTATION_SPECS: Spec<"presentation">[] = [
  ...sharedFamily("presentation", {
    importReason: R.importCopy,
    exportFormats: PRESENTATION_EXPORT_COPIES.map((copy) => copy.format),
    zoom: true,
    zoomFit: true,
  }),
  [
    "slide.add",
    "Add a slide after this one.",
    { delta: "add-slide", touches: ["slides"], manifest: "add_slide" },
  ],
  [
    "slide.duplicate",
    "Copy this slide, its objects and its notes.",
    { delta: "duplicate-slide", touches: ["slides"] },
  ],
  [
    "design.open",
    "Open theme, background and slide size for the whole deck.",
    { requires: false, exposed: false },
  ],
  [
    "present.start",
    "Present full screen from this slide.",
    { requires: "present", exposed: true, manifest: "prepare_presenter_output" },
  ],
  [
    "slide.moveEarlier",
    "Move this slide earlier in the deck.",
    { delta: "reorder-slides", touches: ["slides"] },
  ],
  [
    "slide.moveLater",
    "Move this slide later in the deck.",
    { delta: "reorder-slides", touches: ["slides"] },
  ],
  [
    "slide.hide",
    "Hide this slide from the show.",
    { params: bool, delta: "set-slide-hidden", touches: ["slides"] },
  ],
  [
    "slide.delete",
    "Remove this slide from the deck.",
    { delta: "remove-slide", touches: ["slides"], risk: "confirm" },
  ],
  [
    "slide.setTitle",
    "Set the title of this slide.",
    { params: text, delta: "set-title", touches: ["slides"], field: true },
  ],
  [
    "insert.textBox",
    "Add a text frame on this slide.",
    { delta: "add-text-box", touches: SHAPES, manifest: "create_object" },
  ],
  [
    "insert.placeholderText",
    "Fill the empty placeholder with text.",
    { params: text, delta: "set-text", touches: SHAPES },
  ],
  [
    "insert.shape",
    "Insert a shape on this slide.",
    { reason: R.newShape, touches: SHAPES },
  ],
  [
    "insert.image",
    "Insert a picture on this slide.",
    { reason: R.newMedia, touches: ["media"] },
  ],
  [
    "insert.video",
    "Insert a video on this slide.",
    { reason: R.newMedia, touches: ["media"] },
  ],
  [
    "insert.chart",
    "Insert a chart on this slide.",
    { reason: R.newChart, touches: ["charts"], manifest: "generate_chart" },
  ],
  [
    "insert.table",
    "Insert a table on this slide.",
    { reason: R.newTable, touches: ["tables"] },
  ],
  [
    "table.cellText",
    "Edit the text in a selected PowerPoint table cell.",
    {
      params: text,
      delta: "set-table-cell-text",
      touches: ["tables"],
      exposed: false,
    },
  ],
  [
    "table.cellFormat",
    "Format a selected PowerPoint table cell.",
    {
      params: record,
      delta: "set-table-cell-format",
      touches: ["tables"],
      exposed: false,
    },
  ],
  [
    "insert.embed",
    "Embed other Spectra work on this slide.",
    { reason: R.embed },
  ],
  [
    "insert.equation",
    "Insert an equation on this slide.",
    { reason: R.newEquation, touches: SHAPES },
  ],
  [
    "insert.component",
    "Insert a reusable component on this slide.",
    { reason: R.component },
  ],
  [
    "design.applyLayout",
    "Apply a slide layout.",
    {
      params: text,
      reason: R.layout,
      touches: ["layouts"],
      manifest: "apply_layout",
      field: true,
    },
  ],
  [
    "design.resetPlaceholders",
    "Reset placeholders to the layout.",
    { reason: R.layout, touches: ["layouts"] },
  ],
  [
    "design.applyTheme",
    "Apply a theme to the deck.",
    {
      params: text,
      delta: "set-theme-fonts",
      touches: ["slides"],
      manifest: "apply_theme",
      field: true,
    },
  ],
  [
    "design.background",
    "Set the slide background.",
    { params: text, reason: R.background, field: true },
  ],
  [
    "design.slideSize",
    "Set the slide size.",
    { params: text, reason: R.slideSize, field: true },
  ],
  [
    "design.slideNumbers",
    "Show or hide slide numbers.",
    { params: bool, reason: R.slideNumbers },
  ],
  [
    "slide.section",
    "Assign this slide to a section.",
    { params: text, reason: R.sections, field: true },
  ],
  [
    "design.saveComponent",
    "Save the selection as a reusable component.",
    { reason: R.component },
  ],
  [
    "design.audit",
    "Check this deck for design issues.",
    { requires: false, exposed: false },
  ],
  [
    "sources.open",
    "Open the source list for this deck.",
    { requires: false, exposed: false },
  ],
  [
    "sources.addCitation",
    "Add a citation on this slide.",
    { reason: R.citations },
  ],
  [
    "sources.buildBibliography",
    "Build a bibliography slide.",
    { reason: R.citations, manifest: "build_bibliography" },
  ],
  [
    "arrange.align",
    "Align the selected objects.",
    { params: text, reason: R.geometry, touches: SHAPES, field: true },
  ],
  [
    "arrange.distribute",
    "Distribute the selected objects.",
    { params: text, reason: R.geometry, touches: SHAPES, field: true },
  ],
  [
    "arrange.group",
    "Group the selected objects.",
    { delta: "group-objects", touches: SHAPES },
  ],
  [
    "arrange.ungroup",
    "Ungroup the selected objects.",
    { reason: R.group, touches: SHAPES },
  ],
  [
    "arrange.bringForward",
    "Bring the selection forward one step.",
    { reason: R.order, touches: SHAPES },
  ],
  [
    "arrange.sendBackward",
    "Send the selection backward one step.",
    { reason: R.order, touches: SHAPES },
  ],
  [
    "arrange.bringToFront",
    "Bring the selection to the front.",
    { reason: R.order, touches: SHAPES },
  ],
  [
    "arrange.sendToBack",
    "Send the selection to the back.",
    { reason: R.order, touches: SHAPES },
  ],
  [
    "arrange.geometry.x",
    "Set the horizontal position of the selected object.",
    {
      params: num,
      delta: "set-geometry",
      touches: SHAPES,
      manifest: "move_object",
      field: true,
    },
  ],
  [
    "arrange.geometry.y",
    "Set the vertical position of the selected object.",
    { params: num, delta: "set-geometry", touches: SHAPES, field: true },
  ],
  [
    "arrange.geometry.width",
    "Set the width of the selected object.",
    {
      params: num,
      delta: "set-geometry",
      touches: SHAPES,
      manifest: "resize_object",
      field: true,
    },
  ],
  [
    "arrange.geometry.height",
    "Set the height of the selected object.",
    { params: num, delta: "set-geometry", touches: SHAPES, field: true },
  ],
  [
    "arrange.geometry.rotation",
    "Set the rotation of the selected object.",
    { params: num, delta: "set-geometry", touches: SHAPES, field: true },
  ],
  [
    "accessibility.readingOrder",
    "Show the order a screen reader announces this slide in.",
    { requires: false, exposed: false },
  ],
  [
    "stage.snap",
    "Snap objects to the stage grid.",
    { params: bool, requires: false, exposed: false },
  ],
  [
    "stage.guides",
    "Show alignment guides.",
    { params: bool, requires: false, exposed: false },
  ],
  [
    "stage.grid",
    "Show the stage grid.",
    { params: bool, requires: false, exposed: false },
  ],
  [
    "animate.transition",
    "Set the transition for this slide.",
    {
      params: text,
      reason: R.transition,
      touches: ["transitions"],
      field: true,
    },
  ],
  [
    "animate.transitionDuration",
    "Set how long the transition lasts.",
    {
      params: num,
      reason: R.transition,
      touches: ["transitions"],
      field: true,
    },
  ],
  [
    "animate.transitionApplyAll",
    "Apply this transition to every slide.",
    { reason: R.transition, touches: ["transitions"] },
  ],
  [
    "animate.defaultTransition",
    "Set the default transition for new slides.",
    { params: text, reason: R.transition, touches: ["transitions"], field: true },
  ],
  [
    "animate.autoAdvance",
    "Advance this slide automatically.",
    { params: num, reason: R.autoAdvance, field: true },
  ],
  [
    "animate.object",
    "Set an animation on the selected object.",
    {
      params: text,
      reason: R.animation,
      touches: ["animations"],
      field: true,
    },
  ],
  [
    "animate.objectDuration",
    "Set how long the object animation lasts.",
    {
      params: num,
      reason: R.animation,
      touches: ["animations"],
      field: true,
    },
  ],
  [
    "animate.objectDelay",
    "Set the delay before the object animation.",
    {
      params: num,
      reason: R.animation,
      touches: ["animations"],
      field: true,
    },
  ],
  [
    "present.rehearse",
    "Rehearse this deck with a timer.",
    { requires: "present", exposed: false },
  ],
  [
    "present.stop",
    "Leave the presenter.",
    { requires: "present", exposed: false },
  ],
  [
    "view.notesPage",
    "Show the notes page view.",
    { params: bool, requires: false, exposed: false },
  ],
  [
    "notes.panel",
    "Show or hide the speaker-notes panel.",
    { params: bool, requires: false, exposed: false },
  ],
  [
    "notes.set",
    "Set the speaker notes for this slide.",
    {
      params: text,
      delta: "set-notes",
      touches: ["speakerNotes"],
      manifest: "write_speaker_notes",
      field: true,
    },
  ],
  [
    "present.layout",
    "Choose presenter view layout.",
    { params: text, requires: "present", exposed: false, field: true },
  ],
  [
    "present.toggleNotes",
    "Show or hide notes while presenting.",
    { params: bool, requires: "present", exposed: false },
  ],
  [
    "present.blackout",
    "Black out the audience screen.",
    { params: bool, requires: "present", exposed: false },
  ],
  [
    "present.pointer",
    "Use a pointer while presenting.",
    { params: bool, requires: "present", exposed: false },
  ],
  [
    "present.next",
    "Go to the next slide.",
    { requires: "present", exposed: false },
  ],
  [
    "present.previous",
    "Go to the previous slide.",
    { requires: "present", exposed: false },
  ],
  [
    "format.textPreset",
    "Apply a text style preset to the selection.",
    {
      params: text,
      delta: "format-rich-text",
      touches: SHAPES,
      field: true,
    },
  ],
  [
    "object.setText",
    "Set the words inside the selected shape.",
    {
      params: text,
      delta: "set-text",
      touches: SHAPES,
      manifest: "rewrite_object",
      field: true,
    },
  ],
  [
    "format.fill",
    "Set the fill of the selected shape.",
    {
      params: maybeText,
      delta: "set-shape-style",
      touches: SHAPES,
      field: true,
    },
  ],
  [
    "format.border",
    "Set the outline colour of the selected shape.",
    { params: maybeText, reason: R.shapeStyle, touches: SHAPES, field: true },
  ],
  [
    "format.borderWidth",
    "Set the outline width of the selected shape.",
    { params: num, reason: R.shapeStyle, touches: SHAPES, field: true },
  ],
  [
    "format.cornerRadius",
    "Set the corner radius of the selected shape.",
    { params: num, reason: R.shapeStyle, touches: SHAPES, field: true },
  ],
  [
    "format.opacity",
    "Set the opacity of the selected shape.",
    { params: num, reason: R.shapeStyle, touches: SHAPES, field: true },
  ],
  [
    "format.shadow",
    "Set a shadow on the selected shape.",
    { params: bool, reason: R.shapeStyle, touches: SHAPES },
  ],
  [
    "arrange.lock",
    "Lock the selected object.",
    { params: bool, reason: R.objectState, touches: SHAPES },
  ],
  [
    "arrange.hideObject",
    "Hide the selected object.",
    { params: bool, delta: "set-object-state", touches: SHAPES },
  ],
  [
    "arrange.delete",
    "Remove the selected object.",
    { delta: "remove-object", touches: SHAPES, risk: "confirm" },
  ],
  [
    "image.fit",
    "Fit this picture inside its frame.",
    { params: text, reason: R.crop, touches: ["media"], field: true },
  ],
  [
    "image.mask",
    "Mask this picture.",
    { params: text, reason: R.crop, touches: ["media"], field: true },
  ],
  [
    "image.cropX",
    "Crop this picture horizontally.",
    { params: num, delta: "set-image-crop", touches: ["media"], field: true },
  ],
  [
    "image.cropY",
    "Crop this picture vertically.",
    { params: num, reason: R.crop, touches: ["media"], field: true },
  ],
  [
    "image.replace",
    "Replace this picture.",
    { reason: R.newMedia, touches: ["media"] },
  ],
  [
    "accessibility.altText",
    "Set alternative text for the selected object.",
    {
      params: text,
      delta: "set-alt-text",
      touches: SHAPES,
      manifest: "describe_object",
      field: true,
    },
  ],
  [
    "data.bindSource",
    "Bind this chart to a workbook range.",
    { delta: "set-chart", touches: ["charts"] },
  ],
  [
    "data.live",
    "Keep this chart live with its workbook.",
    { params: bool, delta: "set-chart", touches: ["charts"] },
  ],
  [
    "data.refreshChart",
    "Refresh this chart from its workbook.",
    { delta: "set-chart", touches: ["charts"] },
  ],
  [
    "transition.native",
    "Show the native PowerPoint transition on this slide.",
    { requires: false, exposed: false },
  ],
  [
    "transition.nativeTiming",
    "Show native PowerPoint transition timing.",
    { requires: false, exposed: false },
  ],
  [
    "files.open",
    "Open import and export for this deck.",
    { requires: false, exposed: false },
  ],
  [
    "view.slidePreviews",
    "Show or hide the thumbnail rail.",
    { params: bool, requires: false, exposed: false },
  ],
  [
    "view.inspector",
    "Show or hide the inspector.",
    { params: bool, requires: false, exposed: false },
  ],
];

export const DOCUMENT_REMAINING_CAPABILITIES = defineRemaining(
  "document",
  DOCUMENT_SPECS,
);
export const SHEETS_REMAINING_CAPABILITIES = defineRemaining(
  "sheets",
  SHEETS_SPECS,
);
export const PRESENTATION_REMAINING_CAPABILITIES = defineRemaining(
  "presentation",
  PRESENTATION_SPECS,
);

export const OFFICE_REMAINING_CAPABILITIES = [
  ...DOCUMENT_REMAINING_CAPABILITIES,
  ...SHEETS_REMAINING_CAPABILITIES,
  ...PRESENTATION_REMAINING_CAPABILITIES,
] as const;

const REMAINING_BY_TYPE = {
  document: DOCUMENT_REMAINING_CAPABILITIES,
  sheets: SHEETS_REMAINING_CAPABILITIES,
  presentation: PRESENTATION_REMAINING_CAPABILITIES,
} as const;

export function remainingCapabilitiesFor<T extends OfficeWorkType>(
  type: T,
): readonly CapabilityDefinition<T>[] {
  return REMAINING_BY_TYPE[type] as readonly CapabilityDefinition<T>[];
}
