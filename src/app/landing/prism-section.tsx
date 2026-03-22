"use client";

import { useEffect, useRef, useState } from "react";

// ── Spectrum color interpolation (ROYGBIV) ──────────────────────────────────

const STOPS: [number, number, number][] = [
  [255, 0, 0],
  [255, 127, 0],
  [255, 230, 0],
  [0, 200, 60],
  [0, 160, 230],
  [40, 40, 255],
  [130, 0, 210],
];

function spectrumRGB(t: number): string {
  const idx = t * (STOPS.length - 1);
  const i = Math.min(Math.floor(idx), STOPS.length - 2);
  const f = idx - i;
  const [r1, g1, b1] = STOPS[i];
  const [r2, g2, b2] = STOPS[i + 1];
  return `rgb(${Math.round(r1 + f * (r2 - r1))},${Math.round(g1 + f * (g2 - g1))},${Math.round(b1 + f * (b2 - b1))})`;
}

// ── Mode labels mapped to spectrum positions ─────────────────────────────────

const MODES = [
  { label: "Researcher", t: 0.05 },
  { label: "Retrieval", t: 0.19 },
  { label: "Synthesiser", t: 0.33 },
  { label: "Marker", t: 0.48 },
  { label: "Validator", t: 0.62 },
  { label: "Extractor", t: 0.77 },
  { label: "Reviewer", t: 0.93 },
];

const NUM_BANDS = 32;

export function PrismAnimation() {
  const ref = useRef<HTMLDivElement>(null);
  const [triggered, setTriggered] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setTriggered(true);
          obs.unobserve(el);
        }
      },
      { threshold: 0.25 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── Layout ────────────────────────────────────────────────────────────────
  const W = 960,
    H = 420;

  // Prism: equilateral-ish, apex at top
  const Ax = 425,
    Ay = 75;
  const Bx = 315,
    By = 315;
  const Cx = 535,
    Cy = 315;
  const prismCx = Math.round((Ax + Bx + Cx) / 3);
  const prismCy = Math.round((Ay + By + Cy) / 3);

  // Beam entry on left face (A→B) at y ≈ 200
  const beamY = 200;
  const tEntry = (beamY - Ay) / (By - Ay);
  const entryX = Math.round(Ax + tEntry * (Bx - Ax));
  const beamStart = 30;
  const beamLen = entryX - beamStart;

  // Exit region on right face (A→C)
  // Red exits higher (less refraction), violet exits lower (more refraction)
  const exitTopY = 160;
  const exitBotY = 260;

  // Helpers: get exit x,y on the right face for a spectrum parameter t ∈ [0,1]
  const getExitY = (t: number) => exitTopY + t * (exitBotY - exitTopY);
  const getExitX = (t: number) => {
    const y = getExitY(t);
    const tR = (y - Ay) / (Cy - Ay);
    return Ax + tR * (Cx - Ax);
  };

  // Fan endpoints at right edge (allow room for mode labels)
  const fanEndX = W - 130;
  const fanTopY = 35;
  const fanBotY = 385;
  const getFanY = (t: number) => fanTopY + t * (fanBotY - fanTopY);

  return (
    <div ref={ref} className="relative w-full max-w-4xl mx-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        style={{ maxHeight: 460 }}
        aria-label="Prism refracting light into learning modes"
        role="img"
      >
        <defs>
          <filter id="prism-beam-glow">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="prism-band-glow">
            <feGaussianBlur stdDeviation="2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ── Input beam — brand-colored line from left to prism face ── */}
        <line
          x1={beamStart}
          y1={beamY}
          x2={entryX}
          y2={beamY}
          stroke="var(--brand-primary, #0e8ee8)"
          strokeOpacity={0.12}
          strokeWidth={20}
          strokeLinecap="round"
          style={{
            strokeDasharray: beamLen,
            strokeDashoffset: triggered ? 0 : beamLen,
            transition:
              "stroke-dashoffset 0.6s cubic-bezier(0.22,1,0.36,1)",
          }}
        />
        <line
          x1={beamStart}
          y1={beamY}
          x2={entryX}
          y2={beamY}
          stroke="var(--brand-primary, #0e8ee8)"
          strokeOpacity={0.7}
          strokeWidth={4}
          strokeLinecap="round"
          filter="url(#prism-beam-glow)"
          style={{
            strokeDasharray: beamLen,
            strokeDashoffset: triggered ? 0 : beamLen,
            transition:
              "stroke-dashoffset 0.6s cubic-bezier(0.22,1,0.36,1)",
          }}
        />

        {/* ── Prism — visible glass triangle with depth ── */}
        <polygon
          points={`${Ax},${Ay} ${Bx},${By} ${Cx},${Cy}`}
          strokeWidth={2}
          strokeLinejoin="round"
          style={{
            fill: "var(--bg-secondary)",
            stroke: "var(--border-default)",
            opacity: triggered ? 1 : 0,
            transform: triggered ? "scale(1)" : "scale(0.94)",
            transformOrigin: `${prismCx}px ${prismCy}px`,
            transition:
              "opacity 0.4s 0.15s, transform 0.4s 0.15s cubic-bezier(0.22,1,0.36,1)",
          }}
        />
        {/* Left face edge highlight (light enters here) */}
        <line
          x1={Ax}
          y1={Ay}
          x2={Bx}
          y2={By}
          stroke="var(--text-primary)"
          strokeOpacity={0.07}
          strokeWidth={3}
          style={{
            opacity: triggered ? 1 : 0,
            transition: "opacity 0.4s 0.25s",
          }}
        />
        {/* Right face edge highlight */}
        <line
          x1={Ax}
          y1={Ay}
          x2={Cx}
          y2={Cy}
          stroke="var(--text-primary)"
          strokeOpacity={0.04}
          strokeWidth={2}
          style={{
            opacity: triggered ? 1 : 0,
            transition: "opacity 0.4s 0.25s",
          }}
        />
        {/* Internal refraction region — subtle tint inside prism */}
        <polygon
          points={`${entryX},${beamY} ${Math.round(getExitX(0))},${exitTopY} ${Math.round(getExitX(1))},${exitBotY}`}
          fill="var(--brand-primary)"
          fillOpacity={0.04}
          style={{
            opacity: triggered ? 1 : 0,
            transition: "opacity 0.5s 0.45s",
          }}
        />

        {/* ── Spectrum bands — continuous rainbow from right face edge ── */}
        {Array.from({ length: NUM_BANDS }, (_, i) => {
          const t = i / (NUM_BANDS - 1);
          const color = spectrumRGB(t);

          const x1 = getExitX(t);
          const y1 = getExitY(t);
          const x2 = fanEndX;
          const y2 = getFanY(t);
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.sqrt(dx * dx + dy * dy);
          const delay = 0.65 + i * 0.02;

          return (
            <g key={i}>
              {/* Wide glow layer — fills gaps for continuous spectrum look */}
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={color}
                strokeWidth={14}
                strokeLinecap="butt"
                opacity={0.1}
                style={{
                  strokeDasharray: len,
                  strokeDashoffset: triggered ? 0 : len,
                  transition: `stroke-dashoffset 0.55s ${delay}s cubic-bezier(0.22,1,0.36,1)`,
                }}
              />
              {/* Crisp band */}
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={color}
                strokeWidth={3}
                strokeLinecap="butt"
                opacity={0.8}
                filter="url(#prism-band-glow)"
                style={{
                  strokeDasharray: len,
                  strokeDashoffset: triggered ? 0 : len,
                  transition: `stroke-dashoffset 0.55s ${delay}s cubic-bezier(0.22,1,0.36,1)`,
                }}
              />
            </g>
          );
        })}

        {/* ── Mode labels — appear after spectrum expands ── */}
        {MODES.map((mode) => {
          const y = getFanY(mode.t);
          const color = spectrumRGB(mode.t);
          const delay = 1.15 + mode.t * (NUM_BANDS - 1) * 0.02;
          return (
            <g key={mode.label}>
              <circle
                cx={fanEndX + 10}
                cy={y}
                r={4}
                fill={color}
                style={{
                  opacity: triggered ? 1 : 0,
                  transition: `opacity 0.3s ${delay}s`,
                }}
              />
              <text
                x={fanEndX + 22}
                y={y + 5}
                fill="var(--text-secondary, #6b5f52)"
                fontSize={15}
                fontWeight={500}
                style={{
                  fontFamily: "var(--font-manrope, sans-serif)",
                  opacity: triggered ? 1 : 0,
                  transition: `opacity 0.3s ${delay + 0.05}s`,
                }}
              >
                {mode.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
