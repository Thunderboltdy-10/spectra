"use client";

import { useEffect } from "react";
import { SpectraMark } from "@/components/spectra-mark";
import { MARK_POSE, PRISM_PALETTES, STATUS_COLOURS, prismSvg, type PrismStatus } from "@/features/spectra/life/prism";
import { spectraBus } from "@/features/spectra/events";

/** The working dot in a still icon: the spectrum's violet. */
const WORKING_RGB: [number, number, number] = [139, 108, 246];

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
 * The tab icon is the prism at rest, with its status dot: whatever the island
 * publishes as `prism.status`, else working while a run is live and yellow
 * while a run waits on the user. Drawn from the same display list as the live
 * prism (`prismSvg`), so the favicon is never a different object.
 */
export function DynamicFavicon() {
  useEffect(() => {
    const needs = new Set<string>();
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    let shown = "";
    const status = (): PrismStatus | null => {
      const published = spectraBus.getQuery("prism.status");
      if (published) return published.status;
      if (needs.size) return "needs";
      return (spectraBus.getQuery("run.active")?.runIds.length ?? 0) > 0 ? "working" : null;
    };
    const render = () => {
      const current = status();
      const palette = dark.matches ? PRISM_PALETTES.dark : PRISM_PALETTES.light;
      const rgb = current === "working" ? WORKING_RGB : current ? STATUS_COLOURS[current] : null;
      const pose = rgb ? { ...MARK_POSE, status: { rgb, size: 1, from: 0 } } : MARK_POSE;
      const svg = prismSvg(pose, { size: 64, palette, detail: "mark" });
      if (svg === shown) return;
      shown = svg;
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
    const offs = [
      spectraBus.subscribe("prism.status", render),
      spectraBus.subscribe("run.active", (value) => {
        for (const id of needs) if (!value.runIds.includes(id)) needs.delete(id);
        render();
      }),
      spectraBus.on("run.requiredInput", ({ runId }) => {
        needs.add(runId);
        render();
      }),
      spectraBus.on("run.changed", ({ runId }) => {
        if (needs.delete(runId)) render();
      }),
    ];
    dark.addEventListener("change", render);
    return () => {
      for (const off of offs) off();
      dark.removeEventListener("change", render);
    };
  }, []);

  return null;
}
