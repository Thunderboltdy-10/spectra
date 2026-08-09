"use client";

/**
 * The product prism family.
 *
 * The landing page runs one true 3D prism. The application must never pay for
 * that just to animate a 24px icon, so everything inside Spectra draws from a
 * lightweight family that shares the real object's silhouette and material
 * cues: the same three faces, the same dominant front triangle, the same
 * dispersion along the base edge.
 *
 *   SpectraMark      static glyph (favicon, header, tiny icons) — see
 *                    `spectra-mark.tsx`, the geometric source of truth.
 *   PrismLoader      light entering the glass. The ordinary loading state.
 *   PrismRunMark     a run's optical state, for the Live Dock prism slot.
 *
 * All motion here is CSS on clipped SVG. No canvas, no WebGL, no timers.
 */

import { useId } from "react";
import { FACE_FRONT, FACE_LEFT, FACE_TOP, MARK } from "@/components/spectra-mark";

const pt = (p: readonly [number, number]) => `${p[0]},${p[1]}`;

/** Optical state of a run, shared by the loader and the dock mark. */
export type PrismOptics =
  | "dormant"
  | "working"
  | "waiting"
  | "completed"
  | "failed";

function PrismBody({ id, dim }: { id: string; dim: boolean }) {
  return (
    <>
      <defs>
        <linearGradient
          id={`${id}-front`}
          gradientUnits="userSpaceOnUse"
          x1={MARK.A1[0]}
          y1={MARK.A1[1]}
          x2={MARK.B1[0] + 6}
          y2={MARK.B1[1]}
        >
          <stop offset="0" stopColor="#f7f3ff" />
          <stop offset="0.52" stopColor="#c4b3fb" />
          <stop offset="1" stopColor="var(--brand-primary)" />
        </linearGradient>
        <linearGradient
          id={`${id}-left`}
          gradientUnits="userSpaceOnUse"
          x1={MARK.A2[0]}
          y1={MARK.A2[1]}
          x2={MARK.B1[0]}
          y2={MARK.B1[1]}
        >
          <stop offset="0" stopColor="#fdfbff" />
          <stop offset="1" stopColor="#e0d7fb" />
        </linearGradient>
        <linearGradient
          id={`${id}-top`}
          gradientUnits="userSpaceOnUse"
          x1={MARK.A1[0]}
          y1={MARK.A1[1]}
          x2={MARK.C2[0]}
          y2={MARK.C2[1]}
        >
          <stop offset="0" stopColor="#b49df8" />
          <stop offset="1" stopColor="#6b50e6" />
        </linearGradient>
      </defs>
      <g opacity={dim ? 0.72 : 1}>
        <polygon points={FACE_TOP} fill={`url(#${id}-top)`} />
        <polygon points={FACE_LEFT} fill={`url(#${id}-left)`} />
        <polygon points={FACE_FRONT} fill={`url(#${id}-front)`} />
      </g>
    </>
  );
}

function PrismEdges() {
  return (
    <g fill="none" strokeLinejoin="round" strokeLinecap="round" strokeWidth="1.15">
      <polygon points={FACE_FRONT} stroke="rgba(76,52,186,0.34)" strokeWidth="1.3" />
      <polyline
        points={`${pt(MARK.B2)} ${pt(MARK.A2)} ${pt(MARK.C2)}`}
        stroke="rgba(76,52,186,0.22)"
      />
      <line
        x1={MARK.A2[0]}
        y1={MARK.A2[1]}
        x2={MARK.A1[0]}
        y2={MARK.A1[1]}
        stroke="rgba(76,52,186,0.26)"
      />
      <polyline
        points={`${pt(MARK.B1)} ${pt(MARK.A1)} ${pt(MARK.C1)}`}
        stroke="rgba(255,255,255,0.75)"
      />
    </g>
  );
}

/**
 * Light entering the glass: a spectral band travels through the front face and
 * leaves along the base edge. Finite where the work is finite — a completed
 * run resolves to one warm coherent edge instead of looping forever.
 */
export function PrismLoader({
  size = 28,
  optics = "working",
  className,
  label,
}: {
  size?: number;
  optics?: PrismOptics;
  className?: string;
  /** Announced to assistive tech. Omit inside a labelled container. */
  label?: string;
}) {
  const rawId = useId();
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={
        className
          ? `spectra-prism-optic ${className}`
          : "spectra-prism-optic"
      }
      data-optics={optics}
      role={label ? "img" : "presentation"}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ display: "block", flexShrink: 0 }}
    >
      <PrismBody id={id} dim={optics === "dormant" || optics === "waiting"} />

      <defs>
        <clipPath id={`${id}-clip`}>
          <polygon points={FACE_FRONT} />
        </clipPath>
        <linearGradient id={`${id}-band`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--band-hue)" stopOpacity="0" />
          <stop offset="0.5" stopColor="var(--band-hue)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--band-tail)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* the travelling band, clipped to the glass so it never spills */}
      <g clipPath={`url(#${id}-clip)`}>
        <rect
          className="spectra-prism-band"
          x="16"
          y="10"
          width="17"
          height="42"
          fill={`url(#${id}-band)`}
        />
      </g>

      {/* dispersion along the base edge — the output of the glass */}
      <line
        className="spectra-prism-dispersion"
        x1={MARK.B1[0]}
        y1={MARK.B1[1]}
        x2={MARK.C1[0]}
        y2={MARK.C1[1]}
        strokeWidth="1.8"
        strokeLinecap="round"
      />

      <PrismEdges />
    </svg>
  );
}

/**
 * The Live Dock's prism slot. Identical family, sized for the dock and marked
 * with `data-prism-slot` so the landing story can anchor its one true 3D prism
 * over this exact box during the final reveal.
 */
export function PrismRunMark({
  size = 18,
  optics = "working",
  slot,
}: {
  size?: number;
  optics?: PrismOptics;
  /** Slot id for spatial anchoring. Defaults to the Live Dock slot. */
  slot?: string;
}) {
  return (
    <span
      className="spectra-prism-slot"
      data-prism-slot={slot ?? "live-dock"}
      data-optics={optics}
      style={{ width: size, height: size }}
    >
      <PrismLoader size={size} optics={optics} />
    </span>
  );
}
