import { useId } from "react";

/**
 * The Spectra mark — a 2D upright triangular prism in three-quarter front
 * view. Rotated ~27° around its vertical axis: the large triangular front
 * face stays dominant while the long rectangular face on the left recedes
 * backward; the right edge projects slightly toward the viewer. Seen from a
 * mildly elevated angle (~8°): the top ridge runs diagonally back toward the
 * upper left and the broad base runs diagonally from lower left to lower
 * right. Almost no roll.
 *
 * Pure inline SVG — no assets, crisp at every size, themeable through props.
 * Coordinates are derived once (below) so the SVG and canvas (favicon)
 * renderers always agree.
 */
export const MARK = {
  /** Apex of the near (front-right) triangular face / start of top ridge. */
  A1: [45, 16.2] as const,
  B1: [35, 44.5] as const,
  C1: [55, 44.5] as const,
  /** Back (far) triangle, translated up-left: body recedes to the left. */
  A2: [18.8, 11.5] as const,
  B2: [8.7, 39.9] as const,
  C2: [28.8, 39.9] as const,
} as const;

const pt = (p: readonly [number, number]) => `${p[0]},${p[1]}`;

/** Front (dominant) triangular face. */
export const FACE_FRONT = `${pt(MARK.A1)} ${pt(MARK.B1)} ${pt(MARK.C1)}`;
/** Long rectangular face on the viewer's left (receding). */
export const FACE_LEFT = `${pt(MARK.A1)} ${pt(MARK.B1)} ${pt(MARK.B2)} ${pt(
  MARK.A2,
)}`;
/** Upper-right sloped face between the top ridge and the right edge. */
export const FACE_TOP = `${pt(MARK.A1)} ${pt(MARK.C1)} ${pt(MARK.C2)} ${pt(
  MARK.A2,
)}`;

export type MarkColors = {
  /** Brand violet, e.g. --brand-primary. */
  primary: string;
  /** Cool dispersion accent, e.g. --accent-cyan. */
  accent: string;
};

const DEFAULT_COLORS: MarkColors = { primary: "#7b5cf5", accent: "var(--accent-cyan)" };

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
  /** Render inside a rounded gradient tile (app-icon contexts). */
  tile?: boolean;
  /** Single-color glyph: faces inherit currentColor at stepped opacities. */
  mono?: boolean;
  title?: string;
}) {
  const rawId = useId();
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const { primary, accent } = DEFAULT_COLORS;

  if (mono) {
    return (
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        role={title ? "img" : "presentation"}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        className={className}
        style={{ display: "block", flexShrink: 0, ...style }}
      >
        <polygon points={FACE_TOP} fill="currentColor" opacity="0.38" />
        <polygon points={FACE_LEFT} fill="currentColor" opacity="0.58" />
        <polygon points={FACE_FRONT} fill="currentColor" opacity="0.96" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={className}
      style={{ display: "block", flexShrink: 0, ...style }}
    >
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
          <stop offset="1" stopColor={primary} />
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
        <linearGradient
          id={`${id}-disp`}
          gradientUnits="userSpaceOnUse"
          x1={MARK.B1[0]}
          y1={MARK.B1[1]}
          x2={MARK.C1[0]}
          y2={MARK.C1[1]}
        >
          <stop offset="0" stopColor={primary} />
          <stop offset="1" stopColor={accent} />
        </linearGradient>
        {tile ? (
          <linearGradient
            id={`${id}-tile`}
            x1="0"
            y1="0"
            x2="64"
            y2="64"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#8a6df7" />
            <stop offset="1" stopColor="#5f3fe0" />
          </linearGradient>
        ) : null}
      </defs>

      {tile ? (
        <rect width="64" height="64" rx="15" fill={`url(#${id}-tile)`} />
      ) : null}

      {/* receding body faces first, dominant front face last */}
      <polygon points={FACE_TOP} fill={`url(#${id}-top)`} />
      <polygon points={FACE_LEFT} fill={`url(#${id}-left)`} />
      <polygon points={FACE_FRONT} fill={`url(#${id}-front)`} />

      {/* dispersion accent along the front base edge */}
      <line
        x1={MARK.B1[0]}
        y1={MARK.B1[1]}
        x2={MARK.C1[0]}
        y2={MARK.C1[1]}
        stroke={`url(#${id}-disp)`}
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.55"
      />

      {/* glass edges */}
      <g
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeWidth="1.15"
      >
        <polygon
          points={FACE_FRONT}
          stroke="rgba(76,52,186,0.34)"
          strokeWidth="1.3"
        />
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
    </svg>
  );
}
