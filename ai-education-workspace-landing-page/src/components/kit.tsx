import { forwardRef, type CSSProperties, type ReactNode } from "react";

/* ============================================================
   PRISM MARK — the hero geometry, derived as a light 2D form
   for interface use. Same triangle, same optical logic, no
   second WebGL context.
   ============================================================ */

export type PrismState = "idle" | "work" | "wait" | "done" | "fail";

const STATE_COLOR: Record<PrismState, string> = {
  idle: "rgba(236,230,218,0.55)",
  work: "#e0ad63",
  wait: "#e08d80",
  done: "#7cc9b4",
  fail: "#e08d80",
};

export function PrismMark({
  size = 20,
  state = "idle",
  className = "",
  style,
}: {
  size?: number;
  state?: PrismState;
  className?: string;
  style?: CSSProperties;
}) {
  const c = STATE_COLOR[state];
  const active = state === "work";
  const id = `pm${size}${state}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}a`} x1="4" y1="20" x2="20" y2="4" gradientUnits="userSpaceOnUse">
          <stop stopColor={c} stopOpacity="0.95" />
          <stop offset="0.5" stopColor={c} stopOpacity="0.35" />
          <stop offset="1" stopColor={c} stopOpacity="0.9" />
        </linearGradient>
      </defs>
      {/* body */}
      <path d="M12 2.6 21.4 20.4H2.6Z" stroke={`url(#${id}a)`} strokeWidth="1.05" strokeLinejoin="round" />
      {/* internal facet */}
      <path d="M12 2.6 12 20.4M12 20.4 21.4 20.4" stroke={c} strokeOpacity="0.2" strokeWidth="0.8" />
      <path d="M6.6 15.6 17.4 15.6" stroke={c} strokeOpacity="0.28" strokeWidth="0.8" />
      {active && (
        <g>
          <path d="M0 13 8.2 13" stroke="rgba(236,230,218,0.75)" strokeWidth="1" strokeDasharray="3 3">
            <animate attributeName="stroke-dashoffset" from="6" to="0" dur="0.7s" repeatCount="indefinite" />
          </path>
          <path d="M15.4 11.4 24 9.4" stroke="#e0ad63" strokeWidth="0.9" opacity="0.95" />
          <path d="M15.8 13.2 24 13" stroke="#7cc9b4" strokeWidth="0.9" opacity="0.85" />
          <path d="M16.2 15 24 16.8" stroke="#e08d80" strokeWidth="0.9" opacity="0.75" />
        </g>
      )}
    </svg>
  );
}

/** Wordmark: prism + type */
export function Logo({ size = 18, muted = false }: { size?: number; muted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <PrismMark size={size} state={muted ? "idle" : "work"} />
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: size * 1.05,
          letterSpacing: "0.01em",
          color: "var(--paper)",
          lineHeight: 1,
        }}
      >
        Verso
      </span>
    </span>
  );
}

/* ============================================================
   CURSORS
   ============================================================ */

export type CursorKind = "human" | "fellow";

export const Cursor = forwardRef<
  HTMLDivElement,
  { name: string; color: string; kind?: CursorKind; className?: string; style?: CSSProperties }
>(function Cursor({ name, color, kind = "human", className = "", style }, ref) {
  return (
    <div
      ref={ref}
      className={`pointer-events-none absolute top-0 left-0 z-40 ${className}`}
      style={{ willChange: "transform, opacity", ...style }}
      aria-hidden="true"
    >
      {kind === "human" ? (
        <svg width="16" height="19" viewBox="0 0 16 19" fill="none">
          <path
            d="M1.2 1.1 13.4 10.2 7.6 11.1 5.1 17.2Z"
            fill={color}
            stroke="rgba(8,9,8,0.55)"
            strokeWidth="0.9"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="18" height="20" viewBox="0 0 18 20" fill="none">
          <path d="M2 1 16 10.5 6.5 12.5 4.5 18.5Z" fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M4.6 4.2 11.4 9.1 6.9 10.1Z" fill={color} fillOpacity="0.5" />
        </svg>
      )}
      <span className="cursor-label" style={{ background: color }}>
        {name}
      </span>
    </div>
  );
});

/* ============================================================
   ICONS — 14px stroke set
   ============================================================ */

const ic = { fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const p: Record<string, ReactNode> = {
    doc: (
      <>
        <path d="M3.5 1.5h5L12 5v7.5H3.5z" {...ic} />
        <path d="M8.2 1.7V5h3.4M5.6 8h4.4M5.6 10h3" {...ic} />
      </>
    ),
    thread: (
      <>
        <path d="M2 3.4h11v6.2H7.4L4.6 12V9.6H2z" {...ic} />
        <path d="M4.6 6.4h5.8" {...ic} />
      </>
    ),
    plan: (
      <>
        <rect x="2" y="3" width="11" height="9.5" rx="1.4" {...ic} />
        <path d="M2 6h11M5 2v2.4M10 2v2.4M4.6 8.6h3M4.6 10.6h5" {...ic} />
      </>
    ),
    source: (
      <>
        <path d="M2.6 2.4h4.2c1 0 1.6.6 1.6 1.5v8.3c0-.8-.6-1.3-1.6-1.3H2.6z" {...ic} />
        <path d="M12.9 2.4H8.7c-1 0-1.3.6-1.3 1.5v8.3c0-.8.3-1.3 1.3-1.3h4.2z" {...ic} />
      </>
    ),
    board: (
      <>
        <rect x="2" y="2.6" width="11" height="9.8" rx="1.4" {...ic} />
        <path d="M6.4 2.6v9.8M6.4 7.4H13" {...ic} />
      </>
    ),
    search: (
      <>
        <circle cx="6.8" cy="6.8" r="4.2" {...ic} />
        <path d="M10 10 13 13" {...ic} />
      </>
    ),
    check: <path d="M3 8.2 6.2 11.2 12 4.6" {...ic} />,
    x: <path d="M4 4l7 7M11 4l-7 7" {...ic} />,
    plus: <path d="M7.5 3v9M3 7.5h9" {...ic} />,
    clock: (
      <>
        <circle cx="7.5" cy="7.5" r="5.2" {...ic} />
        <path d="M7.5 4.4v3.3l2.2 1.3" {...ic} />
      </>
    ),
    link: (
      <>
        <path d="M6.4 8.9a2.6 2.6 0 0 0 3.8.3l1.7-1.7a2.6 2.6 0 0 0-3.7-3.7L7.3 4.7" {...ic} />
        <path d="M8.6 6.1a2.6 2.6 0 0 0-3.8-.3L3.1 7.5a2.6 2.6 0 0 0 3.7 3.7l.9-.9" {...ic} />
      </>
    ),
    arrow: <path d="M3 7.5h9M8.6 4l3.6 3.5-3.6 3.5" {...ic} />,
    people: (
      <>
        <circle cx="6" cy="5.6" r="2.2" {...ic} />
        <path d="M2.4 12.4c.3-2 1.8-3.1 3.6-3.1s3.3 1.1 3.6 3.1" {...ic} />
        <path d="M10.4 4.1a2.1 2.1 0 0 1 .3 4M11.6 9.6c1.2.3 2 1.3 2.2 2.8" {...ic} />
      </>
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 15 15" aria-hidden="true" style={{ flex: "none" }}>
      {p[name]}
    </svg>
  );
}

/* ============================================================
   PRODUCT PRIMITIVES
   ============================================================ */

export function Avatar({ initials, color }: { initials: string; color: string }) {
  return (
    <span className="avatar" style={{ background: color }}>
      {initials}
    </span>
  );
}

export function Label({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span className="label" style={style}>
      {children}
    </span>
  );
}

export function Chip({
  children,
  tone = "",
  icon,
}: {
  children: ReactNode;
  tone?: "" | "amber" | "sea" | "rose";
  icon?: ReactNode;
}) {
  return (
    <span className={`chip ${tone ? `chip-${tone}` : ""}`}>
      {icon}
      {children}
    </span>
  );
}

export function Cite({ children }: { children: ReactNode }) {
  return (
    <span className="cite">
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
        <path d="M4 .8 7.4 7.2H.6Z" fill="currentColor" fillOpacity="0.65" />
      </svg>
      {children}
    </span>
  );
}

/** Document card header: title + breadcrumbs, used across the product */
export function DocHead({
  kind,
  title,
  meta,
  right,
}: {
  kind: string;
  title: string;
  meta?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2" style={{ color: "var(--paper-3)" }}>
          <Icon name={kind} size={13} />
          <span className="label">{meta}</span>
        </div>
        <div
          className="mt-1.5 truncate"
          style={{ fontFamily: "var(--font-display)", fontSize: 21, letterSpacing: "-0.01em" }}
        >
          {title}
        </div>
      </div>
      {right}
    </div>
  );
}

export const PEOPLE = {
  naima: { name: "Naima O.", initials: "NO", color: "#e0ad63" },
  maya: { name: "Maya R.", initials: "MR", color: "#7cc9b4" },
  tobias: { name: "Dr. Adeyemi", initials: "DA", color: "#a79ad6" },
  fellow: { name: "Source Fellow", initials: "SF", color: "#e08d80" },
  method: { name: "Method Fellow", initials: "MF", color: "#8fb2e0" },
};
