"use client";

import { loadPdfjs } from "@/lib/pdfjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DocumentStudio } from "../components/document-studio";
import { StudioContractProvider, useStudioContractValue } from "../components/artifact-studio-shell";

/*
 * The fidelity lab (/dev/document). A Word file opened exactly as a
 * Word-bound document opens in Spectra, beside the PDF Word itself printed
 * of the same file. It is where the page renderer is built and where every
 * document UI change is checked against Word before it ships.
 */

type Fixture = { source: string; label: string; name: string; hasPdf: boolean; bytes: number };
type View = "side" | "overlay" | "spectra";

const LAB_ARTIFACT = "dev-document-lab";
const NO_INSPECTOR = { open: null, show: () => undefined, hide: () => undefined };
const SYNC = { state: "saved" as const, label: "Lab copy, not saved" };

function fixtureKey(fixture: Pick<Fixture, "source" | "name">) {
  return `${fixture.source}/${fixture.name}`;
}

function fixtureUrl(fixture: Pick<Fixture, "source" | "name">, as?: "pdf") {
  const params = new URLSearchParams({ source: fixture.source, name: fixture.name, ...(as ? { as } : {}) });
  return `/dev/document/fixtures?${params}`;
}

function readStoredKey() {
  try {
    return new URLSearchParams(window.location.search).get("file") ?? window.localStorage.getItem("spectra.document-lab.file");
  } catch {
    return null;
  }
}

/** Word's pages drawn at the width of Spectra's page, one canvas each. */
function WordPages({ fixture, width, onPages }: { fixture: Fixture; width: number; onPages: (pages: number | null) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    host.replaceChildren();
    setError(null);
    onPages(null);
    if (!fixture.hasPdf) {
      setError("No Word PDF for this file yet. Run scripts/word-verify.ps1 on its folder.");
      return;
    }
    void (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const bytes = await fetch(fixtureUrl(fixture, "pdf")).then((response) => {
          if (!response.ok) throw new Error("Word's PDF could not be read.");
          return response.arrayBuffer();
        });
        const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false });
        const pdf = await task.promise;
        if (cancelled) return void task.destroy();
        onPages(pdf.numPages);
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        for (let number = 1; number <= pdf.numPages && !cancelled; number++) {
          const page = await pdf.getPage(number);
          const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = `${width}px`;
          canvas.dataset.wordPage = String(number);
          canvas.className = "block bg-white shadow-[0_1px_3px_rgba(0,0,0,.18)]";
          const context = canvas.getContext("2d");
          if (!context) continue;
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          page.cleanup();
          if (!cancelled) host.append(canvas);
        }
        await task.destroy();
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Word's PDF could not be drawn.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fixture, width, onPages]);
  return <div className="flex flex-col items-center gap-6 py-6">
    {error ? <p className="max-w-sm text-center text-caption text-[var(--text-secondary)]">{error}</p> : null}
    <div ref={hostRef} className="flex flex-col items-center gap-6" />
  </div>;
}

/** How many sheets Spectra's page view drew, as its status rail counts them. */
function useSpectraPages(host: HTMLElement | null, key: string) {
  const [pages, setPages] = useState<number | null>(null);
  useEffect(() => {
    if (!host) return;
    setPages(null);
    const timer = window.setInterval(() => {
      const total = Number(host.querySelector<HTMLElement>("[data-page-total]")?.dataset.pageTotal);
      setPages(total > 0 ? total : null);
    }, 800);
    return () => window.clearInterval(timer);
  }, [host, key]);
  return pages;
}

export function DocumentLab() {
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [selected, setSelected] = useState<Fixture | null>(null);
  const [content, setContent] = useState<{ key: string; value: unknown; openMs: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [view, setView] = useState<View>("side");
  const [opacity, setOpacity] = useState(0.5);
  const [wordPages, setWordPages] = useState<number | null>(null);
  const [spectraHost, setSpectraHost] = useState<HTMLElement | null>(null);
  const key = selected ? fixtureKey(selected) : "";
  const spectraPages = useSpectraPages(spectraHost, key);
  const contract = useStudioContractValue({
    artifactId: LAB_ARTIFACT,
    type: "document",
    role: "edit",
    surface: "full",
    sync: SYNC,
    density: "comfortable",
    inspector: NO_INSPECTOR,
    compatibilityProfile: "strict-native",
  });

  useEffect(() => {
    void fetch("/dev/document/fixtures").then((response) => response.json()).then((body: { fixtures: Fixture[] }) => {
      setFixtures(body.fixtures);
      const stored = readStoredKey();
      setSelected(body.fixtures.find((fixture) => fixtureKey(fixture) === stored) ?? body.fixtures[0] ?? null);
    }).catch(() => setProblem("The fixture list could not be read. Is the dev server running?"));
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const nextKey = fixtureKey(selected);
    try {
      window.localStorage.setItem("spectra.document-lab.file", nextKey);
      // The lab always opens on the page view: it exists to compare pages.
      window.localStorage.setItem(`spectra.document-canvas.${LAB_ARTIFACT}`, "page");
    } catch {
      // Storage is a convenience here.
    }
    setProblem(null);
    setContent(null);
    void fetch(fixtureUrl(selected)).then(async (response) => {
      const body = await response.json() as { content?: unknown; openMs?: number; error?: string };
      if (cancelled) return;
      if (!response.ok || !body.content) setProblem(body.error ?? "This file could not be opened.");
      else setContent({ key: nextKey, value: body.content, openMs: body.openMs ?? 0 });
    }).catch(() => !cancelled && setProblem("This file could not be opened."));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const groups = useMemo(() => {
    const map = new Map<string, Fixture[]>();
    for (const fixture of fixtures ?? []) map.set(fixture.label, [...(map.get(fixture.label) ?? []), fixture]);
    return [...map];
  }, [fixtures]);
  const pageWidth = 640;
  const onWordPages = useCallback((pages: number | null) => setWordPages(pages), []);
  const noop = useCallback(() => undefined, []);
  const pageDelta = spectraPages !== null && wordPages !== null ? spectraPages - wordPages : null;

  return <main className="flex h-dvh flex-col bg-[var(--bg-desk)] text-[var(--text-primary)]">
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-2.5 text-caption">
      <h1 className="text-body font-semibold">Fidelity lab</h1>
      <label className="flex min-w-0 items-center gap-2">
        <span className="text-[var(--text-secondary)]">File</span>
        <select
          className="max-w-[min(60vw,360px)] rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1"
          value={key}
          onChange={(event) => setSelected(fixtures?.find((fixture) => fixtureKey(fixture) === event.target.value) ?? null)}
        >
          {groups.map(([label, entries]) => <optgroup key={label} label={label}>
            {entries.map((fixture) => <option key={fixtureKey(fixture)} value={fixtureKey(fixture)}>
              {fixture.name}{fixture.hasPdf ? "" : " (no Word PDF)"}
            </option>)}
          </optgroup>)}
        </select>
      </label>
      <div role="group" aria-label="Comparison" className="flex overflow-hidden rounded-control border border-[var(--border-default)]">
        {([["side", "Side by side"], ["overlay", "Overlay"], ["spectra", "Spectra only"]] as const).map(([value, label]) =>
          <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}
            className={`px-2.5 py-1 ${view === value ? "bg-[var(--text-primary)] text-[var(--text-inverse)]" : "hover:bg-[var(--bg-hover)]"}`}>
            {label}
          </button>)}
      </div>
      {view === "overlay" ? <label className="flex items-center gap-2">
        <span className="text-[var(--text-secondary)]">Word</span>
        <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} aria-label="Word page opacity" />
      </label> : null}
      <dl className="ml-auto flex items-center gap-4 tabular-nums" aria-live="polite">
        <div className="flex gap-1.5"><dt className="text-[var(--text-secondary)]">Spectra</dt><dd data-testid="spectra-pages">{spectraPages ?? "…"} pages</dd></div>
        <div className="flex gap-1.5"><dt className="text-[var(--text-secondary)]">Word</dt><dd data-testid="word-pages">{wordPages ?? "–"} pages</dd></div>
        {pageDelta !== null ? <div className="flex gap-1.5"><dt className="text-[var(--text-secondary)]">Difference</dt>
          <dd data-testid="page-delta" className={Math.abs(pageDelta) > 1 ? "text-[var(--danger)]" : ""}>{pageDelta > 0 ? `+${pageDelta}` : pageDelta}</dd></div> : null}
        {content ? <div className="flex gap-1.5"><dt className="text-[var(--text-secondary)]">Opened in</dt><dd>{content.openMs} ms</dd></div> : null}
      </dl>
    </header>
    {problem ? <p role="alert" className="m-6 text-[var(--text-secondary)]">{problem}</p> : null}
    {selected ? <div className={`grid min-h-0 flex-1 ${view === "side" ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
      <section ref={setSpectraHost} aria-label="Spectra" className="relative min-h-0 overflow-auto">
        {content && content.key === key ? <StudioContractProvider value={contract}>
          <DocumentStudio key={content.key} artifactId={LAB_ARTIFACT} title={selected.name.replace(/\.docx$/iu, "")}
            content={content.value} onChange={noop} header={null} mode="tab" />
        </StudioContractProvider> : !problem ? <p className="m-6 text-[var(--text-secondary)]">Opening {selected.name}…</p> : null}
        {view === "overlay" ? <div className="pointer-events-none absolute inset-x-0 top-0 mix-blend-multiply" style={{ opacity }}>
          <WordPages fixture={selected} width={pageWidth} onPages={onWordPages} />
        </div> : null}
      </section>
      {view === "side" ? <section aria-label="Word" className="min-h-0 overflow-auto border-l border-[var(--border-default)] bg-[var(--bg-desk)]">
        <WordPages fixture={selected} width={pageWidth} onPages={onWordPages} />
      </section> : null}
    </div> : fixtures && !fixtures.length ? <p className="m-6 text-[var(--text-secondary)]">No Word files found. Set SPECTRA_DOCUMENT_LAB_DIR to a folder of copies.</p> : null}
  </main>;
}
