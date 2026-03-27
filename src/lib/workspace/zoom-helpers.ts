export type ZoomLevel = "overview" | "summary" | "standard" | "detail";

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function getZoomLevel(cameraZ: number): ZoomLevel {
  if (cameraZ < 0.3) return "overview";
  if (cameraZ < 0.6) return "summary";
  if (cameraZ < 1.0) return "standard";
  return "detail";
}

export function getZoomBreakpoints(cameraZ: number) {
  return {
    titleSize: lerp(10, 18, clamp01((cameraZ - 0.2) / 0.4)),
    descOpacity: clamp01((cameraZ - 0.5) / 0.2),
    artifactListTranslateY: lerp(20, 0, clamp01((cameraZ - 0.55) / 0.15)),
    actionsOpacity: clamp01((cameraZ - 0.9) / 0.2),
    badgeScale: clamp01((cameraZ - 0.25) / 0.15),
    detailPanelOpacity: clamp01((cameraZ - 0.95) / 0.15),
    connectionOpacity: cameraZ < 0.25 ? 0 : clamp01((cameraZ - 0.25) / 0.25),
  };
}

export const WORKSTREAM_COLORS = [
  { name: "Cyan", value: "#0e8ee8", bg: "rgba(14,142,232,0.08)", border: "rgba(14,142,232,0.22)" },
  { name: "Mint", value: "#20b8b2", bg: "rgba(32,184,178,0.08)", border: "rgba(32,184,178,0.22)" },
  { name: "Coral", value: "#ff6f45", bg: "rgba(255,111,69,0.08)", border: "rgba(255,111,69,0.22)" },
  { name: "Amber", value: "#f59f0a", bg: "rgba(245,159,10,0.08)", border: "rgba(245,159,10,0.22)" },
  { name: "Rose", value: "#ec4899", bg: "rgba(236,72,153,0.08)", border: "rgba(236,72,153,0.22)" },
  { name: "Violet", value: "#8b5cf6", bg: "rgba(139,92,246,0.08)", border: "rgba(139,92,246,0.22)" },
  { name: "Emerald", value: "#148f5d", bg: "rgba(20,143,93,0.08)", border: "rgba(20,143,93,0.22)" },
  { name: "Slate", value: "#637083", bg: "rgba(99,112,131,0.08)", border: "rgba(99,112,131,0.22)" },
] as const;

export function getWorkstreamColor(color?: string) {
  return (
    WORKSTREAM_COLORS.find((c) => c.value === color) ?? WORKSTREAM_COLORS[0]
  );
}

export const WORKSTREAM_EMOJIS = [
  "📚", "🧪", "📐", "🌍", "🎨", "🧮", "📝", "🔬",
  "💻", "🎵", "📖", "🏛️", "⚡", "🧬", "🗺️", "🎯",
  "📊", "🔭", "🧠", "✍️", "🎓", "🌱", "🔧", "🚀",
];

export const DEFAULT_WORKSTREAM_SIZE = { w: 280, h: 180 };
// Hub container must accommodate the max circle size (220px) + pulse ring (244px) at standard zoom
export const HUB_SIZE = { w: 260, h: 260 };

export function radialPosition(index: number, total: number, radius: number) {
  const angle = (2 * Math.PI * index) / Math.max(total, 1) - Math.PI / 2;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}
