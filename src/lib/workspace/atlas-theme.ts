/* ===================================================================
   Atlas theme — deterministic cartographic color for workspaces.

   Each workspace gets a stable "territory ink" hashed from its name.
   We use a restricted palette that fits the warm-paper ground —
   ochre, moss, lapis, slate, terracotta, wine, sage, umber, inkblue.
   No purple gradients, no neon.

   The palette is intentionally small and semantically cartographic.
   =================================================================== */

export type TerritoryInk = {
  /** For solid dots / pins */
  core: string;
  /** For filled regions */
  fill: string;
  /** For contour lines */
  contour: string;
  /** For label accents */
  accent: string;
  /** For text on fill */
  ink: string;
  /** Identifier for memoization */
  key: string;
};

const PALETTE: TerritoryInk[] = [
  {
    key: "ochre",
    core: "#b67616",
    fill: "rgba(182, 118, 22, 0.09)",
    contour: "rgba(182, 118, 22, 0.28)",
    accent: "rgba(182, 118, 22, 0.55)",
    ink: "#6e4408",
  },
  {
    key: "moss",
    core: "#4b7a3e",
    fill: "rgba(75, 122, 62, 0.085)",
    contour: "rgba(75, 122, 62, 0.26)",
    accent: "rgba(75, 122, 62, 0.55)",
    ink: "#2b4624",
  },
  {
    key: "lapis",
    core: "#2a568c",
    fill: "rgba(42, 86, 140, 0.085)",
    contour: "rgba(42, 86, 140, 0.26)",
    accent: "rgba(42, 86, 140, 0.55)",
    ink: "#16335a",
  },
  {
    key: "terracotta",
    core: "#b54f2a",
    fill: "rgba(181, 79, 42, 0.09)",
    contour: "rgba(181, 79, 42, 0.28)",
    accent: "rgba(181, 79, 42, 0.55)",
    ink: "#6f2a11",
  },
  {
    key: "slate",
    core: "#55606a",
    fill: "rgba(85, 96, 106, 0.08)",
    contour: "rgba(85, 96, 106, 0.24)",
    accent: "rgba(85, 96, 106, 0.52)",
    ink: "#2f3740",
  },
  {
    key: "wine",
    core: "#8a2f4c",
    fill: "rgba(138, 47, 76, 0.08)",
    contour: "rgba(138, 47, 76, 0.26)",
    accent: "rgba(138, 47, 76, 0.52)",
    ink: "#571e30",
  },
  {
    key: "sage",
    core: "#6b8070",
    fill: "rgba(107, 128, 112, 0.08)",
    contour: "rgba(107, 128, 112, 0.24)",
    accent: "rgba(107, 128, 112, 0.52)",
    ink: "#3e4d42",
  },
  {
    key: "umber",
    core: "#7a5a3c",
    fill: "rgba(122, 90, 60, 0.09)",
    contour: "rgba(122, 90, 60, 0.28)",
    accent: "rgba(122, 90, 60, 0.55)",
    ink: "#4a351f",
  },
  {
    key: "inkblue",
    core: "#27465e",
    fill: "rgba(39, 70, 94, 0.08)",
    contour: "rgba(39, 70, 94, 0.26)",
    accent: "rgba(39, 70, 94, 0.55)",
    ink: "#15293c",
  },
];

function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

const inkCache = new Map<string, TerritoryInk>();

export function territoryInk(workspaceId: string, name?: string): TerritoryInk {
  const key = `${workspaceId}:${name ?? ""}`;
  const cached = inkCache.get(key);
  if (cached) return cached;
  const h = djb2(`${workspaceId}|${name ?? "anon"}`);
  const ink = PALETTE[h % PALETTE.length];
  inkCache.set(key, ink);
  return ink;
}

/**
 * Render an SVG contour pattern as a background data URI.
 * Concentric faint rings that reveal territory boundaries at far zoom.
 */
export function contourPatternDataUri(color: string, opacity = 0.25): string {
  // A 240x240 tile with concentric arcs — tiles cleanly as a background
  const stroke = color.replace("rgb(", "rgba(").replace(")", `,${opacity})`);
  const svg = `
<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'>
  <g fill='none' stroke='${stroke}' stroke-width='0.8'>
    <circle cx='120' cy='120' r='40' />
    <circle cx='120' cy='120' r='70' />
    <circle cx='120' cy='120' r='100' />
    <circle cx='120' cy='120' r='130' />
  </g>
</svg>`.trim();
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

/**
 * Latitude-rule divider SVG — used inside cartouche labels and group heads.
 */
export function latitudeRuleDataUri(color: string, opacity = 0.35): string {
  const stroke = color.replace("rgb(", "rgba(").replace(")", `,${opacity})`);
  const svg = `
<svg xmlns='http://www.w3.org/2000/svg' width='24' height='6' viewBox='0 0 24 6'>
  <g stroke='${stroke}' stroke-width='0.6' fill='none'>
    <line x1='0' y1='3' x2='24' y2='3' />
    <line x1='4' y1='1.5' x2='4' y2='4.5' />
    <line x1='12' y1='1.5' x2='12' y2='4.5' />
    <line x1='20' y1='1.5' x2='20' y2='4.5' />
  </g>
</svg>`.trim();
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

/** Plex-mono coordinate badge text for cartouches, e.g. "N 12°·W 08°" */
export function coordinateBadge(workspaceId: string): string {
  const h = djb2(workspaceId);
  const lat = (h % 45) + 10;
  const lon = ((h >> 6) % 75) + 5;
  const nS = h & 1 ? "N" : "S";
  const eW = (h >> 1) & 1 ? "E" : "W";
  return `${nS} ${String(lat).padStart(2, "0")}° · ${eW} ${String(lon).padStart(2, "0")}°`;
}
