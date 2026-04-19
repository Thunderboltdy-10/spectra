import type { CSSProperties } from "react";

export type IconName =
  | "note" | "essay" | "pset" | "flashcards" | "thread" | "reading" | "lab"
  | "schedule" | "search" | "sparkle" | "mic" | "send" | "plus" | "close"
  | "check" | "minus" | "chevron" | "zoom-in" | "zoom-out" | "map" | "home"
  | "timer" | "pin" | "tray" | "link" | "compare" | "merge" | "quiz-me"
  | "dots" | "layers" | "filter" | "arrow-rt" | "ellipsis" | "layout"
  | "grid" | "topic" | "timeline" | "widget" | "planner" | "undo"
  | "info" | "collapse" | "expand" | "settings" | "sun" | "moon";

type Props = {
  name: IconName;
  size?: number;
  className?: string;
  stroke?: string;
  style?: CSSProperties;
};

export function Icon({ name, size = 16, className, stroke = "currentColor", style }: Props) {
  const s = size;
  const common = {
    width: s,
    height: s,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke,
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    style,
  };
  switch (name) {
    case "note": return <svg {...common}><path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4"/><path d="M8 12h8M8 16h5"/></svg>;
    case "essay": return <svg {...common}><path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h4"/></svg>;
    case "pset": return <svg {...common}><path d="M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z"/></svg>;
    case "flashcards": return <svg {...common}><rect x="3" y="6" width="14" height="12" rx="2"/><rect x="7" y="3" width="14" height="12" rx="2"/></svg>;
    case "thread": return <svg {...common}><path d="M4 6h16v10H9l-5 4z"/></svg>;
    case "reading": return <svg {...common}><path d="M4 5h7v14H4zM13 5h7v14h-7z"/></svg>;
    case "lab": return <svg {...common}><path d="M9 3h6M10 3v5L5 18a2 2 0 002 3h10a2 2 0 002-3l-5-10V3"/></svg>;
    case "schedule": return <svg {...common}><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>;
    case "search": return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>;
    case "sparkle": return <svg {...common}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M19 16l.8 1.8L21.5 18.6l-1.7.8L19 21l-.8-1.6L16.5 18.6l1.7-.8z"/></svg>;
    case "mic": return <svg {...common}><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>;
    case "send": return <svg {...common}><path d="M5 12l14-7-5 14-3-6-6-1z"/></svg>;
    case "plus": return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
    case "close": return <svg {...common}><path d="M6 6l12 12M18 6L6 18"/></svg>;
    case "check": return <svg {...common}><path d="M5 12l4 4 10-10"/></svg>;
    case "minus": return <svg {...common}><path d="M5 12h14"/></svg>;
    case "chevron": return <svg {...common}><path d="M9 6l6 6-6 6"/></svg>;
    case "zoom-in": return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M20 20l-4-4"/></svg>;
    case "zoom-out": return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="M8 11h6M20 20l-4-4"/></svg>;
    case "map": return <svg {...common}><path d="M9 3l-6 3v15l6-3 6 3 6-3V3l-6 3z"/><path d="M9 3v15M15 6v15"/></svg>;
    case "home": return <svg {...common}><path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1z"/></svg>;
    case "timer": return <svg {...common}><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 3h6"/></svg>;
    case "pin": return <svg {...common}><path d="M12 3l4 4-2 2 3 3-5 1-2 4-1-5-4-2 3-3 2-2z"/></svg>;
    case "tray": return <svg {...common}><path d="M3 13l3-9h12l3 9v6H3zM3 13h6l1 2h4l1-2h6"/></svg>;
    case "link": return <svg {...common}><path d="M10 14a4 4 0 005.6 0l3-3a4 4 0 00-5.6-5.6l-1 1"/><path d="M14 10a4 4 0 00-5.6 0l-3 3a4 4 0 005.6 5.6l1-1"/></svg>;
    case "compare": return <svg {...common}><path d="M4 5h7v14H4zM13 5h7v14h-7z"/></svg>;
    case "merge": return <svg {...common}><path d="M6 4v7c0 2 2 3 3 3h6c1 0 3 1 3 3v3M15 5l3-1 1 3M18 20l3-1-1-3"/></svg>;
    case "quiz-me": return <svg {...common}><path d="M9 9a3 3 0 016 0c0 2-3 2-3 4M12 17v.01"/><circle cx="12" cy="12" r="9"/></svg>;
    case "dots":
    case "ellipsis": return <svg {...common}><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>;
    case "layers": return <svg {...common}><path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 18l9 5 9-5"/></svg>;
    case "filter": return <svg {...common}><path d="M4 5h16l-6 8v6l-4-2v-4z"/></svg>;
    case "arrow-rt": return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6"/></svg>;
    case "layout": return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M10 10v10"/></svg>;
    case "grid": return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
    case "topic": return <svg {...common}><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M8 8l4 7M16 8l-4 7"/></svg>;
    case "timeline": return <svg {...common}><path d="M4 12h16"/><circle cx="7" cy="12" r="1.5"/><circle cx="13" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>;
    case "widget": return <svg {...common}><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="4"/><rect x="3" y="13" width="8" height="8" rx="4"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>;
    case "planner": return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M8 15h3M14 15h3M8 18h3"/></svg>;
    case "undo": return <svg {...common}><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 016 6v2"/></svg>;
    case "info": return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 8v.01M11 12h1v5h1"/></svg>;
    case "collapse": return <svg {...common}><path d="M4 10h6V4M20 14h-6v6M4 10l6-6M14 14l6 6"/></svg>;
    case "expand": return <svg {...common}><path d="M10 4H4v6M14 20h6v-6M4 4l6 6M20 20l-6-6"/></svg>;
    case "settings": return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2l-.3-2.4h-4l-.3 2.4a7 7 0 00-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 002 1.2l.3 2.4h4l.3-2.4a7 7 0 002-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/></svg>;
    case "sun": return <svg {...common}><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>;
    case "moon": return <svg {...common}><path d="M20 14a8 8 0 11-9-10 6 6 0 009 10z"/></svg>;
    default: return <svg {...common}><circle cx="12" cy="12" r="7"/></svg>;
  }
}
