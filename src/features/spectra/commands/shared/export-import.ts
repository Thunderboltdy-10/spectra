import { FileDown, Import, Loader2, Printer } from "lucide-react";
import type { CommandBinding } from "../types";

/**
 * Export and import copies, with the boundary stated in the surface itself.
 *
 * Spectra's conversion path is honest but lossy, and it is *not* the sync path
 * (CANON D25). Every type had its own wording for that; here the wording is one
 * sentence, written once, so a person reads the same promise whether they are
 * exporting a document, a workbook or a deck.
 */
export type ExportFormatSpec = {
  format: string;
  /** "Word", "PDF", "Excel" — the noun a person recognises. */
  label: string;
  /** Set when the copy loses structure the original has. */
  lossy?: boolean;
};

export type ExportAdapter = {
  formats: readonly ExportFormatSpec[];
  run: (format: string) => void | Promise<void>;
  busyFormat?: string | null;
  /** The noun for the thing being copied: "document", "workbook", "deck". */
  noun: string;
};

export function exportBindings(adapter: ExportAdapter): CommandBinding[] {
  return adapter.formats.map((spec) => ({
    id: `export.${spec.format}`,
    label: `Export ${spec.label} copy`,
    icon: adapter.busyFormat === spec.format ? Loader2 : FileDown,
    priority: "advanced" as const,
    tab: "General",
    group: "Export",
    disabled: adapter.busyFormat === spec.format || undefined,
    hint: `Downloads a separate ${spec.label} copy of this ${adapter.noun}. A linked native file is never replaced.`,
    exportBoundary: "lossy-copy" as const,
    risk: "safe" as const,
    undo: "none(explain)" as const,
    onSelect: () => void adapter.run(spec.format),
  }));
}

export type ImportAdapter = {
  open: () => void;
  busy?: boolean;
  noun: string;
  /** Why importing is refused while the original stays linked. */
  strictReason?: string;
};

export function importBinding(adapter: ImportAdapter): CommandBinding {
  return {
    id: "import.copy",
    label: adapter.busy ? "Importing a copy…" : "Import a copy",
    icon: adapter.busy ? Loader2 : Import,
    priority: "advanced",
    tab: "General",
    group: "Export",
    requires: "edit",
    disabled: adapter.busy || undefined,
    hint: `Creates a separate Spectra ${adapter.noun}; it does not stay linked to the source file.`,
    exportBoundary: "lossy-copy",
    undo: "none(explain)",
    strictNative: {
      available: false,
      reason:
        adapter.strictReason ??
        `Import a copy from the Library so the linked file is not replaced.`,
    },
    onSelect: () => adapter.open(),
  };
}

export function printBinding(run: () => void, noun: string): CommandBinding {
  return {
    id: "export.print",
    label: "Print",
    icon: Printer,
    priority: "advanced",
    tab: "General",
    group: "Export",
    shortcut: "Mod+P",
    hint: `Print or save this ${noun} as a PDF`,
    exportBoundary: "none",
    undo: "none(explain)",
    onSelect: () => run(),
  };
}
