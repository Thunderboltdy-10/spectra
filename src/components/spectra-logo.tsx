"use client";

import { useEffect } from "react";
import { SpectraMark } from "@/components/spectra-mark";
import { MARK_POSE, PRISM_PALETTES, prismSvg } from "@/features/spectra/life/prism";

// ── SpectraLogo ──────────────────────────────────────────────────────────────
/** The prism mark, named for assistive technology. */
export function SpectraLogo({
  size = 32,
  className,
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <SpectraMark
      size={size}
      title="Spectra"
      className={className}
      style={style}
    />
  );
}

// ── DynamicFavicon ───────────────────────────────────────────────────────────
/**
 * The tab icon is the prism at rest, plain: no status dot, whatever Spectra is
 * doing. Drawn from the same display list as the live prism (`prismSvg`), so
 * the favicon is never a different object; it follows the system's light or
 * dark.
 */
export function DynamicFavicon() {
  useEffect(() => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const render = () => {
      const svg = prismSvg(MARK_POSE, { size: 64, palette: dark.matches ? PRISM_PALETTES.dark : PRISM_PALETTES.light, detail: "mark" });
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"][data-spectra]');
      if (!link) {
        for (const old of document.querySelectorAll('link[rel="icon"]')) old.remove();
        link = document.createElement("link");
        link.rel = "icon";
        link.dataset.spectra = "true";
        document.head.appendChild(link);
      }
      link.type = "image/svg+xml";
      link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    };

    render();
    dark.addEventListener("change", render);
    return () => dark.removeEventListener("change", render);
  }, []);

  return null;
}
