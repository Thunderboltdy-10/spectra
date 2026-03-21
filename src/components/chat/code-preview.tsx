"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { buildSrcdoc, type PreviewLanguage } from "@/lib/code-sandbox";

type CodePreviewProps = {
  code: string;
  language: PreviewLanguage;
};

export function CodePreview({ code, language }: CodePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [key, setKey] = useState(0);

  const srcdoc = buildSrcdoc(code, language);

  const handleMessage = useCallback((event: MessageEvent) => {
    const data = event.data as Record<string, unknown>;
    if (data?.type === "spectra-sandbox-resize" && typeof data.height === "number") {
      setHeight(Math.min(Math.max(100, data.height + 24), expanded ? 800 : 480));
    }
    if (data?.type === "spectra-sandbox-error" && typeof data.message === "string") {
      setError(data.message);
    }
  }, [expanded]);

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)]">
      <div className="flex items-center justify-between border-b border-[var(--border-default)] px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--text-secondary)]">
          Live Preview
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => { setKey((k) => k + 1); setError(null); }}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            title="Reload preview"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 border-b border-[var(--border-default)] bg-[color-mix(in_oklab,var(--danger)_8%,var(--bg-secondary))] px-3 py-1.5">
          <AlertTriangle className="h-3 w-3 text-[var(--danger)]" />
          <span className="text-xs text-[var(--danger)]">{error}</span>
        </div>
      )}

      <iframe
        ref={iframeRef}
        key={key}
        srcDoc={srcdoc}
        sandbox="allow-scripts"
        title="Code preview"
        className="w-full border-0 bg-white"
        style={{ height: `${height}px`, maxHeight: expanded ? "800px" : "480px" }}
      />
    </div>
  );
}
