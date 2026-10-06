"use client";

import katex from "katex";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

/*
 * How an equation is drawn, everywhere: in the document and field editors'
 * equation nodes and in every read-only render of the shared rich content.
 * KaTeX runs only once the equation nears the viewport.
 */

function renderEquation(latex: string, displayMode: boolean) {
  return katex.renderToString(latex || (displayMode ? "\\text{New equation}" : "\\text{equation}"), { throwOnError: false, displayMode, strict: "ignore" });
}

const equationPreviewListeners = new Map<Element, (nearViewport: boolean) => void>();
let equationPreviewObserver: IntersectionObserver | null = null;

function observeEquationPreview(
  element: Element,
  listener: (nearViewport: boolean) => void,
) {
  if (typeof IntersectionObserver === "undefined") {
    listener(true);
    return () => undefined;
  }
  if (!equationPreviewObserver) {
    equationPreviewObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          equationPreviewListeners.get(entry.target)?.(entry.isIntersecting);
      },
      { rootMargin: "1200px 0px" },
    );
  }
  equationPreviewListeners.set(element, listener);
  equationPreviewObserver.observe(element);
  return () => {
    equationPreviewListeners.delete(element);
    equationPreviewObserver?.unobserve(element);
    if (equationPreviewListeners.size === 0) {
      equationPreviewObserver?.disconnect();
      equationPreviewObserver = null;
    }
  };
}

function estimatedEquationHeight(latex: string, displayMode: boolean) {
  if (!displayMode) return 24;
  const rows = Math.max(1, latex.split(/(?:\r?\n|\\\\)/).length);
  const wrappedRows = Math.ceil(latex.length / 100);
  return Math.min(240, Math.max(42, rows * 28 + Math.min(5, wrappedRows) * 14));
}

export function EquationPreview({
  latex,
  displayMode,
  forceRender,
}: {
  latex: string;
  displayMode: boolean;
  forceRender: boolean;
}) {
  const elementRef = useRef<HTMLSpanElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const shouldRender = nearViewport || forceRender;

  useEffect(() => {
    if (forceRender) {
      setNearViewport(true);
      return;
    }
    const element = elementRef.current;
    if (!element) return;
    return observeEquationPreview(element, setNearViewport);
  }, [forceRender]);

  const html = useMemo(
    () => (shouldRender ? renderEquation(latex, displayMode) : null),
    [displayMode, latex, shouldRender],
  );
  useLayoutEffect(() => {
    if (!shouldRender) return;
    const height = elementRef.current?.getBoundingClientRect().height ?? 0;
    if (height <= 0) return;
    const next = Math.ceil(height);
    setMeasuredHeight((current) => Math.max(current, next));
  }, [html, shouldRender]);

  const estimatedHeight = estimatedEquationHeight(latex, displayMode);
  const style: CSSProperties = displayMode
    ? {
        display: "block",
        width: "100%",
        minHeight: `${Math.max(estimatedHeight, measuredHeight)}px`,
      }
    : {
        display: "inline-block",
        minWidth: `${Math.min(80, Math.max(1, Math.ceil(latex.length * 0.5)))}ch`,
        minHeight: "1.25em",
        verticalAlign: "middle",
      };

  return (
    <span
      ref={elementRef}
      className="spectra-equation-preview"
      data-equation-preview-pending={shouldRender ? undefined : "true"}
      role="math"
      aria-label={latex || "New equation"}
      style={style}
      dangerouslySetInnerHTML={html === null ? undefined : { __html: html }}
    />
  );
}
