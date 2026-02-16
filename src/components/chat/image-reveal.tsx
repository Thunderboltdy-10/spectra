"use client";

import { useState } from "react";
import Image from "next/image";
import { Download, Maximize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type ImageRevealProps = {
  src: string;
  alt?: string;
  prompt?: string;
};

export function ImageReveal({ src, alt, prompt }: ImageRevealProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div className="my-4 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-card)]">
        {prompt ? (
          <div className="border-b border-[var(--border-default)] px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">Generated Image</p>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{prompt}</p>
          </div>
        ) : null}
        <div className="relative">
          <Image
            src={src}
            alt={alt ?? "Generated image"}
            width={768}
            height={768}
            className="w-full object-contain"
            unoptimized
          />
          <div className="absolute bottom-2 right-2 flex gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-8 w-8 rounded-lg bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
              onClick={() => setExpanded(true)}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
            <a
              href={src}
              download
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-black/50 text-white backdrop-blur-sm transition hover:bg-black/70"
            >
              <Download className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>

      {expanded ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setExpanded(false)}>
          <button
            type="button"
            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            onClick={() => setExpanded(false)}
          >
            <X className="h-5 w-5" />
          </button>
          <Image
            src={src}
            alt={alt ?? "Generated image"}
            width={1024}
            height={1024}
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain"
            unoptimized
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}
