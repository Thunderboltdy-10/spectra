import { useId } from "react";

/** The landing prism's asymmetric extrusion projected at three-quarter view. */
export const MARK = {
  A1: [39.5, 7.5] as const,
  B1: [27.5, 55.5] as const,
  C1: [59, 50.5] as const,
  A2: [18.5, 13.5] as const,
  B2: [7, 49.5] as const,
  C2: [37.5, 45.5] as const,
  GLOW: { cx: 38.5, cy: 36, r: 18 } as const,
} as const;

const pt = (point: readonly [number, number]) => `${point[0]},${point[1]}`;
export const FACE_FRONT = `${pt(MARK.A1)} ${pt(MARK.B1)} ${pt(MARK.C1)}`;
export const FACE_LEFT = `${pt(MARK.A1)} ${pt(MARK.B1)} ${pt(MARK.B2)} ${pt(MARK.A2)}`;
export const FACE_TOP = `${pt(MARK.A1)} ${pt(MARK.C1)} ${pt(MARK.C2)} ${pt(MARK.A2)}`;

export const WAVELENGTHS = [
  "#ff647f",
  "#ffab4a",
  "#f6d75d",
  "#48c997",
  "#4f9fe6",
  "#9176e8",
] as const;

/** Refraction is held inside the body, as it is in the landing object. */
export const REFRACTIONS = [
  { from: [20, 19], to: [52, 46], color: WAVELENGTHS[0] },
  { from: [17, 24], to: [49, 47], color: WAVELENGTHS[1] },
  { from: [15, 29], to: [46, 48], color: WAVELENGTHS[2] },
  { from: [13, 34], to: [43, 49], color: WAVELENGTHS[3] },
  { from: [11, 39], to: [40, 50], color: WAVELENGTHS[4] },
  { from: [9, 44], to: [37, 51], color: WAVELENGTHS[5] },
] as const;

export function refractionsForSize(size: number) {
  return size < 24
    ? { rays: [REFRACTIONS[0], REFRACTIONS[3], REFRACTIONS[5]], width: 1.2 }
    : { rays: REFRACTIONS, width: 0.9 };
}

/** Shared geometry for static identity and active loading/run states. */
export function PrismCore({
  id,
  size,
  dim = false,
  tile = false,
  animated = false,
}: {
  id: string;
  size: number;
  dim?: boolean;
  tile?: boolean;
  animated?: boolean;
}) {
  const { rays, width } = refractionsForSize(size);
  return (
    <>
      <defs>
        <linearGradient id={`${id}-front`} gradientUnits="userSpaceOnUse" x1="35" y1="8" x2="43" y2="55">
          <stop offset="0" stopColor={tile ? "#ffffff" : "#fbf9ff"} stopOpacity="0.96" />
          <stop offset="0.45" stopColor={tile ? "#eee9ff" : "#d8cdf8"} stopOpacity="0.92" />
          <stop offset="1" stopColor={tile ? "#cbbdf8" : "#8068de"} stopOpacity="0.92" />
        </linearGradient>
        <linearGradient id={`${id}-left`} gradientUnits="userSpaceOnUse" x1="9" y1="18" x2="34" y2="52">
          <stop offset="0" stopColor={tile ? "#ffffff" : "#f5f1ff"} stopOpacity="0.82" />
          <stop offset="1" stopColor={tile ? "#d9cffb" : "#b7a6ee"} stopOpacity="0.74" />
        </linearGradient>
        <linearGradient id={`${id}-top`} gradientUnits="userSpaceOnUse" x1="17" y1="13" x2="58" y2="47">
          <stop offset="0" stopColor={tile ? "#f7f3ff" : "#c9bbf4"} stopOpacity="0.72" />
          <stop offset="1" stopColor={tile ? "#bba9f5" : "#7155da"} stopOpacity="0.9" />
        </linearGradient>
        <radialGradient id={`${id}-pool`} gradientUnits="userSpaceOnUse" cx={MARK.GLOW.cx} cy={MARK.GLOW.cy} r={MARK.GLOW.r}>
          <stop offset="0" stopColor={tile ? "#ffffff" : "#a99af5"} stopOpacity="0.72" />
          <stop offset="0.48" stopColor={tile ? "#ded6ff" : "#9075ed"} stopOpacity="0.28" />
          <stop offset="1" stopColor="#8267e3" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-body-clip`}>
          <path d="M39.5 7.5L59 50.5L27.5 55.5L7 49.5L18.5 13.5Z" />
        </clipPath>
      </defs>
      <g className={animated ? "spectra-prism-body" : "spectra-mark-body"} opacity={dim ? 0.76 : 1}>
        <polygon points={FACE_TOP} fill={`url(#${id}-top)`} />
        <polygon points={FACE_LEFT} fill={`url(#${id}-left)`} />
        <polygon points={FACE_FRONT} fill={`url(#${id}-front)`} />
        <g clipPath={`url(#${id}-body-clip)`} className="spectra-prism-refractions" fill="none" strokeLinecap="round">
          {rays.map((ray, index) => (
            <line
              key={ray.color}
              className={animated ? "spectra-prism-ray" : undefined}
              style={animated ? ({ "--ray-i": index } as React.CSSProperties) : undefined}
              x1={ray.from[0]}
              y1={ray.from[1]}
              x2={ray.to[0]}
              y2={ray.to[1]}
              stroke={ray.color}
              strokeWidth={width}
            />
          ))}
          <circle className="spectra-prism-pool" cx={MARK.GLOW.cx} cy={MARK.GLOW.cy} r={MARK.GLOW.r} fill={`url(#${id}-pool)`} />
        </g>
        <g fill="none" strokeLinejoin="round" strokeLinecap="round">
          <polygon points={FACE_FRONT} stroke="rgba(73,49,166,.36)" strokeWidth="1.05" />
          <polyline points={`${pt(MARK.B2)} ${pt(MARK.A2)} ${pt(MARK.C2)}`} stroke="rgba(73,49,166,.22)" strokeWidth=".9" />
          <line x1={MARK.A2[0]} y1={MARK.A2[1]} x2={MARK.A1[0]} y2={MARK.A1[1]} stroke="rgba(73,49,166,.28)" strokeWidth=".95" />
          <polyline points={`${pt(MARK.B1)} ${pt(MARK.A1)} ${pt(MARK.C1)}`} stroke="rgba(255,255,255,.82)" strokeWidth="1.05" />
          <line x1={MARK.B2[0]} y1={MARK.B2[1]} x2={MARK.B1[0]} y2={MARK.B1[1]} stroke="rgba(255,255,255,.52)" strokeWidth=".8" />
        </g>
        <line className="spectra-prism-fault" x1={MARK.B1[0]} y1={MARK.B1[1]} x2={MARK.C1[0]} y2={MARK.C1[1]} stroke="var(--danger)" strokeWidth="1.7" strokeLinecap="round" />
      </g>
    </>
  );
}

export function SpectraMark({
  size = 32,
  className,
  style,
  tile = false,
  mono = false,
  title,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  tile?: boolean;
  mono?: boolean;
  title?: string;
}) {
  const rawId = useId();
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={`spectra-mark${className ? ` ${className}` : ""}`}
      style={{ display: "block", flexShrink: 0, ...style }}
    >
      {tile ? (
        <>
          <defs>
            <linearGradient id={`${id}-tile`} x1="4" y1="2" x2="60" y2="62" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#8067e6" />
              <stop offset="1" stopColor="#5137bd" />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="15" fill={`url(#${id}-tile)`} />
        </>
      ) : null}
      {mono ? (
        <g>
          <polygon points={FACE_TOP} fill="currentColor" opacity=".38" />
          <polygon points={FACE_LEFT} fill="currentColor" opacity=".58" />
          <polygon points={FACE_FRONT} fill="currentColor" opacity=".96" />
        </g>
      ) : (
        <PrismCore id={id} size={size} tile={tile} />
      )}
    </svg>
  );
}
