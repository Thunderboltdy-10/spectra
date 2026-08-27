/**
 * The downloadable copies each Office type actually offers. IR ids, stub
 * handlers, and live studios all read this list so a format cannot appear on
 * a workbar without a definition, or in the IR without a control.
 */
export type OfficeExportCopy = {
  format: string;
  label: string;
  lossy?: boolean;
};

export const DOCUMENT_EXPORT_COPIES = [
  { format: "docx", label: "Word" },
  { format: "pdf", label: "PDF", lossy: true },
  { format: "md", label: "Markdown", lossy: true },
  { format: "html", label: "HTML", lossy: true },
  { format: "txt", label: "text", lossy: true },
] as const satisfies readonly OfficeExportCopy[];

export const SHEETS_EXPORT_COPIES = [
  { format: "xlsx", label: "Excel", lossy: true },
  { format: "csv", label: "CSV", lossy: true },
  { format: "ods", label: "OpenDocument", lossy: true },
] as const satisfies readonly OfficeExportCopy[];

export const PRESENTATION_EXPORT_COPIES = [
  { format: "pptx", label: "PowerPoint", lossy: true },
  { format: "pdf", label: "PDF", lossy: true },
  { format: "odp", label: "OpenDocument", lossy: true },
  { format: "png", label: "Slide image", lossy: true },
] as const satisfies readonly OfficeExportCopy[];
