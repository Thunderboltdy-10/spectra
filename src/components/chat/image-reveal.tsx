"use client";

import { useState } from "react";
import Image from "next/image";
import { Copy, Download, Maximize2, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type ImageRevealProps = {
  src: string;
  alt?: string;
  prompt?: string;
};

async function copyImageToClipboard(url: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob }),
    ]);
    toast.success("Image copied to clipboard");
  } catch {
    // Fallback: copy URL
    await navigator.clipboard.writeText(url);
    toast.success("Image URL copied to clipboard");
  }
}

async function downloadImage(url: string, filename?: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename ?? "generated-image.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    // Fallback: open in new tab
    window.open(url, "_blank");
  }
}

async function shareImage(url: string) {
  if (navigator.share) {
    try {
      await navigator.share({ url });
    } catch {
      // User cancelled or share failed
    }
  } else {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  }
}

export function ImageReveal({ src, alt, prompt }: ImageRevealProps) {
  const [expanded, setExpanded] = useState(false);

  if (!src) return null;

  return (
    <>
      <div className="group/img my-4 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover,var(--shadow-card))]">
        {prompt ? (
          <div className="border-b border-[var(--border-default)] px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">Generated Image</p>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{prompt}</p>
          </div>
        ) : null}
        <div className="relative cursor-pointer" onClick={() => setExpanded(true)}>
          <Image
            src={src}
            alt={alt ?? "Generated image"}
            width={768}
            height={768}
            className="w-full object-contain transition-transform duration-300 group-hover/img:scale-[1.01]"
            unoptimized
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 transition-opacity group-hover/img:opacity-100" />
          <div className="absolute bottom-2 right-2 flex gap-1.5 opacity-0 transition-opacity group-hover/img:opacity-100">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-8 w-8 rounded-lg bg-black/60 text-white backdrop-blur-md hover:bg-black/80"
              onClick={(e) => { e.stopPropagation(); void copyImageToClipboard(src); }}
              title="Copy image"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-8 w-8 rounded-lg bg-black/60 text-white backdrop-blur-md hover:bg-black/80"
              onClick={(e) => { e.stopPropagation(); void downloadImage(src); }}
              title="Download"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-8 w-8 rounded-lg bg-black/60 text-white backdrop-blur-md hover:bg-black/80"
              onClick={(e) => { e.stopPropagation(); void shareImage(src); }}
              title="Share"
            >
              <Share2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-8 w-8 rounded-lg bg-black/60 text-white backdrop-blur-md hover:bg-black/80"
              onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
              title="Enlarge"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {expanded ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md"
          onClick={() => setExpanded(false)}
        >
          <div className="absolute right-4 top-4 flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-sm text-white transition hover:bg-white/20"
              onClick={(e) => { e.stopPropagation(); void copyImageToClipboard(src); }}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-sm text-white transition hover:bg-white/20"
              onClick={(e) => { e.stopPropagation(); void downloadImage(src); }}
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </button>
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              onClick={() => setExpanded(false)}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <Image
            src={src}
            alt={alt ?? "Generated image"}
            width={1536}
            height={1536}
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
            unoptimized
            onClick={(e) => e.stopPropagation()}
          />
          {prompt ? (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 max-w-lg rounded-xl bg-black/60 px-4 py-2 text-center text-sm text-white/80 backdrop-blur-md" onClick={(e) => e.stopPropagation()}>
              {prompt}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
