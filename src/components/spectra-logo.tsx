"use client";

import { useEffect } from "react";
import { MARK, SpectraMark } from "@/components/spectra-mark";

// ── Brand colours ────────────────────────────────────────────────────────────
const DEFAULT_PRIMARY = "#7b5cf5";
const DEFAULT_ACCENT = "var(--accent-cyan)";

function readBrandColors() {
  if (typeof window === "undefined")
    return { primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT };
  const styles = getComputedStyle(document.documentElement);
  return {
    primary:
      styles.getPropertyValue("--brand-primary").trim() || DEFAULT_PRIMARY,
    accent: styles.getPropertyValue("--brand-accent").trim() || DEFAULT_ACCENT,
  };
}

// ── Canvas rendering (favicon) ───────────────────────────────────────────────
// Mirrors the SVG geometry in spectra-mark.tsx exactly (viewBox 0 0 64 64).
function face(
  ctx: CanvasRenderingContext2D,
  S: number,
  points: ReadonlyArray<readonly [number, number]>,
) {
  const k = S / 64;
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x * k, y * k);
    else ctx.lineTo(x * k, y * k);
  });
  ctx.closePath();
}

function drawMark(
  ctx: CanvasRenderingContext2D,
  S: number,
  primary: string,
  accent: string,
) {
  const k = S / 64;
  const g = (x1: number, y1: number, x2: number, y2: number) =>
    ctx.createLinearGradient(x1 * k, y1 * k, x2 * k, y2 * k);

  // upper-right sloped face (turned from the light)
  const top = g(MARK.A1[0], MARK.A1[1], MARK.C2[0], MARK.C2[1]);
  top.addColorStop(0, "#b49df8");
  top.addColorStop(1, "#6b50e6");
  face(ctx, S, [MARK.A1, MARK.C1, MARK.C2, MARK.A2]);
  ctx.fillStyle = top;
  ctx.fill();

  // long left face, receding (environment-lit glass)
  const left = g(MARK.A2[0], MARK.A2[1], MARK.B1[0], MARK.B1[1]);
  left.addColorStop(0, "#fdfbff");
  left.addColorStop(1, "#e0d7fb");
  face(ctx, S, [MARK.A1, MARK.B1, MARK.B2, MARK.A2]);
  ctx.fillStyle = left;
  ctx.fill();

  // dominant front triangular face with the dispersion gradient
  const front = g(MARK.A1[0], MARK.A1[1], MARK.B1[0] + 6, MARK.B1[1]);
  front.addColorStop(0, "#f7f3ff");
  front.addColorStop(0.52, "#c4b3fb");
  front.addColorStop(1, primary);
  face(ctx, S, [MARK.A1, MARK.B1, MARK.C1]);
  ctx.fillStyle = front;
  ctx.fill();

  // dispersion accent along the front base edge
  const disp = g(MARK.B1[0], MARK.B1[1], MARK.C1[0], MARK.C1[1]);
  disp.addColorStop(0, primary);
  disp.addColorStop(1, accent);
  ctx.strokeStyle = disp;
  ctx.lineWidth = 1.6 * k;
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(MARK.B1[0] * k, MARK.B1[1] * k);
  ctx.lineTo(MARK.C1[0] * k, MARK.C1[1] * k);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // glass edges
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(76,52,186,0.34)";
  ctx.lineWidth = 1.3 * k;
  face(ctx, S, [MARK.A1, MARK.B1, MARK.C1]);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 1.15 * k;
  ctx.beginPath();
  ctx.moveTo(MARK.B1[0] * k, MARK.B1[1] * k);
  ctx.lineTo(MARK.A1[0] * k, MARK.A1[1] * k);
  ctx.lineTo(MARK.C1[0] * k, MARK.C1[1] * k);
  ctx.stroke();
}

// ── SpectraLogo ──────────────────────────────────────────────────────────────
/** The prism mark. Kept API-compatible with the previous ribbon logo. */
export function SpectraLogo({
  size = 32,
  className,
  showTile = false,
  style,
}: {
  size?: number;
  className?: string;
  showTile?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <SpectraMark
      size={size}
      tile={showTile}
      title="Spectra"
      className={className}
      style={style}
    />
  );
}

// ── DynamicFavicon ───────────────────────────────────────────────────────────
export function DynamicFavicon() {
  useEffect(() => {
    function update() {
      const { primary, accent } = readBrandColors();
      const S = 64;
      const canvas = document.createElement("canvas");
      canvas.width = S;
      canvas.height = S;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawMark(ctx, S, primary, accent);

      const url = canvas.toDataURL("image/png");
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.type = "image/png";
      link.href = url;
    }

    update();
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (
          m.type === "attributes" &&
          (m.attributeName === "style" ||
            m.attributeName === "class" ||
            m.attributeName === "data-spectra-brand")
        ) {
          update();
          break;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
