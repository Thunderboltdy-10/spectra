"use client";

import { useMemo, useRef, useState } from "react";
import { Download, FileText, Globe, Presentation, ScrollText } from "lucide-react";
import { parseGeneratedDocument, type GeneratedDocument, type PresentationSlide } from "@/lib/document-generator";
import {
  buildDocxBytes,
  buildHtmlArtifact,
  buildPdfBytes,
  buildPptxBytes,
} from "@/lib/document-export";
import { Button } from "@/components/ui/button";

type DocumentPanelProps = {
  content: string;
};

function toneForSlide(slide: PresentationSlide, index: number) {
  return slide.accent || (index % 2 === 0 ? "var(--accent-cyan)" : "var(--brand-primary)");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportAsPptx(documentData: GeneratedDocument) {
  const bytes = await buildPptxBytes(documentData);
  downloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), `${documentData.title || "document"}.pptx`);
}

async function exportAsDocx(documentData: GeneratedDocument) {
  const bytes = await buildDocxBytes(documentData);
  downloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), `${documentData.title || "document"}.docx`);
}

async function exportAsPdf(documentData: GeneratedDocument) {
  const bytes = await buildPdfBytes(documentData);
  downloadBlob(new Blob([bytes], { type: "application/pdf" }), `${documentData.title || "document"}.pdf`);
}

async function exportAsHtml(documentData: GeneratedDocument) {
  const html = buildHtmlArtifact(documentData);
  downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), `${documentData.title || "document"}.html`);
}

function SectionHeader({ icon: Icon, label }: { icon: typeof FileText; label: string }) {
  return (
    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
  );
}

export function DocumentPanel({ content }: DocumentPanelProps) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [exporting, setExporting] = useState<"" | "pptx" | "docx" | "pdf" | "html">("");
  const parsed = useMemo(() => parseGeneratedDocument(content), [content]);

  if (!parsed.document) return null;
  const documentData = parsed.document;

  async function handleExport(format: "pptx" | "docx" | "pdf" | "html") {
    setExporting(format);
    try {
      if (format === "pptx") {
        await exportAsPptx(documentData);
      } else if (format === "docx") {
        await exportAsDocx(documentData);
      } else if (format === "pdf") {
        await exportAsPdf(documentData);
      } else if (format === "html") {
        await exportAsHtml(documentData);
      }
    } finally {
      setExporting("");
    }
  }

  return (
    <section className="space-y-4 rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionHeader icon={ScrollText} label={`${documentData.type.replace(/_/g, " ")} draft`} />
          <h3 className="font-display text-2xl text-[var(--text-primary)]">{documentData.title}</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => void handleExport("pptx")} disabled={exporting !== ""}>
            <Presentation className="h-4 w-4" />
            {exporting === "pptx" ? "Exporting..." : "Export PPTX"}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void handleExport("docx")} disabled={exporting !== ""}>
            <FileText className="h-4 w-4" />
            {exporting === "docx" ? "Exporting..." : "Export DOCX"}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void handleExport("html")} disabled={exporting !== ""}>
            <Globe className="h-4 w-4" />
            {exporting === "html" ? "Exporting..." : "Export HTML"}
          </Button>
          <Button type="button" size="sm" onClick={() => void handleExport("pdf")} disabled={exporting !== ""}>
            <Download className="h-4 w-4" />
            {exporting === "pdf" ? "Exporting..." : "Export PDF"}
          </Button>
        </div>
      </div>

      <div ref={previewRef} className="space-y-4 rounded-2xl border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-primary)_88%,white)] p-4">
        {documentData.type === "presentation" ? (
          <div className="space-y-4">
            {documentData.slides.map((slide, index) => (
              <article
                key={`${slide.title || "slide"}-${index}`}
                className="grid gap-4 overflow-hidden rounded-[28px] border border-[var(--border-default)] bg-[#f8f4ea] p-0 shadow-[var(--shadow-soft)] md:grid-cols-[10px_minmax(0,1fr)]"
              >
                <div style={{ background: toneForSlide(slide, index) }} />
                <div className="p-6">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">Slide {index + 1}</p>
                  <h4 className="mt-2 font-display text-2xl text-[var(--text-primary)]">{slide.title || documentData.title}</h4>
                  {slide.body ? <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">{slide.body}</p> : null}
                  {slide.bullets?.length ? (
                    <ul className="mt-4 space-y-2 text-sm text-[var(--text-primary)]">
                      {slide.bullets.map((bullet, bulletIndex) => (
                        <li key={`${bullet}-${bulletIndex}`} className="flex gap-3">
                          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)]" />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {documentData.type === "word" ? (
          <article className="mx-auto max-w-3xl space-y-4 rounded-[24px] border border-[var(--border-default)] bg-white p-8 shadow-[var(--shadow-soft)]">
            {documentData.sections.map((section, index) => (
              <div key={`${section.heading}-${index}`} className="space-y-2">
                <h4 className={`font-display text-[var(--text-primary)] ${section.level === 1 ? "text-2xl" : section.level === 2 ? "text-xl" : "text-lg"}`}>
                  {section.heading}
                </h4>
                <p className="text-sm leading-7 text-[var(--text-secondary)]">{section.content}</p>
              </div>
            ))}
          </article>
        ) : null}

        {documentData.type === "study_guide" ? (
          <article className="space-y-5 rounded-[24px] border border-[var(--border-default)] bg-white p-6 shadow-[var(--shadow-soft)]">
            {documentData.summary ? (
              <div className="rounded-2xl border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--accent-cyan)_8%,white)] p-4 text-sm leading-7 text-[var(--text-secondary)]">
                {documentData.summary}
              </div>
            ) : null}
            {documentData.highlights?.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {documentData.highlights.map((highlight, index) => (
                  <div key={`${highlight}-${index}`} className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--text-primary)]">
                    {highlight}
                  </div>
                ))}
              </div>
            ) : null}
            {documentData.terms?.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {documentData.terms.map((term, index) => (
                  <div key={`${term.term}-${index}`} className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                    <p className="font-semibold text-[var(--text-primary)]">{term.term}</p>
                    <p className="mt-1 text-sm text-[var(--text-secondary)]">{term.definition}</p>
                  </div>
                ))}
              </div>
            ) : null}
            {documentData.sections.map((section, index) => (
              <div key={`${section.heading}-${index}`}>
                <h4 className="font-display text-xl text-[var(--text-primary)]">{section.heading}</h4>
                <p className="mt-2 text-sm leading-7 text-[var(--text-secondary)]">{section.content}</p>
              </div>
            ))}
          </article>
        ) : null}

        {documentData.type === "timeline" ? (
          <div className="space-y-4">
            {documentData.events.map((event, index) => (
              <article key={`${event.date}-${event.title}-${index}`} className="grid gap-3 rounded-[24px] border border-[var(--border-default)] bg-white p-5 shadow-[var(--shadow-soft)] md:grid-cols-[160px_minmax(0,1fr)]">
                <div className="font-mono text-sm text-[var(--text-secondary)]">{event.date}</div>
                <div>
                  <h4 className="font-display text-xl text-[var(--text-primary)]">{event.title}</h4>
                  <p className="mt-2 text-sm leading-7 text-[var(--text-secondary)]">{event.detail}</p>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {documentData.type === "comparison_table" ? (
          <div className="overflow-hidden rounded-[24px] border border-[var(--border-default)] bg-white shadow-[var(--shadow-soft)]">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-[var(--bg-secondary)] text-[var(--text-primary)]">
                <tr>
                  {documentData.columns.map((column) => (
                    <th key={column} className="border-b border-[var(--border-default)] px-4 py-3 font-semibold">{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {documentData.rows.map((row, index) => (
                  <tr key={`${index}-${row.join("-")}`} className="border-b border-[var(--border-default)] last:border-b-0">
                    {row.map((cell, cellIndex) => (
                      <td key={`${cellIndex}-${cell}`} className="px-4 py-3 text-[var(--text-secondary)]">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {documentData.type === "webpage" ? (
          <article className="overflow-hidden rounded-[24px] border border-[var(--border-default)] bg-white shadow-[var(--shadow-soft)]">
            <div className="border-b border-[var(--border-default)] px-4 py-3 text-xs text-[var(--text-secondary)]">
              Live webpage preview
            </div>
            <iframe
              title={documentData.title}
              srcDoc={buildHtmlArtifact(documentData)}
              sandbox="allow-scripts allow-popups allow-forms"
              className="h-[540px] w-full bg-white"
            />
          </article>
        ) : null}
      </div>
    </section>
  );
}
