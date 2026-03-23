"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Copy, Download, Play, Save, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import type { CanvasVersion } from "@/hooks/use-canvas-state";
import { Button } from "@/components/ui/button";
import { buildSrcdoc, canPreview as canPreviewLanguage, type PreviewLanguage } from "@/lib/code-sandbox";

type CanvasTab = "workspace" | "versions";

type CodeCanvasProps = {
  open: boolean;
  code: string;
  language: string;
  previewDoc: string;
  versions: CanvasVersion[];
  activeVersionId?: string;
  onClose: () => void;
  onCodeChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onRun: () => void;
  onSaveVersion: () => void;
  onRestoreVersion: (id: string) => void;
  onAskAiModify: (instruction: string) => void;
  embedded?: boolean;
  showBackButton?: boolean;
  onBack?: () => void;
};

function downloadCode(code: string, language: string) {
  const ext =
    language === "javascript"
      ? "js"
      : language === "typescript"
        ? "ts"
        : language === "python"
          ? "py"
          : language === "html"
            ? "html"
            : language === "css"
              ? "css"
              : "txt";
  const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `artifact.${ext}`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function CodeCanvas({
  open,
  code,
  language,
  previewDoc,
  versions,
  activeVersionId,
  onClose,
  onCodeChange,
  onLanguageChange,
  onRun,
  onSaveVersion,
  onRestoreVersion,
  onAskAiModify,
  embedded = false,
  showBackButton = false,
  onBack,
}: CodeCanvasProps) {
  const [tab, setTab] = useState<CanvasTab>("workspace");
  const [instruction, setInstruction] = useState("");
  const [splitRatio, setSplitRatio] = useState(0.5);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const previewLanguage = useMemo(() => {
    const normalized = language.toLowerCase().trim();
    if (normalized === "ts") return "tsx";
    if (normalized === "js") return "javascript";
    if (normalized === "py") return "python";
    if (normalized === "typescript") return "tsx";
    if (normalized === "text") return "html";
    return normalized;
  }, [language]) as PreviewLanguage;

  const canPreview = useMemo(
    () => canPreviewLanguage(previewLanguage),
    [previewLanguage],
  );
  const previewSrcdoc = useMemo(() => {
    if (canPreview) return buildSrcdoc(code, previewLanguage);
    return previewDoc;
  }, [canPreview, code, previewDoc, previewLanguage]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!draggingRef.current || !splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      if (!rect.width) return;
      const relative = (event.clientX - rect.left) / rect.width;
      setSplitRatio(Math.min(0.78, Math.max(0.22, relative)));
    };
    const onPointerUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  if (!open) return null;

  const shellClasses = embedded
    ? "flex h-full min-h-0 flex-col"
    : "fixed md:static inset-y-0 right-0 z-[70] w-full md:w-[60vw] lg:w-[50vw] xl:w-[50vw] shrink-0 border-l border-[var(--border-default)] bg-[var(--bg-primary)] shadow-[var(--shadow-soft)]";

  return (
    <>
      {!embedded ? (
        <div className="md:hidden fixed inset-0 z-[60] bg-black/50" aria-label="Close canvas" onClick={onClose} />
      ) : null}
      <aside className={shellClasses}>
        <header className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
          <div className="flex items-center gap-1.5">
            {showBackButton ? (
              <Button type="button" variant="ghost" size="icon" onClick={onBack} aria-label="Back to previous panel">
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : null}
            <div>
            <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">Canvas</p>
            <h3 className="font-display text-xl text-[var(--text-primary)]">Code Artifact</h3>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => {
                void navigator.clipboard.writeText(code);
                toast.success("Code copied");
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => {
                downloadCode(code, language);
                toast.success("Code downloaded");
              }}
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close canvas">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="flex h-[calc(100%-73px)] min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-[var(--border-default)] px-3 py-2">
            <div className="flex items-center gap-1.5">
              {(["workspace", "versions"] as CanvasTab[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTab(item)}
                  className={`rounded-full px-3 py-1 text-xs capitalize ${
                    tab === item
                      ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)]"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <select
                value={language}
                onChange={(event) => onLanguageChange(event.target.value)}
                className="h-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)] outline-none"
              >
                <option value="text">text</option>
                <option value="html">html</option>
                <option value="css">css</option>
                <option value="javascript">javascript</option>
                <option value="typescript">typescript</option>
                <option value="python">python</option>
                <option value="json">json</option>
              </select>
              <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={onSaveVersion}>
                <Save className="h-3.5 w-3.5" />
                Save version
              </Button>
              <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={onRun} disabled={!canPreview}>
                <Play className="h-3.5 w-3.5" />
                Run
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden p-3">
            {tab === "workspace" ? (
              canPreview ? (
                <div
                  ref={splitRef}
                  className="relative flex h-full min-h-0 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)]"
                >
                  <div
                    className="h-full min-h-0"
                    style={{ width: `${Math.round(splitRatio * 100)}%` }}
                  >
                    <textarea
                      value={code}
                      onChange={(event) => onCodeChange(event.target.value)}
                      className="h-full w-full resize-none border-0 bg-[var(--bg-code)] p-3 font-mono text-[13px] leading-6 text-[var(--text-primary)] outline-none"
                      spellCheck={false}
                    />
                  </div>
                  <button
                    type="button"
                    className="absolute inset-y-0 z-10 w-2 cursor-col-resize bg-[color-mix(in_oklab,var(--accent-cyan)_28%,transparent)] hover:bg-[color-mix(in_oklab,var(--accent-cyan)_45%,transparent)]"
                    style={{ left: `calc(${Math.round(splitRatio * 100)}% - 4px)` }}
                    aria-label="Resize code and preview panes"
                    onPointerDown={() => {
                      draggingRef.current = true;
                      document.body.style.cursor = "col-resize";
                      document.body.style.userSelect = "none";
                    }}
                  />
                  <div className="h-full min-h-0 flex-1 border-l border-[var(--border-default)] bg-white">
                    <iframe
                      title="Artifact preview"
                      sandbox="allow-scripts"
                      srcDoc={previewSrcdoc}
                      className="h-full w-full border-0"
                    />
                  </div>
                </div>
              ) : (
                <textarea
                  value={code}
                  onChange={(event) => onCodeChange(event.target.value)}
                  className="h-full w-full resize-none rounded-xl border border-[var(--border-default)] bg-[var(--bg-code)] p-3 font-mono text-[13px] leading-6 text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent-cyan)]/35"
                  spellCheck={false}
                />
              )
            ) : null}

            {tab === "versions" ? (
              <div className="h-full overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2">
                {versions.length === 0 ? (
                  <p className="p-2 text-sm text-[var(--text-secondary)]">No saved versions yet.</p>
                ) : (
                  <div className="space-y-2">
                    {versions.map((version) => (
                      <button
                        key={version.id}
                        type="button"
                        onClick={() => onRestoreVersion(version.id)}
                        className={`w-full rounded-lg border px-3 py-2 text-left ${
                          version.id === activeVersionId
                            ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,transparent)]"
                            : "border-[var(--border-default)] bg-[var(--bg-elevated)]"
                        }`}
                      >
                        <p className="text-xs font-medium text-[var(--text-primary)]">{version.label}</p>
                        <p className="text-[11px] text-[var(--text-secondary)]">
                          {new Date(version.createdAt).toLocaleString()} • {version.language}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <footer className="border-t border-[var(--border-default)] p-3">
            <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
              Ask AI to modify
            </p>
            <div className="flex items-center gap-2">
              <input
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="Add accessibility, refactor into components, optimize..."
                className="h-10 flex-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent-cyan)]/35"
              />
              <Button
                type="button"
                size="sm"
                className="h-10 gap-1.5"
                onClick={() => {
                  const clean = instruction.trim();
                  if (!clean) return;
                  onAskAiModify(clean);
                  setInstruction("");
                }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Send
              </Button>
            </div>
          </footer>
        </div>
      </aside>
    </>
  );
}
