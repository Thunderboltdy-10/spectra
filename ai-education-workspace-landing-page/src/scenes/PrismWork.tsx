import { useRef, type ReactNode } from "react";
import { useScene, useSectionRef, clamp, lerp, seg, segL, setO, setT, setVis, streamText, easeOut } from "../engine/ticker";
import { prism, field } from "../webgl/stage";
import { Avatar, Chip, Cite, Cursor, Icon, PEOPLE, PrismMark } from "../components/kit";

/* --------------------------------------------------------------
   Five real fragments of unfinished work, arranged and fed into
   the prism. What comes out is worth more than what went in.
---------------------------------------------------------------*/

type Frag = {
  id: string;
  w: number;
  /** arranged position, fractions of viewport */
  ax: number;
  ay: number;
  /** entry offset */
  ex: number;
  ey: number;
  rot: number;
  body: ReactNode;
};

const FRAGS: Frag[] = [
  {
    id: "brief",
    w: 330,
    ax: 0.045,
    ay: 0.13,
    ex: -0.4,
    ey: -0.1,
    rot: -2.4,
    body: (
      <>
        <FragHead icon="doc" kind="Assignment brief" name="HIST 342" />
        <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--paper-2)" }}>
          "Assess{" "}
          <span style={{ borderBottom: "1px dashed rgba(224,141,128,0.8)", color: "#efb2a8" }}>the role</span> of
          irrigation infrastructure in imperial administration." 2,500 words · due 14 Nov.
        </p>
        <div className="mt-2.5">
          <Chip tone="rose">scope unclear — one case or two?</Chip>
        </div>
      </>
    ),
  },
  {
    id: "notes",
    w: 292,
    ax: 0.055,
    ay: 0.44,
    ex: -0.35,
    ey: 0.18,
    rot: 1.8,
    body: (
      <>
        <FragHead icon="board" kind="Loose notes" name="last edited Tue" />
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 15.5,
            lineHeight: 1.62,
            color: "var(--paper-2)",
            fontStyle: "italic",
          }}
        >
          perennial canals ~1885?
          <br />
          corvée — abolished <span style={{ color: "var(--rose)" }}>when</span>
          <br />
          Barak, "countertempo" → §3
          <br />
          ask DA re: Punjab
        </div>
      </>
    ),
  },
  {
    id: "sources",
    w: 316,
    ax: 0.038,
    ay: 0.735,
    ex: -0.3,
    ey: 0.4,
    rot: -1.1,
    body: (
      <>
        <FragHead icon="source" kind="Unsorted sources" name="14 items" />
        <div className="flex flex-col gap-1.5">
          {[
            ["Willcocks, Egyptian Irrigation", "1899 · p. 112"],
            ["Barak, On Time", "2013 · p. 74"],
            ["Gilmartin, Empire & Islam", "1994 · p. 1129"],
          ].map(([t, m]) => (
            <div key={t} className="flex items-center gap-2" style={{ fontSize: 12 }}>
              <span style={{ color: "var(--paper-4)" }}>
                <Icon name="source" size={12} />
              </span>
              <span className="truncate" style={{ color: "var(--paper-2)" }}>
                {t}
              </span>
              <span className="meta ml-auto whitespace-nowrap">{m}</span>
            </div>
          ))}
          <div className="meta mt-0.5">+ 11 more, none read</div>
        </div>
      </>
    ),
  },
  {
    id: "feedback",
    w: 306,
    ax: 0.225,
    ay: 0.09,
    ex: 0.1,
    ey: -0.42,
    rot: 2.6,
    body: (
      <>
        <FragHead icon="thread" kind="Feedback · Essay 1" name="Dr. Adeyemi" />
        <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--paper-2)" }}>
          Strong on chronology, thin on counter-argument. Next time, make the opposing reading as strong as you can
          before you dismantle it.
        </p>
      </>
    ),
  },
  {
    id: "plan",
    w: 286,
    ax: 0.235,
    ay: 0.6,
    ex: 0.06,
    ey: 0.45,
    rot: -2.2,
    body: (
      <>
        <FragHead icon="plan" kind="This fortnight" name="2 clashes" />
        <div className="flex flex-col gap-1.5" style={{ fontSize: 12 }}>
          <Row d="Wed 12 Nov" t="BIOL 214 lab report" tone="rose" />
          <Row d="Thu 13 Nov" t="Seminar prep — Water & Empire" />
          <Row d="Fri 14 Nov" t="Essay 2 due, 2,500 words" tone="rose" />
        </div>
      </>
    ),
  },
];

function FragHead({ icon, kind, name }: { icon: string; kind: string; name: string }) {
  return (
    <div className="mb-2.5 flex items-center gap-2" style={{ color: "var(--paper-3)" }}>
      <Icon name={icon} size={12} />
      <span className="label">{kind}</span>
      <span className="meta ml-auto truncate">{name}</span>
    </div>
  );
}

function Row({ d, t, tone }: { d: string; t: string; tone?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="meta" style={{ width: 66, flex: "none" }}>
        {d}
      </span>
      <span
        style={{
          color: tone === "rose" ? "#efb2a8" : "var(--paper-2)",
          borderLeft: `2px solid ${tone === "rose" ? "var(--rose)" : "var(--line-strong)"}`,
          paddingLeft: 7,
          fontSize: 12,
        }}
        className="truncate"
      >
        {t}
      </span>
    </div>
  );
}

const OUT_LEAD =
  "Two systems, one argument: read Egypt's perennial canals (1885–1901) against the Punjab canal colonies. Both administered water in order to administer people — but only one of them said so.";

export default function PrismWork() {
  const sec = useSectionRef("prismwork");
  const fragRefs = useRef<(HTMLDivElement | null)[]>([]);
  const out = useRef<HTMLDivElement>(null);
  const lead = useRef<HTMLSpanElement>(null);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const cur = useRef<HTMLDivElement>(null);
  const bracket = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLDivElement>(null);
  const sizes = useRef<{ w: number; h: number }[]>([]);
  const lastVW = useRef(0);

  useScene(
    "prismwork",
    (p, c) => {
      const { vw, vh, mobile: mob } = c;
      const active = p > 0.0001 && p < 0.9999;

      if (lastVW.current !== vw) {
        lastVW.current = vw;
        sizes.current = fragRefs.current.map((el) => ({ w: el?.offsetWidth ?? 300, h: el?.offsetHeight ?? 130 }));
      }

      const pcx = prism.screen.x;
      const pcy = prism.screen.y;

      /* fragments: arrive → get arranged → travel in */
      FRAGS.forEach((f, i) => {
        const el = fragRefs.current[i];
        if (!el) return;
        const sz = sizes.current[i] ?? { w: f.w, h: 130 };
        const st = i * 0.022;
        const arrive = seg(p, 0.02 + st, 0.15 + st);
        const arrange = seg(p, 0.19 + i * 0.012, 0.3 + i * 0.012);
        const go = seg(p, 0.34 + i * 0.045, 0.5 + i * 0.045);
        const eaten = segL(p, 0.42 + i * 0.045, 0.5 + i * 0.045);

        const ax = mob ? vw * 0.07 + (i % 2) * vw * 0.12 : vw * f.ax;
        const ay = mob ? vh * (0.1 + i * 0.1) : vh * f.ay;
        // arranged pass: the Fellow aligns them to a shared left edge and levels the rotations
        const alignedX = mob ? vw * 0.08 : vw * (f.ax < 0.15 ? 0.05 : 0.215);
        const alignedY = mob ? vh * (0.12 + i * 0.105) : vh * (f.ax < 0.15 ? [0.11, 0.4, 0.69][Math.min(i, 2)] : f.ay);

        const bx = lerp(ax + vw * f.ex, lerp(ax, alignedX, arrange), arrive);
        const by = lerp(ay + vh * f.ey, lerp(ay, alignedY, arrange), arrive);
        const rot = lerp(f.rot * 2.4, f.rot * (1 - arrange), arrive);

        const tx = pcx - sz.w / 2;
        const ty = pcy - sz.h / 2;
        const ease = easeOut(go);
        const x = lerp(bx, tx, ease);
        const y = lerp(by, ty, ease);
        const s = lerp(1, 0.22, go * go);
        setT(el, x, y, s, lerp(rot, rot + 14 * (i % 2 ? 1 : -1), go));
        setVis(el, clamp(arrive * 2) * (1 - eaten));
        el.style.filter = eaten > 0 ? `blur(${(eaten * 5).toFixed(1)}px)` : "";
        const dotsEl = el.querySelector<HTMLElement>("[data-dots]");
        if (dotsEl) dotsEl.style.opacity = (go * 0.85).toFixed(2);
      });

      /* the Fellow that arranges them */
      const curP = seg(p, 0.16, 0.32);
      setT(
        cur.current,
        lerp(vw * 0.34, mob ? vw * 0.3 : vw * 0.27, curP) + Math.sin(c.t * 1.2) * 3,
        lerp(vh * 0.8, vh * 0.3, curP) + Math.cos(c.t * 0.9) * 2.5,
        1
      );
      setVis(cur.current, seg(p, 0.14, 0.18) * (1 - seg(p, 0.36, 0.42)));

      const grp = seg(p, 0.24, 0.31) * (1 - seg(p, 0.36, 0.44));
      setVis(bracket.current, grp);
      setT(bracket.current, mob ? vw * 0.04 : vw * 0.028, vh * 0.08, 1);
      if (bracket.current) bracket.current.style.height = `${vh * (mob ? 0.8 : 0.84)}px`;

      setVis(caption.current, seg(p, 0.26, 0.33) * (1 - seg(p, 0.4, 0.47)));

      /* the result */
      const build = segL(p, 0.44, 0.62);
      setVis(out.current, seg(p, 0.44, 0.52) * (1 - seg(p, 0.965, 1)));
      const ox = mob ? vw * 0.06 : vw * 0.52;
      const oy = mob ? vh * 0.3 : vh * 0.12;
      setT(out.current, ox, oy + (1 - easeOut(clamp(build * 1.6))) * 34, 1);
      if (lead.current) lead.current.textContent = streamText(OUT_LEAD, segL(p, 0.5, 0.68));
      rows.current.forEach((r, i) => {
        if (!r) return;
        const rp = seg(p, 0.62 + i * 0.035, 0.71 + i * 0.035);
        setO(r, rp);
        setT(r, 0, (1 - rp) * 16, 1);
      });
      const doneP = seg(p, 0.86, 0.93);
      setVis(done.current, doneP * (1 - seg(p, 0.97, 1)));
      setT(done.current, 0, (1 - doneP) * 12, 1);

      /* prism direction */
      if (active) {
        const anticip = Math.sin(clamp(segL(p, 0.26, 0.36)) * Math.PI) * 0.06;
        const intake = Math.max(
          ...FRAGS.map((_, i) => Math.sin(clamp(segL(p, 0.4 + i * 0.045, 0.52 + i * 0.045)) * Math.PI))
        );
        prism.opacity = 1;
        prism.px = mob ? 0 : lerp(0.3, -0.3, seg(p, 0, 0.22));
        prism.py = mob ? lerp(-0.5, -0.62, seg(p, 0, 0.3)) : lerp(-0.14, 0.02, seg(p, 0, 0.3)) - seg(p, 0.9, 1) * 0.25;
        prism.scale = (mob ? 0.5 : 0.86) * (1 - anticip + intake * 0.05) * (1 - seg(p, 0.9, 1) * 0.2);
        prism.spin = 1 + intake * 2.2;
        prism.intake = clamp(intake);
        prism.charge = lerp(0.08, 0.72, seg(p, 0.34, 0.62)) * (1 - seg(p, 0.9, 1) * 0.3);
        prism.roll = seg(p, 0.2, 0.6) * 0.55;
        prism.tilt = -seg(p, 0.2, 0.6) * 0.1;

        field.intensity = lerp(0.5, 0.34, seg(p, 0.5, 0.9));
        field.density = 1;
        field.cell = 11;
        field.wave = 1 + intake * 1.6;
        field.speed = 1 + intake * 1.9;
        field.tint = lerp(0.9, 2, seg(p, 0.55, 0.8));
        field.pulse = intake * 0.9;
        field.clip = 0;
      }
    },
    2
  );

  return (
    <section ref={sec} style={{ height: "260vh", position: "relative" }}>
      <div className="stage">
        {/* grouping bracket drawn by the Fellow */}
        <div
          ref={bracket}
          className="pointer-events-none absolute top-0 left-0 z-20"
          style={{
            width: 14,
            borderLeft: "1px solid rgba(224,173,99,0.55)",
            borderTop: "1px solid rgba(224,173,99,0.55)",
            borderBottom: "1px solid rgba(224,173,99,0.55)",
            borderRadius: "3px 0 0 3px",
            visibility: "hidden",
          }}
        />
        <div
          ref={caption}
          className="absolute z-20 flex items-center gap-2"
          style={{ left: "clamp(20px, 5vw, 64px)", top: 26, visibility: "hidden" }}
        >
          <PrismMark size={14} state="work" />
          <span className="label">Method Fellow · grouping 5 fragments into one question</span>
        </div>

        {FRAGS.map((f, i) => (
          <div
            key={f.id}
            ref={(el) => {
              fragRefs.current[i] = el;
            }}
            className="frag surface absolute top-0 left-0 z-20 overflow-hidden"
            style={{ width: `min(${f.w}px, 78vw)`, padding: "12px 14px 14px", visibility: "hidden" }}
          >
            {f.body}
            <div
              data-dots
              className="dots dots-amber pointer-events-none absolute inset-0"
              style={{ opacity: 0, ["--dot-s" as string]: "5px", ["--dot-r" as string]: "0.9px" }}
            />
          </div>
        ))}

        <Cursor ref={cur} name="Method Fellow" color={PEOPLE.method.color} kind="fellow" />

        {/* the result on the visible side of the prism */}
        <div
          ref={out}
          className="frag surface absolute top-0 left-0 z-20"
          style={{ width: "min(560px, 88vw)", visibility: "hidden" }}
        >
          <div className="flex items-center gap-2.5 px-5 pt-4">
            <PrismMark size={16} state="done" />
            <span className="label">Result · assembled from 5 fragments</span>
            <span className="ml-auto flex items-center gap-1.5">
              <Avatar initials={PEOPLE.method.initials} color={PEOPLE.method.color} />
              <Avatar initials={PEOPLE.fellow.initials} color={PEOPLE.fellow.color} />
            </span>
          </div>
          <div className="px-5 pt-2 pb-4">
            <h3
              style={{ fontFamily: "var(--font-display)", fontSize: 26, lineHeight: 1.1, margin: "2px 0 10px" }}
            >
              Essay 2 — an approach you can argue
            </h3>
            <p className="serif-body" style={{ fontSize: 16.5, minHeight: 78 }}>
              <span ref={lead} />
            </p>

            <div className="mt-4 flex flex-col gap-2.5">
              {[
                <div className="flex gap-3" key="1">
                  <span className="meta" style={{ width: 58, flex: "none", paddingTop: 2 }}>
                    SPINE
                  </span>
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--paper-2)" }}>
                    1. Water as ledger · 2. Labour after corvée <Cite>Barak 2013, p. 74</Cite> · 3. Punjab as the
                    stated version of the Egyptian silence <Cite>Gilmartin 1994, p. 1129</Cite>
                  </div>
                </div>,
                <div className="flex gap-3" key="2">
                  <span className="meta" style={{ width: 58, flex: "none", paddingTop: 2 }}>
                    COUNTER
                  </span>
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--paper-2)" }}>
                    Built the strongest version of "infrastructure was merely fiscal" before you dismantle it.{" "}
                    <Chip tone="amber">from Dr. Adeyemi's feedback on Essay 1</Chip>
                  </div>
                </div>,
                <div className="flex gap-3" key="3">
                  <span className="meta" style={{ width: 58, flex: "none", paddingTop: 2 }}>
                    SOURCES
                  </span>
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--paper-2)" }}>
                    6 of your 14 items are load-bearing; 8 are duplicates of the same 1899 survey. The 1885/1887
                    discrepancy is flagged in §2, not hidden.
                  </div>
                </div>,
                <div className="flex gap-3" key="4">
                  <span className="meta" style={{ width: 58, flex: "none", paddingTop: 2 }}>
                    ORDER
                  </span>
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--paper-2)" }}>
                    Draft I by Mon 10 Nov, so the lab report on the 12th doesn't collide with it.{" "}
                    <Chip tone="sea">clash resolved</Chip>
                  </div>
                </div>,
              ].map((node, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    rows.current[i] = el;
                  }}
                  style={{ opacity: 0 }}
                >
                  {node}
                </div>
              ))}
            </div>
          </div>
          <div
            ref={done}
            className="flex items-center gap-2.5 px-5 py-3"
            style={{ borderTop: "1px solid var(--line)", background: "rgba(124,201,180,0.05)", opacity: 0 }}
          >
            <span
              className="dots dots-sea"
              style={{ width: 30, height: 8, ["--dot-s" as string]: "5px", ["--dot-r" as string]: "0.9px" }}
            />
            <span style={{ fontSize: 12.5, color: "#a9e0d1" }}>
              Throughline updated — every surface in this project now knows the scope is comparative.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
