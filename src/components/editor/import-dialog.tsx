"use client";

import { useMemo, useState } from "react";
import { Upload, FileText, ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ImportedDocument } from "@/lib/editor/tiptap-import";
import { importClipboardData } from "@/lib/editor/clipboard-paste";
import { importNotionFile } from "@/lib/editor/import-notion";
import { importDocxFile } from "@/lib/editor/import-docx";
import { importPdfFile } from "@/lib/editor/import-pdf";

function supportedFileToDocument(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "md" || ext === "markdown" || ext === "html" || ext === "htm") {
    return importNotionFile(file);
  }
  if (ext === "docx") {
    return importDocxFile(file);
  }
  if (ext === "pdf") {
    return importPdfFile(file);
  }
  throw new Error(`Unsupported import type: ${ext ?? "unknown"}`);
}

export function ImportDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (document: ImportedDocument) => void;
}) {
  const [preview, setPreview] = useState<ImportedDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewText = useMemo(() => preview?.contentPlaintext.slice(0, 500) ?? "", [preview]);

  if (!props.open) return null;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const document = await supportedFileToDocument(file);
      setPreview(document);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  async function handlePasteFromClipboard() {
    setError(null);
    const clipboard = await navigator.clipboard.read();
    for (const item of clipboard) {
      const htmlType = item.types.find((type) => type === "text/html");
      if (htmlType) {
        const blob = await item.getType(htmlType);
        const html = await blob.text();
        const data = new DataTransfer();
        data.setData("text/html", html);
        const document = importClipboardData(data);
        if (document) {
          setPreview(document);
          return;
        }
      }
      const textType = item.types.find((type) => type === "text/plain");
      if (textType) {
        const blob = await item.getType(textType);
        const text = await blob.text();
        const data = new DataTransfer();
        data.setData("text/plain", text);
        const document = importClipboardData(data);
        if (document) {
          setPreview(document);
          return;
        }
      }
    }
    setError("Clipboard did not contain importable text or HTML.");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Import document</h3>
            <p className="text-sm text-[var(--text-secondary)]">Supports `.md`, `.html`, `.docx`, and `.pdf`.</p>
          </div>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>Close</Button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-[var(--border-default)] px-4 py-4 text-sm text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Choose file
            </span>
            <input
              type="file"
              accept=".md,.markdown,.html,.htm,.docx,.pdf"
              className="hidden"
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
            <span className="text-xs text-[var(--text-tertiary)]">Drag-and-drop is supported by the browser picker</span>
          </label>

          <Button variant="outline" className="w-full justify-start gap-2" onClick={() => void handlePasteFromClipboard()}>
            <ClipboardPaste className="h-4 w-4" />
            Paste from clipboard
          </Button>

          {loading ? (
            <div className="rounded-xl border border-[var(--border-default)] px-4 py-6 text-sm text-[var(--text-secondary)]">
              Processing import…
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : null}

          {preview ? (
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)]">
              <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
                <FileText className="h-4 w-4" />
                Preview
              </div>
              <div className="px-4 py-3 text-sm text-[var(--text-secondary)]">
                {previewText || "Imported content is empty."}
              </div>
              <div className="flex justify-end gap-2 border-t border-[var(--border-default)] px-4 py-3">
                <Button variant="ghost" onClick={() => setPreview(null)}>Clear</Button>
                <Button
                  onClick={() => {
                    props.onImport(preview);
                    props.onOpenChange(false);
                    setPreview(null);
                  }}
                >
                  Import into artifact
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
