"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { SpectraMark } from "@/components/spectra-mark";
import { WorkCardBody, workCardStyle, type WorkCardContent } from "@/features/spectra/components/work-card";
import type { PrismMode } from "@/features/spectra/life/prism";
import { LivePrism } from "./prism";
import { HOME_CARDS, HOME_LATER, HOME_TODAY, type IslandRun, type WeekItem } from "./world";

/*
 * Spectra's window, as it looks on Maya's laptop: the rail, Home, and the
 * island at the foot of the page. It is a drawing of the app made from the
 * app's own parts (its cards, glyphs and prism), held in a fixed design size
 * and scaled to fit, so it reads the same on every screen. Nothing in it
 * opens or saves; the only thing that answers a press is the island.
 */

const RAIL: Array<{ name: string; glyph: IconName }> = [
  { name: "Home", glyph: "home" },
  { name: "Library", glyph: "library" },
  { name: "Calendar", glyph: "calendar" },
  { name: "School", glyph: "school" },
  { name: "Agents", glyph: "agents" },
  { name: "Devices", glyph: "devices" },
];

export type IslandState =
  | { phase: "idle"; notice?: string }
  | { phase: "typing"; text: string }
  | { phase: "working"; run: IslandRun; done: number }
  | { phase: "done"; run: IslandRun }
  | { phase: "reply"; run: IslandRun }
  | { phase: "choosing" };

export type HomeState = {
  greeting: string;
  /** Today and the next six days. */
  days: { short: string[]; dates: number[] };
  testDay: string;
  /** Plans Spectra added, by day offset. */
  plans: Array<{ day: number; item: WeekItem }>;
  /** Cards Spectra made, newest first. */
  made: Array<WorkCardContent & { id: string }>;
};

/** Holds a fixed design size and scales it to its container's width. */
export function Scaled({ width, height, children, className }: { width: number; height: number; children: ReactNode; className?: string }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const read = () => setScale(Math.min(1.25, outer.clientWidth / width));
    read();
    const sized = new ResizeObserver(read);
    sized.observe(outer);
    return () => sized.disconnect();
  }, [width]);
  return (
    <div ref={outerRef} className={["sp-scaled", className].filter(Boolean).join(" ")} style={{ height: height * scale }}>
      <div className="sp-scaled-inner" style={{ width, height, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

export function AppWindow({
  home,
  island,
  prismMode,
  compact,
  onIsland,
  onChoose,
  suggestions,
}: {
  home: HomeState;
  island: IslandState;
  prismMode: PrismMode;
  compact: boolean;
  onIsland: () => void;
  onChoose: (run: IslandRun) => void;
  suggestions: IslandRun[];
}) {
  return (
    <div className="sp-app" data-compact={compact || undefined}>
      {compact ? null : (
        <nav className="sp-app-rail" aria-hidden>
          <span className="sp-app-brand">
            <SpectraMark size={20} />
            Spectra
          </span>
          {RAIL.map((item, index) => (
            <span key={item.name} className="sp-app-rail-item" data-on={index === 0 || undefined}>
              <Icon name={item.glyph} size={17} />
              {item.name}
            </span>
          ))}
          <span className="sp-app-rail-classes">
            <span className="sp-app-rail-label">Classes</span>
            {["Chemistry HL", "History SL", "English A", "Maths AA HL"].map((name, index) => (
              <span key={name} className="sp-app-rail-class" style={{ "--class-ink": ["var(--ink-blue)", "var(--ink-orange)", "var(--ink-red)", "var(--ink-violet)"][index] } as CSSProperties}>
                {name}
              </span>
            ))}
          </span>
          <span className="sp-app-rail-me">
            Maya Lindgren
            <Icon name="settings" size={15} />
          </span>
        </nav>
      )}
      <div className="sp-app-page">
        <Home home={home} compact={compact} />
        <Island state={island} prismMode={prismMode} onIsland={onIsland} onChoose={onChoose} suggestions={suggestions} testDay={home.testDay} />
      </div>
    </div>
  );
}

function Home({ home, compact }: { home: HomeState; compact: boolean }) {
  const columns = compact ? 4 : 7;
  const cards = [...home.made, ...HOME_CARDS].slice(0, compact ? 2 : 4);
  return (
    <div className="sp-home" aria-hidden>
      <p className="sp-home-greeting">{home.greeting}, Maya.</p>
      <p className="sp-home-sentence">
        Two classes left today. The lab write-up is due tomorrow, and your chemistry test is on {home.testDay}.
      </p>
      <div className="sp-home-week" style={{ gridTemplateColumns: `1.35fr repeat(${columns - 1}, 1fr)` }}>
        {Array.from({ length: columns }, (_, offset) => {
          const items = [...(offset === 0 ? HOME_TODAY : HOME_LATER[offset - 1] ?? []), ...home.plans.filter((plan) => plan.day === offset).map((plan) => plan.item)];
          return (
            <div key={offset} className="sp-home-day" data-today={offset === 0 || undefined}>
              <span className="sp-home-day-name">
                {offset === 0 ? "Today" : home.days.short[offset]}
                <span>{home.days.dates[offset]}</span>
              </span>
              {items.map((item) => (
                <span key={item.id} className="sp-home-item" data-kind={item.kind} data-fresh={item.fresh || undefined} style={{ "--item-ink": item.ink } as CSSProperties}>
                  {item.time ? <span className="sp-home-item-time">{item.time}</span> : null}
                  {item.title}
                </span>
              ))}
            </div>
          );
        })}
      </div>
      <p className="sp-home-label">Pick up where you left off</p>
      <div className="sp-home-cards">
        {cards.map((card) => (
          <div key={card.id} className="work-card sp-home-card" data-fresh={home.made.some((made) => made.id === card.id) || undefined} style={workCardStyle(card.type)}>
            <WorkCardBody type={card.type} title={card.title} preview={card.preview} place={card.place} when={card.when} />
          </div>
        ))}
      </div>
    </div>
  );
}

function fill(text: string, day: string) {
  return text.replaceAll("{day}", day);
}

function Island({
  state,
  prismMode,
  onIsland,
  onChoose,
  suggestions,
  testDay,
}: {
  state: IslandState;
  prismMode: PrismMode;
  onIsland: () => void;
  onChoose: (run: IslandRun) => void;
  suggestions: IslandRun[];
  testDay: string;
}) {
  const open = state.phase === "working" || state.phase === "done" || state.phase === "reply" || state.phase === "choosing";
  return (
    <div className="sp-island" data-phase={state.phase} data-open={open || undefined}>
      <div className="sp-island-panel" aria-live="polite">
        {state.phase === "choosing" ? (
          <div className="sp-island-choices">
            <span className="sp-island-tab">Try asking</span>
            {suggestions.map((run) => (
              <button key={run.id} type="button" className="sp-island-choice" onClick={() => onChoose(run)}>
                {fill(run.ask, testDay)}
                <Icon name="arrowRight" size={14} />
              </button>
            ))}
          </div>
        ) : null}
        {state.phase === "working" || state.phase === "done" || state.phase === "reply" ? (
          <div className="sp-island-work">
            <span className="sp-island-tab">{fill(state.run.tab, testDay)}</span>
            {state.phase === "reply" && state.run.reply ? (
              <div className="sp-island-reply">
                <p>{fill(state.run.reply.text, testDay)}</p>
                <span className="sp-island-chips">
                  {state.run.reply.chips.map((chip) => (
                    <span key={chip}>{chip}</span>
                  ))}
                </span>
              </div>
            ) : (
              <ul className="sp-island-steps">
                {state.run.steps.map((step, index) => {
                  const done = state.phase === "done" || index < state.done;
                  const now = state.phase === "working" && index === state.done;
                  return (
                    <li key={step} data-done={done || undefined} data-now={now || undefined} data-later={!done && !now ? true : undefined}>
                      <Icon name={done ? "check" : "working"} size={14} animate={now} />
                      {step}
                    </li>
                  );
                })}
              </ul>
            )}
            {state.phase === "done" ? (
              <p className="sp-island-notice">
                <Icon name="done" size={15} />
                {fill(state.run.notice, testDay)}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <button type="button" className="sp-island-bar" onClick={onIsland} aria-label="Show things to ask Spectra">
        <LivePrism width="40px" mode={prismMode} className="sp-island-prism" badge />
        <span className="sp-island-text">
          {state.phase === "typing" ? (
            <span className="sp-island-typed">
              {state.text}
              <span className="sp-caret" />
            </span>
          ) : state.phase === "idle" && state.notice ? (
            <span className="sp-island-done">
              <Icon name="done" size={14} />
              {fill(state.notice, testDay)}
            </span>
          ) : state.phase === "working" ? (
            <span className="sp-island-quiet">Spectra is on it</span>
          ) : (
            <span className="sp-island-quiet">Ask Spectra anything</span>
          )}
        </span>
        <span className="sp-island-tools">
          <Icon name="attach" size={16} />
          <Icon name="mic" size={16} />
          <span className="sp-island-send" data-ready={state.phase === "typing" || undefined}>
            <Icon name="send" size={15} />
          </span>
        </span>
      </button>
    </div>
  );
}
