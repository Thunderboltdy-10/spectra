import type { ReactNode } from "react";

/*
 * Spectra's glyphs (docs/design/ICONS.md), on a 20 px grid with 2 px of
 * padding. Each glyph has up to three layers:
 *
 *   ink    – the 1.5 px line in currentColor (the <svg>'s default stroke);
 *   paper  – soft planes in currentColor at about 10%, for volume;
 *   accent – one small detail that carries the meaning, in --icon-accent.
 *
 * Parts that animate carry an `sg-*` class; spectra-icons.css moves them.
 */

export type GlyphRefs = {
  /** The id of the spectrum gradient, for Spectra's own details. */
  spectrum: string;
  /** A unique id prefix for clip paths. */
  id: string;
};

type Glyph = (refs: GlyphRefs) => ReactNode;

const ACCENT = "var(--icon-accent, currentColor)";

/** A soft plane: the paper layer. */
const Paper = ({ d, opacity = 0.1 }: { d: string; opacity?: number }) => <path d={d} fill="currentColor" fillOpacity={opacity} stroke="none" />;
/** A plane with its ink outline. */
const Sheet = ({ d }: { d: string }) => (
  <>
    <Paper d={d} />
    <path d={d} />
  </>
);
/** A fine inner line: detail reads lighter than the outline. */
const Fine = ({ d, opacity = 1 }: { d: string; opacity?: number }) => <path d={d} strokeWidth={1.25} strokeOpacity={opacity} />;
const AccentFill = ({ d, opacity = 1, className }: { d: string; opacity?: number; className?: string }) => (
  <path d={d} fill={ACCENT} fillOpacity={opacity} stroke="none" className={className} />
);
const AccentLine = ({ d, width = 1.5, className }: { d: string; width?: number; className?: string }) => (
  <path d={d} stroke={ACCENT} strokeWidth={width} className={className} />
);

/** Rounded rectangle as a path, so it can be a paper plane and an outline at once. */
function box(x: number, y: number, w: number, h: number, r: number) {
  return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1 -${r} -${r}v-${h - 2 * r}a${r} ${r} 0 0 1 ${r} -${r}z`;
}

const PAGE = "M5.25 2.75h6.6l3.4 3.4v10.1a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1z";
const FOLD = "M11.85 2.75v2.6a.8.8 0 0 0 .8.8h2.6";
const CLOUD = "M6.1 15.25a3.4 3.4 0 0 1-.55-6.75 4.6 4.6 0 0 1 8.85-1.05 3.9 3.9 0 0 1 .35 7.8z";

/* ------------------------------------------------------------ artifact types */

const page: Glyph = () => (
  <>
    <Sheet d={PAGE} />
    <path d={FOLD} className="sg-fold" />
    <AccentFill d={box(6.6, 7.9, 5.4, 1.7, 0.85)} />
    <Fine d="M6.75 11.75h6.35M6.75 14.4h4.1" />
  </>
);

const slides: Glyph = () => (
  <>
    <path d="M5.6 4.25h9.4a1.75 1.75 0 0 1 1.75 1.75v7" strokeOpacity={0.55} className="sg-peek" />
    <Sheet d={box(2.75, 6.5, 12.5, 9.25, 1.6)} />
    <AccentFill d={box(4.6, 8.55, 5.2, 1.6, 0.8)} />
    <Fine d="M4.75 12.9h3.4" />
    <Paper d={box(10.1, 10.9, 3.4, 3, 0.6)} opacity={0.32} />
  </>
);

const sheet: Glyph = () => (
  <>
    <Paper d="M3 7.25V5a1.5 1.5 0 0 1 1.5-1.5h11A1.5 1.5 0 0 1 17 5v2.25z" opacity={0.12} />
    <Sheet d={box(3, 3.5, 14, 13, 1.75)} />
    <Fine d="M3 7.25h14M3 11.75h14M7.75 3.5v13M12.25 3.5v13" opacity={0.7} />
    <AccentFill d={box(7.75, 7.25, 4.5, 4.5, 0.4)} opacity={0.2} />
    <path d={box(7.75, 7.25, 4.5, 4.5, 0.4)} stroke={ACCENT} />
  </>
);

const quiz: Glyph = () => (
  <>
    <Sheet d={box(3, 2.75, 14, 14.5, 2.2)} />
    <Fine d="M6 6.1h8" />
    <path d={box(5.5, 8.4, 9, 3, 1.5)} strokeWidth={1.25} />
    <AccentFill d={box(5.5, 12.5, 9, 3.1, 1.55)} opacity={0.2} />
    <path d={box(5.5, 12.5, 9, 3.1, 1.55)} stroke={ACCENT} strokeWidth={1.25} />
    <AccentLine d="M7.15 14.05l.95.95 1.75-1.85" width={1.35} className="sg-tick" />
  </>
);

const flashcards: Glyph = () => (
  <>
    <path d="M6.9 7.5V5a1.5 1.5 0 0 1 1.5-1.5h7.35a1.5 1.5 0 0 1 1.5 1.5v6.1a1.5 1.5 0 0 1-1.5 1.5h-1.25" strokeOpacity={0.6} className="sg-peek" />
    <Sheet d={box(2.75, 7.5, 11.75, 9.25, 1.6)} />
    <AccentLine d="M10.45 13.6a2.35 2.35 0 1 1-.55-2.75" width={1.35} />
    <AccentLine d="M10.25 9.55l-.3 1.35 1.35.3" width={1.35} />
  </>
);

const whiteboard: Glyph = () => (
  <>
    <Sheet d={box(2.75, 3.25, 14.5, 12.25, 2)} />
    <AccentFill d={box(4.6, 5.1, 4.4, 4.4, 0.8)} />
    <path d="M9 7.3c2.9-.05 4.25 1.15 4.25 2.5" strokeWidth={1.25} />
    <circle cx={13.25} cy={11.75} r={1.85} fill="currentColor" fillOpacity={0.1} />
    <path d="M6.5 17.25l1-1.75M13.5 17.25l-1-1.75" strokeOpacity={0.7} />
  </>
);

const code: Glyph = () => (
  <>
    <Sheet d={box(2.75, 3.5, 14.5, 13, 2)} />
    <Fine d="M2.75 6.75h14.5" opacity={0.7} />
    <Fine d="M7.55 9.1c-.95 0-1.15.45-1.15 1.15v.6c0 .5-.3.85-.85.85.55 0 .85.35.85.85v.6c0 .7.2 1.15 1.15 1.15" />
    <Fine d="M12.45 9.1c.95 0 1.15.45 1.15 1.15v.6c0 .5.3.85.85.85-.55 0-.85.35-.85.85v.6c0 .7-.2 1.15-1.15 1.15" />
    <AccentLine d="M10 9.9v4.4" className="sg-caret" />
  </>
);

const task: Glyph = () => (
  <>
    <Sheet d={box(2.75, 5, 10.75, 10.75, 2.6)} />
    <AccentLine d="M5.7 10.4l2.25 2.25 4.4-4.75" width={1.75} className="sg-tick" />
    <path d="M15.6 17.25V3.25" />
    <Paper d="M15.6 3.5h2.15l-.75 1.45.75 1.45H15.6z" opacity={0.35} />
    <path d="M15.6 3.5h2.15l-.75 1.45.75 1.45H15.6" strokeWidth={1.25} />
  </>
);

const timetable: Glyph = () => (
  <>
    <Sheet d={box(2.75, 3.25, 14.5, 13.5, 2)} />
    <Fine d="M2.75 6.75h14.5" />
    <Fine d="M7.6 6.75v10M12.4 6.75v10" opacity={0.45} />
    <AccentFill d={box(8.7, 8, 2.6, 6.9, 0.7)} />
    <Paper d={box(3.9, 8, 2.6, 3.2, 0.7)} opacity={0.4} />
    <Paper d={box(13.5, 10.4, 2.6, 3.6, 0.7)} opacity={0.4} />
  </>
);

const pdf: Glyph = () => (
  <>
    <Sheet d={PAGE} />
    <path d={FOLD} className="sg-fold" />
    <Fine d="M7 7.75h3.5" />
    <AccentFill d={box(2, 10.6, 9.6, 3.9, 1)} />
    <path d="M3.9 12.55h1.1M6.4 12.55h1.1M8.9 12.55h1.1" stroke="var(--bg-elevated, white)" strokeWidth={1.2} />
  </>
);

const folder: Glyph = () => (
  <>
    <path d="M2.75 7V4.75a1.5 1.5 0 0 1 1.5-1.5h3.35l1.6 1.75h6.55a1.5 1.5 0 0 1 1.5 1.5V7" />
    <AccentLine d="M6 7V6a.8.8 0 0 1 .8-.8h6.4a.8.8 0 0 1 .8.8v1" width={1.25} className="sg-peek" />
    <Sheet d="M4 7h12a1.25 1.25 0 0 1 1.25 1.25v7.25a1.5 1.5 0 0 1-1.5 1.5H4.25a1.5 1.5 0 0 1-1.5-1.5V8.25A1.25 1.25 0 0 1 4 7z" />
  </>
);

const agent: Glyph = ({ spectrum }) => (
  <>
    <Sheet d={box(3.75, 3.75, 12.5, 11, 3.6)} />
    <path d={box(6.25, 8, 7.5, 2.5, 1.25)} fill={`url(#${spectrum})`} stroke="none" className="sg-visor" />
    <path d="M8 17.25h4" />
  </>
);

const conversations: Glyph = () => (
  <>
    <path d="M7.1 6.75V5.25A2.25 2.25 0 0 1 9.35 3h5.9a2.25 2.25 0 0 1 2.25 2.25v3.4a2.25 2.25 0 0 1-2.25 2.25h-.25v1.6l-1.8-1.6" strokeOpacity={0.6} />
    <Sheet d="M4.75 7h6.5a2.25 2.25 0 0 1 2.25 2.25v3.4a2.25 2.25 0 0 1-2.25 2.25H7.6l-2.85 2.3v-2.3A2.25 2.25 0 0 1 2.5 12.65v-3.4A2.25 2.25 0 0 1 4.75 7z" />
    <g fill={ACCENT} stroke="none" className="sg-typing">
      <circle cx={5.4} cy={10.95} r={0.85} />
      <circle cx={8} cy={10.95} r={0.85} />
      <circle cx={10.6} cy={10.95} r={0.85} />
    </g>
  </>
);

/* ------------------------------------------------------------ navigation */

const home: Glyph = () => (
  <>
    <Sheet d="M3.25 9.1 10 3.4l6.75 5.7V16a1.25 1.25 0 0 1-1.25 1.25h-11A1.25 1.25 0 0 1 3.25 16z" />
    <AccentFill d={box(8.35, 10, 3.3, 3.3, 0.6)} className="sg-window" />
  </>
);

const library: Glyph = () => (
  <>
    <Sheet d={box(3.25, 5.25, 3, 11.25, 0.7)} />
    <Sheet d={box(7.25, 3.5, 3.1, 13, 0.7)} />
    <AccentLine d="M7.25 6.6h3.1" width={1.25} />
    <g transform="rotate(11 14.6 16.5)" className="sg-lean">
      <Sheet d={box(11.6, 5.25, 3, 11.25, 0.7)} />
    </g>
    <path d="M2.5 17.25h15" />
  </>
);

const calendar: Glyph = () => (
  <>
    <Sheet d={box(2.75, 4, 14.5, 13.25, 2.2)} />
    <path d="M2.75 8h14.5" />
    <path d="M7 2.5v3M13 2.5v3" />
    <circle cx={6.4} cy={13} r={0.8} fill="currentColor" stroke="none" fillOpacity={0.5} />
    <circle cx={9.2} cy={13} r={0.8} fill="currentColor" stroke="none" fillOpacity={0.5} />
    <AccentFill d={box(11.4, 11.45, 3.1, 3.1, 0.7)} className="sg-today" />
  </>
);

const school: Glyph = () => (
  <>
    <Sheet d="M2.75 9 10 5.25 17.25 9z" />
    <path d="M10 5.25V2.25" />
    <AccentFill d="M10 2.3h2.7l-.7 1.05.7 1.05H10z" className="sg-flag" />
    <Fine d="M5 10.75v4.85M8.35 10.75v4.85M11.65 10.75v4.85M15 10.75v4.85" />
    <path d="M2.75 17.25h14.5" />
  </>
);

const agents: Glyph = ({ spectrum }) => (
  <>
    <path d="M9.6 6.6V5.9a2.4 2.4 0 0 1 2.4-2.4h3.1a2.4 2.4 0 0 1 2.4 2.4v2.2a2.4 2.4 0 0 1-2.4 2.4h-1.85" strokeOpacity={0.6} />
    <Sheet d={box(2.75, 7, 10, 9, 2.8)} />
    <path d={box(4.6, 10.25, 6.3, 2, 1)} fill={`url(#${spectrum})`} stroke="none" className="sg-visor" />
  </>
);

const devices: Glyph = () => (
  <>
    <Sheet d={box(3.5, 7.25, 10, 6.75, 1.2)} />
    <path d="M2.25 16.25h13" />
    <Sheet d="M13.6 6.4h3a1.55 1.55 0 0 0 .1-3.1 2.1 2.1 0 0 0-4-.35 1.75 1.75 0 0 0 .9 3.45z" />
    <AccentLine d="M10.4 7.25c.3-1.35 1.05-2.2 2.2-2.55" width={1.25} className="sg-link" />
  </>
);

const settings: Glyph = () => (
  <>
    <path d="M3.25 5.5h1.95M8.8 5.5h7.95M3.25 10h7.45M14.3 10h2.45M3.25 14.5h3.95M10.8 14.5h5.95" />
    <circle cx={7} cy={5.5} r={1.8} fill="currentColor" fillOpacity={0.1} className="sg-knob-a" />
    <circle cx={12.5} cy={10} r={1.8} fill={ACCENT} stroke={ACCENT} className="sg-knob-b" />
    <circle cx={9} cy={14.5} r={1.8} fill="currentColor" fillOpacity={0.1} className="sg-knob-c" />
  </>
);

/* ------------------------------------------------------------ status */

const saved: Glyph = () => (
  <>
    <Sheet d={CLOUD} />
    <AccentLine d="M7.85 11.4l1.55 1.55 2.9-3.05" className="sg-tick" />
  </>
);

const saving: Glyph = ({ id }) => (
  <>
    <clipPath id={`${id}-cloud`}>
      <path d={CLOUD} />
    </clipPath>
    <g clipPath={`url(#${id}-cloud)`}>
      <AccentFill d="M2 11h16v6H2z" opacity={0.45} className="sg-rise" />
    </g>
    <path d={CLOUD} />
  </>
);

const offline: Glyph = () => (
  <>
    <Sheet d={CLOUD} />
    <AccentLine d="M3.75 3.75l12.5 12.5" />
  </>
);

const syncing: Glyph = () => (
  <>
    <Sheet d={box(6.4, 7.75, 7.2, 4.75, 0.8)} />
    <Fine d="M5.6 14.1h8.8" />
    <g className="sg-spin">
      <AccentLine d="M3.4 8.6a6.9 6.9 0 0 1 11.5-4.05" />
      <AccentLine d="M15.55 2.5l-.55 2.2-2.2-.5" />
      <AccentLine d="M16.6 11.4a6.9 6.9 0 0 1-11.5 4.05" />
      <AccentLine d="M4.45 17.5l.55-2.2 2.2.5" />
    </g>
  </>
);

const locked: Glyph = () => (
  <>
    <Paper d={PAGE} />
    <path d="M12.75 9.25V6.15l-3.4-3.4h-4.1a1 1 0 0 0-1 1v12.5a1 1 0 0 0 1 1H8.6" />
    <Fine d="M6.6 7.5h3.2M6.6 10.25h2.7" />
    <AccentFill d={box(10.25, 12, 6.5, 5.25, 1.2)} />
    <AccentLine d="M11.85 12v-1.35a1.65 1.65 0 0 1 3.3 0V12" width={1.35} className="sg-shackle" />
  </>
);

const readOnly: Glyph = () => (
  <>
    <Sheet d={box(4.5, 8.75, 11, 8.5, 2)} />
    <path d="M6.9 8.75V6.6a3.1 3.1 0 0 1 6.2 0v2.15" className="sg-shackle" />
    <AccentLine d="M7.05 13c1.65-2.1 4.25-2.1 5.9 0-1.65 2.1-4.25 2.1-5.9 0z" width={1.2} />
    <circle cx={10} cy={13} r={0.85} fill={ACCENT} stroke="none" />
  </>
);

const versions: Glyph = () => (
  <>
    <path d="M10 17.25v-5.5" />
    <path d="M10 11.75c0-3.1-4.25-3.6-4.25-6.5M10 11.75c0-3.1 4.25-3.6 4.25-6.5" />
    <circle cx={5.75} cy={4} r={1.6} fill="currentColor" fillOpacity={0.1} />
    <circle cx={14.25} cy={4} r={1.6} fill={ACCENT} stroke={ACCENT} />
  </>
);

const problem: Glyph = () => (
  <>
    <Sheet d="M8.6 3.7a1.6 1.6 0 0 1 2.8 0l5.9 10.45a1.6 1.6 0 0 1-1.4 2.4H4.1a1.6 1.6 0 0 1-1.4-2.4z" />
    <AccentLine d="M10 7.9v3.35" width={1.75} />
    <circle cx={10} cy={13.75} r={0.95} fill={ACCENT} stroke="none" />
  </>
);

const info: Glyph = () => (
  <>
    <circle cx={10} cy={10} r={7.25} fill="currentColor" fillOpacity={0.1} />
    <circle cx={10} cy={10} r={7.25} />
    <AccentLine d="M10 9.1v4.6" width={1.75} />
    <circle cx={10} cy={6.55} r={0.95} fill={ACCENT} stroke="none" />
  </>
);

const done: Glyph = () => (
  <>
    <circle cx={10} cy={10} r={7.25} fill="currentColor" fillOpacity={0.1} />
    <circle cx={10} cy={10} r={7.25} />
    <AccentLine d="M6.75 10.2l2.2 2.2 4.3-4.6" width={1.75} className="sg-tick" />
  </>
);

/* ------------------------------------------------------------ actions */

const add: Glyph = () => <path d="M10 4.25v11.5M4.25 10h11.5" />;

const share: Glyph = () => (
  <>
    <Sheet d="M7.25 7.25h-1.5a1.5 1.5 0 0 0-1.5 1.5v6.5a1.5 1.5 0 0 0 1.5 1.5h8.5a1.5 1.5 0 0 0 1.5-1.5v-6.5a1.5 1.5 0 0 0-1.5-1.5h-1.5" />
    <g className="sg-lift">
      <path d="M10 12V2.75" />
      <AccentLine d="M7.1 5.6 10 2.75l2.9 2.85" />
    </g>
  </>
);

const filter: Glyph = () => <Sheet d="M3.25 4.25h13.5l-5.1 6.1v5.15l-3.3-1.6v-3.55z" />;

const sort: Glyph = () => (
  <>
    <path d="M6.5 3.75v12.5M3.75 13.5l2.75 2.75 2.75-2.75" />
    <path d="M13.5 16.25V3.75M10.75 6.5l2.75-2.75 2.75 2.75" />
  </>
);

const search: Glyph = () => (
  <>
    <circle cx={8.75} cy={8.75} r={5} fill="currentColor" fillOpacity={0.1} />
    <circle cx={8.75} cy={8.75} r={5} />
    <path d="M12.5 12.5l4.25 4.25" />
    <Fine d="M6.55 7.35a2.5 2.5 0 0 1 1.7-1.7" opacity={0.55} />
  </>
);

const attach: Glyph = () => (
  <path d="M15.5 9.25 10.2 14.55a3.25 3.25 0 0 1-4.6-4.6l5.6-5.6a2.1 2.1 0 0 1 3 3l-5.5 5.5a1 1 0 0 1-1.4-1.4l5-5" />
);

const send: Glyph = () => (
  <g className="sg-lift">
    <path d="M10 16V4.25" />
    <path d="M5 9.25l5-5 5 5" />
  </g>
);

const more: Glyph = () => (
  <g fill="currentColor" stroke="none">
    <circle cx={4.75} cy={10} r={1.3} />
    <circle cx={10} cy={10} r={1.3} />
    <circle cx={15.25} cy={10} r={1.3} />
  </g>
);

const close: Glyph = () => <path d="M5.25 5.25l9.5 9.5M14.75 5.25l-9.5 9.5" />;

const collapse: Glyph = () => <path d="M6 3.75l4 4 4-4M6 16.25l4-4 4 4" />;

const expand: Glyph = () => <path d="M6 7.75l4-4 4 4M6 12.25l4 4 4-4" />;

const pin: Glyph = () => (
  <>
    <Sheet d="M11.6 3.2l5.2 5.2-1.95.65-2.6 2.6-.2 3.05-1.3 1.3-6-6 1.3-1.3 3.05-.2 2.6-2.6z" />
    <path d="M6.4 13.6l-3.15 3.15" />
  </>
);

const undoSpectra: Glyph = ({ spectrum }) => (
  <>
    <path d="M7.5 5.25 4.25 8.5 7.5 11.75" />
    <path d="M4.5 8.5h7.25a3.9 3.9 0 0 1 0 7.8H9.25" />
    <circle cx={15.6} cy={4.4} r={1.55} fill={`url(#${spectrum})`} stroke="none" />
  </>
);

const openSide: Glyph = () => (
  <>
    <Paper d="M12 3.75h3.25a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H12z" opacity={0.16} />
    <path d={box(2.75, 3.75, 14.5, 12.5, 2)} />
    <path d="M12 3.75v12.5" />
    <AccentLine d="M5.25 10h3.75M7.4 7.9 9.5 10l-2.1 2.1" width={1.35} className="sg-nudge" />
  </>
);

const openFull: Glyph = () => (
  <path d="M3.5 7.5V4.75A1.25 1.25 0 0 1 4.75 3.5H7.5M12.5 3.5h2.75a1.25 1.25 0 0 1 1.25 1.25V7.5M16.5 12.5v2.75a1.25 1.25 0 0 1-1.25 1.25H12.5M7.5 16.5H4.75a1.25 1.25 0 0 1-1.25-1.25V12.5" />
);

const external: Glyph = () => (
  <>
    <path d="M14.25 11.25v3.5a1.75 1.75 0 0 1-1.75 1.75H5.25a1.75 1.75 0 0 1-1.75-1.75V7.5a1.75 1.75 0 0 1 1.75-1.75h3.5" />
    <g className="sg-nudge-up">
      <path d="M11.5 3.5h5v5M16.5 3.5l-7 7" />
    </g>
  </>
);

const check: Glyph = () => <path d="M4.5 10.4l3.6 3.6 7.4-7.9" pathLength={12} className="sg-tick" />;

const chevronDown: Glyph = () => <path d="M5.75 8l4.25 4.25L14.25 8" />;

const chevronRight: Glyph = () => <path d="M8 5.75l4.25 4.25L8 14.25" />;

const trash: Glyph = () => (
  <>
    <Sheet d="M5.25 5.5l.8 10.6a1.25 1.25 0 0 0 1.25 1.15h5.4a1.25 1.25 0 0 0 1.25-1.15l.8-10.6" />
    <g className="sg-lid">
      <path d="M3.75 5.5h12.5M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
    </g>
    <Fine d="M8.5 8.5v5.5M11.5 8.5v5.5" opacity={0.7} />
  </>
);

const pause: Glyph = () => (
  <>
    <Sheet d={box(5.25, 4.25, 3.25, 11.5, 1)} />
    <Sheet d={box(11.5, 4.25, 3.25, 11.5, 1)} />
  </>
);

const link: Glyph = () => (
  <>
    <path d="M8.6 11.4a3 3 0 0 0 4.25 0l2.6-2.6a3 3 0 0 0-4.25-4.25l-.9.9" />
    <path d="M11.4 8.6a3 3 0 0 0-4.25 0l-2.6 2.6a3 3 0 0 0 4.25 4.25l.9-.9" />
  </>
);

const bell: Glyph = () => (
  <>
    <g className="sg-ring">
      <Sheet d="M5.25 13.5V9.5a4.75 4.75 0 0 1 9.5 0v4l1.5 1.75H3.75z" />
    </g>
    <path d="M8.25 17.25a1.9 1.9 0 0 0 3.5 0" />
    <circle cx={14.9} cy={4.6} r={1.7} fill={ACCENT} stroke="none" />
  </>
);

const people: Glyph = () => (
  <>
    <circle cx={8} cy={7} r={2.75} fill="currentColor" fillOpacity={0.1} />
    <circle cx={8} cy={7} r={2.75} />
    <path d="M3 16.5a5 5 0 0 1 10 0" />
    <path d="M12.6 4.5a2.6 2.6 0 0 1 0 5M14.6 11.65a4.6 4.6 0 0 1 2.65 4.35" strokeOpacity={0.6} />
  </>
);

const image: Glyph = () => (
  <>
    <Sheet d={box(2.75, 3.75, 14.5, 12.5, 2)} />
    <path d="M2.9 14.1l3.85-3.85 3.5 3.5 2.25-2.25 4.6 4.6" />
    <circle cx={13} cy={7.4} r={1.45} fill={ACCENT} stroke="none" />
  </>
);

const star: Glyph = () => (
  <Sheet d="M10 3.1l2.05 4.3 4.65.6-3.4 3.2.85 4.65L10 13.6l-4.15 2.25.85-4.65-3.4-3.2 4.65-.6z" />
);

const sidebar: Glyph = () => (
  <>
    <Paper d="M7.75 3.75H4.75a2 2 0 0 0-2 2v8.5a2 2 0 0 0 2 2h3z" opacity={0.16} />
    <path d={box(2.75, 3.75, 14.5, 12.5, 2)} />
    <path d="M7.75 3.75v12.5" />
  </>
);

const mail: Glyph = () => (
  <>
    <Sheet d={box(2.75, 4.5, 14.5, 11, 2)} />
    <AccentLine d="M3.4 5.6 10 10.6l6.6-5" width={1.35} />
  </>
);

const theme: Glyph = () => (
  <>
    <circle cx={10} cy={10} r={6.25} />
    <path d="M10 3.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" fillOpacity={0.85} stroke="none" />
    <AccentFill d="M6.1 7.4a.9.9 0 1 0 1.8 0 .9.9 0 1 0-1.8 0z" />
  </>
);

const keyboard: Glyph = () => (
  <>
    <Sheet d={box(2.5, 5.25, 15, 9.5, 2)} />
    <path d="M5.5 8.25h.01M8.5 8.25h.01M11.5 8.25h.01M14.5 8.25h.01M5.5 11h.01M14.5 11h.01" strokeWidth={1.75} />
    <AccentLine d="M8 11.4h4" width={1.5} />
  </>
);

const signOut: Glyph = () => (
  <>
    <Sheet d="M11.25 3.25H5.5a1.75 1.75 0 0 0-1.75 1.75v10a1.75 1.75 0 0 0 1.75 1.75h5.75" />
    <AccentLine d="M8.75 10h8M14.25 7.25 17 10l-2.75 2.75" />
  </>
);

const analytics: Glyph = () => (
  <>
    <path d="M3.25 16.25h13.5" />
    <Sheet d={box(4.5, 10, 2.75, 5, 0.6)} />
    <Sheet d={box(8.65, 6.5, 2.75, 8.5, 0.6)} />
    <path d={box(12.8, 3.75, 2.75, 11.25, 0.6)} fill={ACCENT} fillOpacity={0.9} stroke={ACCENT} />
  </>
);

/* ------------------------------------------------------------ more actions */

/** Spectra at work: an arc of the spectrum. Spinners turn it with `animate-spin`. */
const working: Glyph = ({ spectrum }) => (
  <>
    <circle cx={10} cy={10} r={6.75} strokeOpacity={0.16} />
    <path d="M10 3.25a6.75 6.75 0 0 1 6.75 6.75" stroke={`url(#${spectrum})`} strokeWidth={1.9} />
  </>
);

const chevronLeft: Glyph = () => <path d="M12 5.75L7.75 10 12 14.25" />;

const chevronUp: Glyph = () => <path d="M5.75 12L10 7.75 14.25 12" />;

const arrowRight: Glyph = () => (
  <>
    <path d="M3.75 10h11.5" />
    <AccentLine d="M11.25 5.75L15.5 10l-4.25 4.25" className="sg-nudge" />
  </>
);

const retry: Glyph = () => (
  <g className="sg-spin">
    <path d="M4.1 11.2A6.1 6.1 0 1 0 6 5.4" />
    <AccentLine d="M3.6 3.6l.4 2.75 2.75-.4" />
  </g>
);

const play: Glyph = () => (
  <>
    <AccentFill d="M6.5 4.6v10.8a.8.8 0 0 0 1.2.7l8.6-5.4a.8.8 0 0 0 0-1.4L7.7 3.9a.8.8 0 0 0-1.2.7z" opacity={0.18} />
    <path d="M6.5 4.6v10.8a.8.8 0 0 0 1.2.7l8.6-5.4a.8.8 0 0 0 0-1.4L7.7 3.9a.8.8 0 0 0-1.2.7z" />
  </>
);

const stop: Glyph = () => (
  <>
    <circle cx={10} cy={10} r={7.25} fill="currentColor" fillOpacity={0.1} />
    <circle cx={10} cy={10} r={7.25} />
    <AccentFill d={box(7.4, 7.4, 5.2, 5.2, 1)} />
  </>
);

const help: Glyph = () => (
  <>
    <circle cx={10} cy={10} r={7.25} fill="currentColor" fillOpacity={0.1} />
    <circle cx={10} cy={10} r={7.25} />
    <AccentLine d="M7.85 8a2.2 2.2 0 1 1 3.05 2.05c-.6.25-.9.7-.9 1.35v.35" width={1.6} />
    <circle cx={10} cy={14.1} r={0.95} fill={ACCENT} stroke="none" />
  </>
);

const SHIELD = "M10 2.75l5.75 2.1v4.4c0 3.7-2.45 6.6-5.75 8-3.3-1.4-5.75-4.3-5.75-8v-4.4z";

const shield: Glyph = () => (
  <>
    <Sheet d={SHIELD} />
    <AccentLine d="M7.4 10.1l1.85 1.85 3.5-3.7" width={1.6} className="sg-tick" />
  </>
);

const clock: Glyph = () => (
  <>
    <circle cx={10} cy={10} r={7.25} fill="currentColor" fillOpacity={0.1} />
    <circle cx={10} cy={10} r={7.25} />
    <AccentLine d="M10 5.9V10l2.75 1.65" className="sg-hand" />
  </>
);

const copy: Glyph = () => (
  <>
    <path d="M12.75 5.5V4.25a1.5 1.5 0 0 0-1.5-1.5h-6.5a1.5 1.5 0 0 0-1.5 1.5v6.5a1.5 1.5 0 0 0 1.5 1.5H6" strokeOpacity={0.55} className="sg-peek" />
    <Sheet d={box(7.25, 7.25, 10, 10, 1.5)} />
    <AccentFill d={box(9.25, 10, 4.5, 1.5, 0.75)} />
  </>
);

const download: Glyph = () => (
  <>
    <Paper d="M3.25 13.25v1.5a2 2 0 0 0 2 2h9.5a2 2 0 0 0 2-2v-1.5z" />
    <path d="M3.25 13.25v1.5a2 2 0 0 0 2 2h9.5a2 2 0 0 0 2-2v-1.5" />
    <g className="sg-drop">
      <path d="M10 3.25v8.5" />
      <AccentLine d="M6.6 8.6L10 12l3.4-3.4" />
    </g>
  </>
);

const edit: Glyph = () => (
  <>
    <Sheet d="M12.6 3.9a1.6 1.6 0 0 1 2.25 0l1.25 1.25a1.6 1.6 0 0 1 0 2.25l-8.4 8.4-3.6.85.85-3.6z" />
    <AccentLine d="M11.4 5.1l3.5 3.5" />
    <Fine d="M10.5 16.25h5.75" opacity={0.6} />
  </>
);

/** Six dots: what can be picked up and moved. */
const grip: Glyph = () => (
  <g fill="currentColor" stroke="none">
    {[6, 10, 14].flatMap((y) => [7.5, 12.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.15} />))}
  </g>
);

export const GLYPHS = {
  // Artifact types
  document: page,
  slides,
  sheet,
  quiz,
  flashcards,
  whiteboard,
  code,
  task,
  timetable,
  pdf,
  folder,
  agent,
  conversations,
  // Navigation
  home,
  library,
  calendar,
  school,
  agents,
  devices,
  settings,
  // Status
  saved,
  saving,
  offline,
  syncing,
  locked,
  readOnly,
  versions,
  problem,
  info,
  done,
  working,
  clock,
  shield,
  help,
  // Actions
  add,
  share,
  filter,
  sort,
  search,
  attach,
  send,
  more,
  close,
  collapse,
  expand,
  pin,
  undoSpectra,
  openSide,
  openFull,
  external,
  check,
  chevronDown,
  chevronRight,
  trash,
  pause,
  link,
  bell,
  people,
  image,
  star,
  sidebar,
  mail,
  chevronLeft,
  chevronUp,
  arrowRight,
  retry,
  play,
  stop,
  copy,
  download,
  edit,
  grip,
  // Account
  theme,
  keyboard,
  signOut,
  analytics,
} satisfies Record<string, Glyph>;

export type IconName = keyof typeof GLYPHS;

/** The set in the lab's order, by family. */
export const ICON_FAMILIES: { family: string; names: IconName[] }[] = [
  { family: "Artifact types", names: ["document", "slides", "sheet", "quiz", "flashcards", "whiteboard", "code", "task", "timetable", "pdf", "folder", "agent", "conversations"] },
  { family: "Navigation", names: ["home", "library", "calendar", "conversations", "school", "agents", "devices", "settings"] },
  { family: "Status", names: ["saved", "saving", "offline", "syncing", "locked", "readOnly", "versions", "problem", "info", "done", "working", "clock", "shield", "help"] },
  {
    family: "Actions",
    names: ["add", "share", "filter", "sort", "search", "attach", "send", "more", "close", "collapse", "expand", "pin", "undoSpectra", "openSide", "openFull", "external", "check", "chevronDown", "chevronRight", "trash", "pause", "link", "bell", "people", "image", "star", "sidebar", "mail", "chevronLeft", "chevronUp", "arrowRight", "retry", "play", "stop", "copy", "download", "edit", "grip"],
  },
  { family: "Account", names: ["theme", "keyboard", "signOut", "analytics"] },
];
