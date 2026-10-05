"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark } from "lucide-react";
import { Loader2, Check, ExternalLink } from "@/components/icons/glyph-icons";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { readConvexError } from "../../../../shared/convex-error.mjs";
import type { LiveWidget } from "../ai/harness-exchange";
import { widgetArtifactArgs } from "../widgets/widget-artifact";
import {
  WIDGET_LIMITS,
  WIDGET_MESSAGE,
  WIDGET_SANDBOX,
  buildWidgetDocument,
  clampWidgetHeight,
  type WidgetTheme,
} from "../widgets/widget-document";

/*
 * A show_widget visual in the thread. The frame is sandboxed with scripts only
 * (an opaque origin: no cookies, storage or app access) and its document
 * carries a no-network CSP. The app tells it the theme; it tells the app its
 * height. The user can keep it as work.
 */

function readTheme(): WidgetTheme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** The app's light or dark mode, following the theme toggle. */
export function useDocumentTheme(): WidgetTheme {
  const [theme, setTheme] = useState<WidgetTheme>(readTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/** Widgets a saved reply carries in its metadata. */
export function messageWidgets(metadata: Record<string, unknown> | undefined): LiveWidget[] {
  const rows = metadata?.widgets;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const value = row as Record<string, unknown>;
    if (typeof value.id !== "string" || typeof value.title !== "string" || typeof value.html !== "string") return [];
    if (value.html.length > WIDGET_LIMITS.maxHtmlChars) return [];
    return [{ id: value.id, title: value.title, html: value.html }];
  });
}

type SaveState = { status: "idle" } | { status: "saving" } | { status: "saved"; artifactId: string } | { status: "failed"; message: string };

export function ThreadWidget({
  widget,
  threadId,
  onOpenArtifact,
}: {
  widget: LiveWidget;
  threadId?: string;
  onOpenArtifact?: (artifactId: string) => void;
}) {
  const theme = useDocumentTheme();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>(WIDGET_LIMITS.defaultHeight);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const create = useMutation(api.spectraArtifacts.create);
  // The document is built once per widget; later theme changes are posted in,
  // so switching mode never reloads (and resets) the visual.
  const initialTheme = useRef(theme);
  const srcDoc = useMemo(
    () => buildWidgetDocument({ title: widget.title, html: widget.html, theme: initialTheme.current }),
    [widget.title, widget.html],
  );

  const postTheme = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ type: WIDGET_MESSAGE.theme, theme }, "*");
  }, [theme]);

  useEffect(postTheme, [postTheme]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (data?.type === WIDGET_MESSAGE.size) setHeight(clampWidgetHeight(data.height));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const saveAsWork = async () => {
    if (save.status === "saving" || save.status === "saved") return;
    setSave({ status: "saving" });
    try {
      const result = await create({
        ...widgetArtifactArgs(widget),
        ...(threadId ? { threadId: threadId as Id<"spectraThreads"> } : {}),
      });
      setSave({ status: "saved", artifactId: String(result.artifactId) });
    } catch (error) {
      setSave({ status: "failed", message: readConvexError(error).message || "Could not save this visual. Try again." });
    }
  };

  return (
    <figure data-spectra-card="result" data-card-state="normal" data-spectra-widget={widget.id} className="overflow-hidden">
      <figcaption className="flex items-center gap-2 px-3.5 pt-2.5">
        <span className="min-w-0 flex-1 truncate text-micro font-semibold text-[var(--text-secondary)]">{widget.title}</span>
        {save.status === "saved" ? (
          onOpenArtifact ? (
            <button
              type="button"
              onClick={() => onOpenArtifact(save.artifactId)}
              className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-micro font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              Open saved work
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-1 text-micro font-semibold text-[var(--text-secondary)]">
              <Check className="h-3.5 w-3.5" aria-hidden />
              Saved
            </span>
          )
        ) : (
          <button
            type="button"
            onClick={() => void saveAsWork()}
            disabled={save.status === "saving"}
            className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-micro font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:opacity-60"
          >
            {save.status === "saving" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Bookmark className="h-3.5 w-3.5" aria-hidden />
            )}
            Save as work
          </button>
        )}
      </figcaption>
      {save.status === "failed" ? (
        <p role="alert" className="px-3.5 pt-1 text-micro text-[var(--text-secondary)]">
          {save.message}
        </p>
      ) : null}
      <iframe
        ref={frame}
        title={widget.title}
        sandbox={WIDGET_SANDBOX}
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        onLoad={postTheme}
        style={{ height }}
        className="block w-full border-0 bg-[var(--bg-primary)]"
      />
    </figure>
  );
}

/** The widgets a run drew, in the order it drew them. */
export function HarnessWidgets({
  widgets,
  threadId,
  onOpenArtifact,
}: {
  widgets: readonly LiveWidget[] | undefined;
  threadId?: string;
  onOpenArtifact?: (artifactId: string) => void;
}) {
  if (!widgets?.length) return null;
  return (
    <div className="mt-4 space-y-3">
      {widgets.map((widget) => (
        <ThreadWidget key={widget.id} widget={widget} threadId={threadId} onOpenArtifact={onOpenArtifact} />
      ))}
    </div>
  );
}
