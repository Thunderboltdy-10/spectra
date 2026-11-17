"use client";

import { useEffect, useState } from "react";
import { FileViewer, type ViewedFile } from "./file-viewer";

/*
 * Pictures open in Spectra, not in a new tab. Anything marked
 * `data-view-image` (a picture in a reply, a screenshot sent with feedback, a
 * link to a picture) opens here on a click; a modified click (Ctrl/Cmd, the
 * middle button) still opens it in a new tab the browser's way. The viewer
 * itself can grow to the whole window and has a way out to a new tab.
 */

const IMAGE_PATH = /\.(png|jpe?g|gif|webp|avif|svg|bmp)(\?|#|$)/i;

/** Whether a link points at a picture, so it can open in the viewer. */
export function isImageHref(href: string) {
  try {
    return IMAGE_PATH.test(new URL(href, "http://x").pathname);
  } catch {
    return false;
  }
}

function nameOf(url: string, fallback?: string | null) {
  if (fallback?.trim()) return fallback.trim();
  try {
    const last = new URL(url, location.href).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : "Picture";
  } catch {
    return "Picture";
  }
}

export function ImageViewerHost() {
  const [file, setFile] = useState<ViewedFile | null>(null);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const marked = (event.target as Element | null)?.closest?.<HTMLElement>("[data-view-image]");
      if (!marked) return;
      // An editor's picture is for editing: it is never marked, but an
      // editable region around a marked one wins too.
      if (marked.closest("[contenteditable=true]")) return;
      const url = marked.dataset.viewImage || marked.getAttribute("src") || marked.getAttribute("href");
      if (!url) return;
      event.preventDefault();
      event.stopPropagation();
      setFile({ key: url, filename: nameOf(url, marked.getAttribute("alt") || marked.getAttribute("title")), kind: "image", url });
    };
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  }, []);
  return <FileViewer file={file} onClose={() => setFile(null)} />;
}
