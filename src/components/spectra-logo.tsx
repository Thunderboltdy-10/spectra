"use client";

import { useEffect } from "react";
import { MARK, REFRACTIONS, SpectraMark } from "@/components/spectra-mark";
import { spectraBus } from "@/features/spectra/events";

// ── Canvas rendering (favicon) ───────────────────────────────────────────────
// Mirrors the SVG geometry in spectra-mark.tsx exactly (viewBox 0 0 64 64).
function drawMark(ctx: CanvasRenderingContext2D, S: number, active = false) {
  const k = S / 64;
  const gradient = (x1: number, y1: number, x2: number, y2: number) =>
    ctx.createLinearGradient(x1 * k, y1 * k, x2 * k, y2 * k);
  const polygon = (points: ReadonlyArray<readonly [number, number]>) => {
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point[0] * k, point[1] * k);
      else ctx.lineTo(point[0] * k, point[1] * k);
    });
    ctx.closePath();
  };

  const top = gradient(17, 13, 58, 47);
  top.addColorStop(0, "rgba(201,187,244,.72)");
  top.addColorStop(1, "rgba(113,85,218,.9)");
  polygon([MARK.A1, MARK.C1, MARK.C2, MARK.A2]);
  ctx.fillStyle = top;
  ctx.fill();
  const left = gradient(9, 18, 34, 52);
  left.addColorStop(0, "rgba(245,241,255,.82)");
  left.addColorStop(1, "rgba(183,166,238,.74)");
  polygon([MARK.A1, MARK.B1, MARK.B2, MARK.A2]);
  ctx.fillStyle = left;
  ctx.fill();
  const front = gradient(35, 8, 43, 55);
  front.addColorStop(0, "rgba(251,249,255,.96)");
  front.addColorStop(0.45, "rgba(216,205,248,.92)");
  front.addColorStop(1, "rgba(128,104,222,.92)");
  polygon([MARK.A1, MARK.B1, MARK.C1]);
  ctx.fillStyle = front;
  ctx.fill();

  ctx.save();
  polygon([MARK.A1, MARK.C1, MARK.B1, MARK.B2, MARK.A2]);
  ctx.clip();
  ctx.lineCap = "round";
  ctx.lineWidth = (active ? 1.3 : 0.95) * k;
  for (const ray of REFRACTIONS) {
    ctx.strokeStyle = ray.color;
    ctx.beginPath();
    ctx.moveTo(ray.from[0] * k, ray.from[1] * k);
    ctx.lineTo(ray.to[0] * k, ray.to[1] * k);
    ctx.stroke();
  }
  const pool = ctx.createRadialGradient(
    MARK.GLOW.cx * k,
    MARK.GLOW.cy * k,
    0,
    MARK.GLOW.cx * k,
    MARK.GLOW.cy * k,
    MARK.GLOW.r * k,
  );
  pool.addColorStop(0, active ? "rgba(164,143,251,0.95)" : "rgba(164,143,251,0.62)");
  pool.addColorStop(0.6, active ? "rgba(154,124,255,0.4)" : "rgba(154,124,255,0.22)");
  pool.addColorStop(1, "rgba(154,124,255,0)");
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, S, S);
  ctx.restore();

  // Glass edges preserve the three-quarter volume at 16px.
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(76,52,186,0.30)";
  ctx.lineWidth = 1.05 * k;
  polygon([MARK.A1, MARK.B1, MARK.C1]);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.05 * k;
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
/* While a run is live the tab prism's internal light strengthens. */
export function DynamicFavicon() {
  useEffect(() => {
    const render = (active: boolean) => {
      const S = 64;
      const canvas = document.createElement("canvas");
      canvas.width = S;
      canvas.height = S;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawMark(ctx, S, active);

      const url = canvas.toDataURL("image/png");
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.type = "image/png";
      link.href = url;
    };

    render((spectraBus.getQuery("run.active")?.runIds.length ?? 0) > 0);
    return spectraBus.subscribe("run.active", (value) => {
      render(value.runIds.length > 0);
    });
  }, []);

  return null;
}
