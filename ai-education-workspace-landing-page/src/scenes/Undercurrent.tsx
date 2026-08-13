import { useRef, type RefObject } from "react";
import { useScene, useSectionRef, clamp, lerp, seg, segL, setO, setT, setVis, easeOut } from "../engine/ticker";
import { prism, field } from "../webgl/stage";
import { Avatar, Cursor, Icon, PEOPLE, PrismMark } from "../components/kit";

/* ------------------------------------------------------------------
   THE UNDERCURRENT
   Work a Fellow is still doing. Each job is a "current": it runs
   under whatever you are looking at, reports as it goes, and only
   interrupts when a decision is genuinely yours to make.
-------------------------------------------------------------------*/

export type CurrentDef = {
  id: string;
  who: keyof typeof PEOPLE;
  title: string;
  state: "running" | "waiting" | "queued" | "done";
  detail: string;
  progress: number;
};

export const CURRENTS: CurrentDef[] = [
  {
    id: "read",
    who: "fellow",
    title: "Reading 14 items on corvée labour",
    state: "running",
    detail: "6 load-bearing so far",
    progress: 0.68,
  },
  {
    id: "verify",
    who: "method",
    title: "Checking the 1885 discharge figures",
    state: "waiting",
    detail: "two sources disagree",
    progress: 0.9,
  },
  {
    id: "draft",
    who: "fellow",
    title: "Drafting the counter-argument",
    state: "queued",
    detail: "starts when §2 settles",
    progress: 0.08,
  },
  {
    id: "slides",
    who: "method",
    title: "Seminar slide outline",
    state: "done",
    detail: "9 slides · ready to open",
    progress: 1,
  },
];

const TONE: Record<CurrentDef["state"], { c: string; cls: string; word: string }> = {
  running: { c: "var(--amber)", cls: "dots-amber", word: "running" },
  waiting: { c: "var(--rose)", cls: "dots-rose", word: "needs you" },
  queued: { c: "rgba(236,230,218,0.4)", cls: "", word: "queued" },
  done: { c: "var(--sea)", cls: "dots-sea", word: "delivered" },
};

export function DotMeter({ value, tone, width = 96 }: { value: number; tone: string; width?: number }) {
  return (
    <span className="relative inline-block align-middle" style={{ width, height: 7 }}>
      <span className="dots absolute inset-0" style={{ ["--dot-c" as string]: "rgba(236,230,218,0.16)", ["--dot-s" as string]: "6px", ["--dot-r" as string]: "0.85px" }} />
      <span
        data-fill
        className={`dots ${tone} dots-drift absolute inset-y-0 left-0`}
        style={{ width: `${value * 100}%`, ["--dot-s" as string]: "6px", ["--dot-r" as string]: "0.95px" }}
      />
    </span>
  );
}

export function UndercurrentBar({
  rootRef,
  slotRef,
  cardRefs,
  panelRef,
  scale = 1,
  items = CURRENTS,
  summary = "3 running · 1 waiting",
  punch = false,
}: {
  rootRef?: RefObject<HTMLDivElement | null>;
  slotRef?: RefObject<HTMLDivElement | null>;
  cardRefs?: RefObject<(HTMLDivElement | null)[]>;
  panelRef?: RefObject<HTMLDivElement | null>;
  scale?: number;
  items?: CurrentDef[];
  summary?: string;
  punch?: boolean;
}) {
  const s = (n: number) => n * scale;
  return (
    <div ref={rootRef} className="relative w-full">
      {/* the decision a current is waiting on */}
      <div
        ref={panelRef}
        className="surface absolute z-30 overflow-hidden"
        style={{
          left: s(232),
          bottom: s(64),
          width: s(360),
          padding: `${s(13)}px ${s(15)}px`,
          visibility: "hidden",
          borderColor: "rgba(224,141,128,0.34)",
        }}
      >
        <div className="flex items-center gap-2">
          <PrismMark size={s(14)} state="wait" />
          <span className="label" style={{ color: "#efb2a8" }}>
            Method Fellow needs a decision
          </span>
        </div>
        <p className="mt-2" style={{ fontSize: s(12.5), lineHeight: 1.5, color: "var(--paper-2)" }}>
          Willcocks gives 1885 for the first perennial canal; the gauge table you uploaded says 1887. Both are in your
          reading list.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="chip chip-amber">Use 1885, flag it in §2</span>
          <span className="chip">Use 1887</span>
          <span className="chip">Show me both</span>
        </div>
      </div>

      {/* the rail */}
      <div
        className="flex items-center gap-3 overflow-hidden"
        style={{
          height: s(58),
          padding: `0 ${s(14)}px`,
          borderTop: "1px solid var(--line)",
          background: punch
            ? "linear-gradient(180deg, rgba(16,19,17,1), rgba(10,12,10,1))"
            : "linear-gradient(180deg, rgba(14,17,15,0.86), rgba(8,9,8,0.96))",
          backdropFilter: punch ? undefined : "blur(18px)",
          // a well is cut out of the rail so the real prism can sit inside the product
          ...(punch
            ? {
                WebkitMaskImage: `radial-gradient(circle ${s(19)}px at ${s(33)}px ${s(29)}px, transparent 99%, #000 100%)`,
                maskImage: `radial-gradient(circle ${s(19)}px at ${s(33)}px ${s(29)}px, transparent 99%, #000 100%)`,
              }
            : {}),
        }}
      >
        {/* prism well — the live state of the workspace */}
        <div
          ref={slotRef}
          className="relative flex items-center justify-center"
          style={{
            width: s(38),
            height: s(38),
            borderRadius: s(9),
            background: "radial-gradient(circle at 50% 40%, rgba(224,173,99,0.12), rgba(8,9,8,0.9))",
            border: "1px solid var(--line)",
            flex: "none",
          }}
        >
          <span
            className="dots dots-amber absolute inset-0 dots-mask-fade"
            style={{ ["--dot-s" as string]: "5px", ["--dot-r" as string]: "0.8px", opacity: 0.5, borderRadius: s(9) }}
          />
        </div>
        <div className="flex flex-col" style={{ width: s(112), flex: "none" }}>
          <span className="label" style={{ fontSize: s(9.5) }}>
            Undercurrent
          </span>
          <span className="meta" style={{ fontSize: s(10.5), color: "var(--paper-2)" }}>
            {summary}
          </span>
        </div>

        <div className="flex items-center gap-2" style={{ flex: 1, minWidth: 0 }}>
          {items.map((cur, i) => {
            const tone = TONE[cur.state];
            return (
              <div
                key={cur.id}
                ref={(el) => {
                  if (cardRefs?.current) cardRefs.current[i] = el;
                }}
                className="flex items-center gap-2.5 overflow-hidden"
                style={{
                  height: s(40),
                  padding: `0 ${s(11)}px`,
                  borderRadius: s(8),
                  border: `1px solid ${cur.state === "waiting" ? "rgba(224,141,128,0.34)" : "var(--line)"}`,
                  background: cur.state === "waiting" ? "rgba(224,141,128,0.07)" : "rgba(236,230,218,0.028)",
                  flex: i === 3 ? "0 1 auto" : "1 1 0",
                  minWidth: 0,
                }}
              >
                <Avatar initials={PEOPLE[cur.who].initials} color={PEOPLE[cur.who].color} />
                <div className="flex min-w-0 flex-col" style={{ gap: 2 }}>
                  <span
                    className="truncate"
                    style={{ fontSize: s(11.5), color: "var(--paper)", lineHeight: 1.2 }}
                    data-title
                  >
                    {cur.title}
                  </span>
                  <span className="flex items-center gap-2">
                    <DotMeter value={cur.progress} tone={tone.cls} width={s(64)} />
                    <span
                      className="meta truncate"
                      style={{ fontSize: s(9.5), color: tone.c, letterSpacing: "0.06em", textTransform: "uppercase" }}
                      data-state
                    >
                      {tone.word}
                    </span>
                  </span>
                </div>
                {cur.state === "done" && (
                  <span style={{ color: "var(--sea)", marginLeft: "auto" }}>
                    <Icon name="check" size={s(13)} />
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="hidden items-center gap-2 md:flex" style={{ flex: "none" }}>
          <span className="chip" style={{ height: s(24) }}>
            <Icon name="people" size={s(11)} /> hand back
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- the scene ---------------- */

export default function Undercurrent() {
  const sec = useSectionRef("under");
  const bar = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const panel = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const cur = useRef<HTMLDivElement>(null);
  const toast = useRef<HTMLDivElement>(null);

  useScene(
    "under",
    (p, c) => {
      const { vw, vh, mobile: mob } = c;
      const active = p > 0.0001 && p < 0.9999;

      const rise = easeOut(seg(p, 0.02, 0.16));
      const outP = seg(p, 0.94, 1);
      setT(bar.current, 0, (1 - rise) * 90 + outP * 60, 1);
      setO(bar.current, rise);

      const copyIn = seg(p, 0.1, 0.26);
      setO(copy.current, copyIn * (1 - seg(p, 0.9, 1)));
      setT(copy.current, 0, (1 - copyIn) * 24 - seg(p, 0.3, 1) * 40, 1);

      // current 1 advances while you watch
      const adv = 0.68 + seg(p, 0.2, 0.85) * 0.3;
      const m1 = cards.current[0]?.querySelector<HTMLElement>("[data-fill]");
      if (m1) m1.style.width = `${(adv * 100).toFixed(1)}%`;

      // current 2 asks for a decision, then resumes
      const open = seg(p, 0.36, 0.46);
      const close = seg(p, 0.6, 0.68);
      setVis(panel.current, open * (1 - close));
      setT(panel.current, 0, (1 - open) * 14 + close * 10, lerp(0.97, 1, open));
      const c2 = cards.current[1];
      if (c2) {
        const resolved = close > 0.5;
        c2.style.borderColor = resolved ? "rgba(224,173,99,0.34)" : "rgba(224,141,128,0.34)";
        c2.style.background = resolved ? "rgba(224,173,99,0.06)" : "rgba(224,141,128,0.07)";
        const st = c2.querySelector<HTMLElement>("[data-state]");
        if (st) {
          st.textContent = resolved ? "resumed" : "needs you";
          st.style.color = resolved ? "var(--amber)" : "var(--rose)";
        }
        const ti = c2.querySelector<HTMLElement>("[data-title]");
        if (ti) ti.textContent = resolved ? "1885 confirmed · flagged in §2" : "Checking the 1885 discharge figures";
        const mm = c2.querySelector<HTMLElement>("[data-fill]");
        if (mm) mm.className = `dots ${resolved ? "dots-amber" : "dots-rose"} dots-drift absolute inset-y-0 left-0`;
      }

      // the cursor that answers it
      const cp = seg(p, 0.48, 0.56);
      setVis(cur.current, seg(p, 0.46, 0.5) * (1 - seg(p, 0.62, 0.68)));
      setT(
        cur.current,
        lerp(vw * 0.62, mob ? vw * 0.3 : 300, cp) + Math.sin(c.t * 1.1) * 2,
        lerp(vh * 0.55, vh - (mob ? 210 : 178), cp),
        1
      );

      // a current delivers
      const del = seg(p, 0.74, 0.82);
      setVis(toast.current, del * (1 - seg(p, 0.92, 0.99)));
      setT(toast.current, 0, (1 - del) * 16, 1);

      if (active) {
        // the hero object docks into the activity rail: identity = live state
        const r = slot.current?.getBoundingClientRect();
        const dock = easeOut(seg(p, 0.04, 0.3));
        const tx = r ? ((r.left + r.width / 2) / vw) * 2 - 1 : -0.8;
        const ty = r ? ((r.top + r.height / 2) / vh) * 2 - 1 : 0.8;
        prism.opacity = 1;
        prism.px = lerp(mob ? 0.62 : 0.84, tx, dock);
        prism.py = lerp(mob ? -0.82 : -0.74, ty, dock);
        prism.scale = lerp(mob ? 0.22 : 0.3, mob ? 0.045 : 0.052, dock);
        prism.spin = 1.4;
        prism.intake = 0;
        prism.charge = 0.55 + Math.sin(c.t * 1.4) * 0.12 + (open - close) * 0.3;
        prism.roll = 0;
        prism.tilt = 0;
        field.intensity = lerp(0.24, 0.4, seg(p, 0, 0.4));
        field.density = 0.9;
        field.cell = 11;
        field.wave = 0.7;
        field.speed = 0.9;
        field.tint = lerp(1, 0.9, open) + del * 1.1;
        field.pulse = Math.sin(clamp(segL(p, 0.74, 0.86)) * Math.PI) * 0.4;
        field.clip = 0;
      }
    },
    5
  );

  return (
    <section ref={sec} style={{ height: "200vh", position: "relative" }}>
      <div className="stage">
        <div
          ref={copy}
          className="absolute z-20"
          style={{ left: "clamp(20px, 7.5vw, 118px)", top: "22vh", maxWidth: 640 }}
        >
          <span className="label">The Undercurrent</span>
          <h2
            className="display mt-4"
            style={{ fontSize: "clamp(32px, 4.6vw, 60px)", lineHeight: 1.02, margin: 0 }}
          >
            Close the tab. <em>The work keeps running.</em>
          </h2>
          <p className="body mt-5" style={{ maxWidth: 520 }}>
            A current is a job a Fellow is still doing — reading, checking, drafting. It reports as it goes, survives
            you leaving, and interrupts only when the decision is genuinely yours.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="chip chip-amber">running</span>
            <span className="chip chip-rose">needs you</span>
            <span className="chip">queued</span>
            <span className="chip chip-sea">delivered</span>
          </div>
        </div>

        <div
          ref={toast}
          className="surface absolute z-30 flex items-center gap-2.5"
          style={{ right: "clamp(20px, 5vw, 64px)", bottom: 96, padding: "10px 14px", visibility: "hidden" }}
        >
          <PrismMark size={15} state="done" />
          <span style={{ fontSize: 12.5, color: "var(--paper-2)" }}>
            Slide outline delivered to <b style={{ fontWeight: 500 }}>Water &amp; Empire</b>
          </span>
          <span className="chip chip-sea">open</span>
        </div>

        <div ref={bar} className="absolute bottom-0 left-0 right-0 z-20">
          <UndercurrentBar rootRef={undefined} slotRef={slot} cardRefs={cards} panelRef={panel} />
        </div>

        <Cursor ref={cur} name="You" color={PEOPLE.naima.color} />
      </div>
    </section>
  );
}
