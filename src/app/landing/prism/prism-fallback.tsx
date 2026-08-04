/**
 * Static prism: the no-WebGL / reduced-motion renderer and the first-paint
 * base layer. It composes deterministically from the same narrative progress
 * that drives the WebGL engine, so the story is identical on every renderer:
 * dormant glass → six wavelengths making contact → energy gathering inside
 * → one coherent output (Phase 15.7).
 */

const WAVELENGTHS = [
  "#ff5f7e",
  "#ffa63f",
  "#ffe066",
  "#48dfa8",
  "#4fa8ff",
  "#9a7cff",
];

function band(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function PrismFallback({
  progress = 0.1,
  className,
}: {
  progress?: number;
  className?: string;
}) {
  const p = Math.min(1, Math.max(0, progress));
  const contact = band(0.05, 0.22, p);
  const interior = band(0.38, 0.62, p) * (1 - band(0.82, 0.92, p) * 0.35);
  const output = band(0.84, 0.95, p);

  // Six contact points arranged around the glass, matched to the engine's
  // anchor layout (three high, three low, alternating sides).
  const contacts: Array<[number, number]> = [
    [452, 205],
    [600, 218],
    [436, 258],
    [610, 270],
    [505, 314],
    [556, 322],
  ];

  return (
    <svg
      viewBox="0 0 900 520"
      role="presentation"
      aria-hidden="true"
      className={className}
      style={{ display: "block", width: "100%", height: "100%" }}
    >
      <defs>
        <radialGradient id="pf-core" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#e8e2ff" stopOpacity="0.9" />
          <stop offset="0.55" stopColor="#a48ffb" stopOpacity="0.28" />
          <stop offset="1" stopColor="#a48ffb" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pf-beam-out" x1="0" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#fffaf0" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fffaf0" stopOpacity="0" />
        </linearGradient>
        <filter id="pf-soft" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id="pf-wide" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
      </defs>

      {/* faint ground pool */}
      <ellipse
        cx="520"
        cy="392"
        rx="190"
        ry="26"
        fill="url(#pf-core)"
        opacity={0.4 + contact * 0.3 + output * 0.2}
        filter="url(#pf-wide)"
      />

      {/* incoming wavelengths, fading in as they make contact */}
      {contacts.map(([x, y], i) => {
        const fromX = x < 520 ? x - 320 : x + 320;
        const fromY =
          y + (x < 520 ? (i % 2 === 0 ? 60 : 40) : -(i % 2 === 0 ? 50 : 30));
        const local = Math.min(1, Math.max(0, contact * 1.6 - i * 0.1));
        return (
          <g key={WAVELENGTHS[i]} opacity={local}>
            <line
              x1={fromX}
              y1={fromY}
              x2={x}
              y2={y}
              stroke={WAVELENGTHS[i]}
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeOpacity="0.8"
              filter="url(#pf-soft)"
            />
            <circle
              cx={x}
              cy={y}
              r="4.5"
              fill={WAVELENGTHS[i]}
              filter="url(#pf-soft)"
            />
          </g>
        );
      })}

      {/* interior living energy */}
      <circle
        cx="522"
        cy="262"
        r="150"
        fill="url(#pf-core)"
        opacity={interior * 0.85}
        filter="url(#pf-wide)"
      />

      {/* the glass itself */}
      <polygon
        points="530,140 410,340 650,340"
        fill="rgba(196,186,255,0.10)"
        stroke="rgba(226,220,255,0.55)"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />

      {/* coherent output beam */}
      <g opacity={output}>
        <line
          x1="545"
          y1="330"
          x2="700"
          y2="470"
          stroke="url(#pf-beam-out)"
          strokeWidth="6"
          strokeLinecap="round"
          filter="url(#pf-soft)"
        />
        <circle
          cx="545"
          cy="330"
          r="10"
          fill="#fffaf0"
          filter="url(#pf-soft)"
        />
      </g>
    </svg>
  );
}
