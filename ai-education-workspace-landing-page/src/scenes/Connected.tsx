import { useRef } from "react";
import { useScene, useSectionRef, clamp, lerp, seg, segL, setO, setT, setVis, streamText, easeOut } from "../engine/ticker";
import { prism, field } from "../webgl/stage";
import { Avatar, Chip, Cite, Icon, PEOPLE, PrismMark } from "../components/kit";

const MSG = "Compare Egypt with Punjab. Two systems, one argument — don't write two essays.";
const H2 = "Case II · Punjab canal colonies, 1885–1901";

export default function Connected() {
  const sec = useSectionRef("connected");
  const thread = useRef<HTMLDivElement>(null);
  const doc = useRef<HTMLDivElement>(null);
  const plan = useRef<HTMLDivElement>(null);
  const msg = useRef<HTMLSpanElement>(null);
  const msgBox = useRef<HTMLDivElement>(null);
  const h2 = useRef<HTMLSpanElement>(null);
  const h2old = useRef<HTMLSpanElement>(null);
  const fly = useRef<HTMLDivElement>(null);
  const landed = useRef<HTMLSpanElement>(null);
  const tailTxt = useRef<HTMLSpanElement>(null);
  const newRow = useRef<HTMLDivElement>(null);
  const planRows = useRef<(HTMLDivElement | null)[]>([]);
  const clash = useRef<HTMLDivElement>(null);
  const memory = useRef<HTMLDivElement>(null);
  const applied = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLDivElement>(null);

  useScene(
    "connected",
    (p, c) => {
      const { vw, vh, mobile: mob } = c;
      const active = p > 0.0001 && p < 0.9999;

      const W = { t: mob ? vw * 0.88 : 330, d: mob ? vw * 0.92 : 470, p: mob ? vw * 0.8 : 320 };
      const pos = mob
        ? {
            t: { x: vw * 0.06, y: vh * 0.1 },
            d: { x: vw * 0.04, y: vh * 0.32 },
            p: { x: vw * 0.12, y: vh * 0.74 },
          }
        : {
            t: { x: vw * 0.035, y: vh * 0.235 },
            d: { x: vw * 0.28, y: vh * 0.11 },
            p: { x: vw * 0.7, y: vh * 0.3 },
          };

      const enter = (d: number) => easeOut(seg(p, 0.01 + d, 0.16 + d));
      const outP = seg(p, 0.9, 1);
      const drift = Math.sin(c.t * 0.4) * 3;

      setT(thread.current, pos.t.x - (1 - enter(0)) * 40, pos.t.y + (1 - enter(0)) * 30 + drift - outP * 60, lerp(0.96, 1, enter(0)));
      setO(thread.current, enter(0) * (1 - outP));
      setT(doc.current, pos.d.x, pos.d.y + (1 - enter(0.03)) * 40 - drift * 0.6 - outP * 90, lerp(0.97, 1, enter(0.03)));
      setO(doc.current, enter(0.03) * (1 - outP));
      setT(plan.current, pos.p.x + (1 - enter(0.06)) * 40, pos.p.y + (1 - enter(0.06)) * 26 + drift * 0.8 - outP * 40, lerp(0.96, 1, enter(0.06)));
      setO(plan.current, enter(0.06) * (1 - outP));
      setO(title.current, seg(p, 0.02, 0.12) * (1 - seg(p, 0.86, 0.96)));

      /* 1 — a decision is made in the thread */
      const mp = segL(p, 0.14, 0.28);
      if (msg.current) msg.current.textContent = streamText(MSG, mp);
      setO(msgBox.current, clamp(mp * 6));
      if (msgBox.current) msgBox.current.style.transform = `translateY(${((1 - clamp(mp * 4)) * 10).toFixed(1)}px)`;

      /* 2 — the document heading rewrites itself */
      const hp = segL(p, 0.3, 0.42);
      if (h2old.current) {
        h2old.current.style.opacity = (1 - clamp(hp * 3)).toFixed(2);
        h2old.current.style.filter = `blur(${(clamp(hp * 3) * 3).toFixed(1)}px)`;
      }
      if (h2.current) h2.current.textContent = streamText(H2, hp);

      /* 3 — a citation physically carries across */
      const fp = seg(p, 0.44, 0.58);
      const fromX = pos.t.x + W.t * 0.52;
      const fromY = pos.t.y + 214;
      const toX = pos.d.x + (mob ? W.d * 0.3 : 214);
      const toY = pos.d.y + (mob ? 232 : 246);
      const arc = Math.sin(fp * Math.PI) * (mob ? 40 : -64);
      setT(fly.current, lerp(fromX, toX, fp), lerp(fromY, toY, fp) + arc - outP * 70, lerp(1, 0.92, fp));
      setVis(fly.current, clamp(seg(p, 0.43, 0.47) * 1) * (1 - seg(p, 0.565, 0.6)));
      const land = seg(p, 0.57, 0.63);
      setVis(landed.current, land);
      if (landed.current) landed.current.style.transform = `scale(${lerp(0.86, 1, land)})`;
      // the sentence yields around the inserted citation
      if (tailTxt.current) tailTxt.current.style.opacity = (0.35 + 0.65 * land).toFixed(2);

      /* 4 — the plan absorbs the consequence */
      const rp = seg(p, 0.6, 0.7);
      setVis(newRow.current, rp);
      if (newRow.current) {
        newRow.current.style.height = `${(rp * 30).toFixed(1)}px`;
        newRow.current.style.transform = `translateX(${((1 - rp) * -12).toFixed(1)}px)`;
      }
      planRows.current.forEach((r, i) => {
        if (!r) return;
        const shift = i >= 1 ? rp * 30 : 0;
        const move = i === 1 ? seg(p, 0.71, 0.79) : 0;
        setT(r, 0, shift - move * 30, 1);
      });
      const fixed = seg(p, 0.73, 0.81);
      if (clash.current) {
        clash.current.style.opacity = "1";
        clash.current.textContent = fixed > 0.5 ? "sequenced" : "clash";
        clash.current.className = `chip ${fixed > 0.5 ? "chip-sea" : "chip-rose"}`;
      }

      /* 5 — the decision is remembered where it matters */
      const mem = seg(p, 0.8, 0.88);
      setVis(memory.current, mem * (1 - outP));
      setT(memory.current, (1 - mem) * 14, 0, 1);
      setVis(applied.current, seg(p, 0.84, 0.92) * (1 - outP));

      if (active) {
        prism.opacity = 0.5;
        prism.px = mob ? 0.55 : 0.86;
        prism.py = mob ? -0.78 : -0.72;
        prism.scale = mob ? 0.26 : 0.34;
        prism.spin = 0.6;
        prism.intake = 0;
        prism.charge = 0.3 + Math.sin(c.t * 0.5) * 0.06;
        prism.roll = 0;
        prism.tilt = 0;
        field.intensity = 0.3;
        field.density = 0.85;
        field.cell = 12;
        field.wave = 0.6;
        field.speed = 0.7;
        field.tint = 1.6;
        field.pulse = Math.sin(clamp(segL(p, 0.55, 0.66)) * Math.PI) * 0.35;
        field.clip = 0;
      }
    },
    3
  );

  return (
    <section ref={sec} style={{ height: "220vh", position: "relative" }}>
      <div className="stage">
        <div
          ref={title}
          className="absolute z-30 flex items-center gap-3"
          style={{ left: "clamp(20px, 5vw, 64px)", top: 26 }}
        >
          <PrismMark size={14} state="work" />
          <span className="label">Nothing here has to be explained twice</span>
        </div>

        {/* THREAD */}
        <div
          ref={thread}
          className="frag surface absolute top-0 left-0 z-20"
          style={{ width: "min(330px, 88vw)", opacity: 0 }}
        >
          <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5" style={{ borderBottom: "1px solid var(--line)" }}>
            <Icon name="thread" size={13} />
            <span style={{ fontSize: 12.5 }}>Scope &amp; sources</span>
            <span className="label ml-auto">3 in thread</span>
          </div>
          <div className="flex flex-col gap-3 p-4">
            <div className="thread-msg">
              <div className="mb-1.5 flex items-center gap-2">
                <Avatar initials={PEOPLE.naima.initials} color={PEOPLE.naima.color} />
                <span style={{ fontSize: 12 }}>Naima</span>
                <span className="meta ml-auto">14:18</span>
              </div>
              <p style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--paper-2)" }}>
                The brief doesn't say whether it wants one case or a comparison. I've drafted Egypt only.
              </p>
            </div>
            <div ref={msgBox} className="thread-msg" style={{ borderColor: "rgba(167,154,214,0.3)", opacity: 0 }}>
              <div className="mb-1.5 flex items-center gap-2">
                <Avatar initials={PEOPLE.tobias.initials} color={PEOPLE.tobias.color} />
                <span style={{ fontSize: 12 }}>Dr. Adeyemi</span>
                <span className="meta ml-auto">14:22</span>
              </div>
              <p style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--paper-2)" }}>
                <span ref={msg} />
              </p>
              <div ref={applied} className="mt-2.5 flex items-center gap-2" style={{ opacity: 0 }}>
                <span
                  className="dots dots-amber"
                  style={{ width: 22, height: 7, ["--dot-s" as string]: "5px", ["--dot-r" as string]: "0.8px" }}
                />
                <span className="meta" style={{ color: "var(--amber)" }}>
                  applied in 3 places
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* DOCUMENT */}
        <div
          ref={doc}
          className="frag surface absolute top-0 left-0 z-20"
          style={{ width: "min(470px, 92vw)", opacity: 0 }}
        >
          <div className="flex items-center gap-2 px-5 pt-4 pb-2" style={{ color: "var(--paper-3)" }}>
            <Icon name="doc" size={13} />
            <span className="label">Essay 2 · draft</span>
            <span className="ml-auto flex -space-x-1.5">
              <Avatar initials={PEOPLE.naima.initials} color={PEOPLE.naima.color} />
              <Avatar initials={PEOPLE.maya.initials} color={PEOPLE.maya.color} />
            </span>
          </div>
          <div className="px-5 pb-5">
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, lineHeight: 1.15, minHeight: 30 }}>
              <span ref={h2old} style={{ color: "var(--paper-4)" }}>
                Case II · to be decided
              </span>
              <span ref={h2} style={{ position: "relative", marginLeft: -0.5 }} />
            </div>
            <p className="serif-body mt-3" style={{ fontSize: 16 }}>
              The Punjab administration never pretended the canals were only about water. Colonisation officers wrote
              the settlement schedule and the irrigation schedule on the same page{" "}
              <span ref={landed} style={{ display: "inline-block", visibility: "hidden" }}>
                <Cite>Gilmartin 1994, p. 1129</Cite>
              </span>
              <span ref={tailTxt}>
                , which is exactly the admission Egypt withholds.
              </span>
            </p>
            <div
              ref={memory}
              className="mt-4 flex items-start gap-2.5"
              style={{
                borderLeft: "2px solid rgba(224,173,99,0.5)",
                paddingLeft: 11,
                opacity: 0,
              }}
            >
              <div>
                <div className="label" style={{ color: "var(--amber)" }}>
                  Remembered
                </div>
                <div className="mt-1" style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--paper-2)" }}>
                  Scope is comparative — decided with Dr. Adeyemi at 14:22. Verso won't ask you again, and the reading
                  list, the outline and Friday's plan already assume it.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* PLAN */}
        <div
          ref={plan}
          className="frag surface absolute top-0 left-0 z-20"
          style={{ width: "min(320px, 80vw)", opacity: 0 }}
        >
          <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5" style={{ borderBottom: "1px solid var(--line)" }}>
            <Icon name="plan" size={13} />
            <span style={{ fontSize: 12.5 }}>Week of 10 Nov</span>
            <span ref={clash} className="chip chip-rose ml-auto">
              clash
            </span>
          </div>
          <div className="p-4">
            <div
              ref={newRow}
              className="overflow-hidden"
              style={{ height: 0, visibility: "hidden" }}
            >
              <div className="flex items-center gap-2 pb-2">
                <span className="meta" style={{ width: 52 }}>
                  Sun 9
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: "#f0cf9d",
                    borderLeft: "2px solid var(--amber)",
                    paddingLeft: 8,
                  }}
                >
                  Punjab sources — 2 sessions
                </span>
              </div>
            </div>
            {[
              ["Mon 10", "Draft I — Egypt + Punjab", "amber"],
              ["Wed 12", "BIOL 214 lab report", ""],
              ["Thu 13", "Seminar prep", ""],
              ["Fri 14", "Essay 2 due", "sea"],
            ].map(([d, t, tone], i) => (
              <div
                key={d}
                ref={(el) => {
                  planRows.current[i] = el;
                }}
                className="flex items-center gap-2 pb-2"
              >
                <span className="meta" style={{ width: 52, flex: "none" }}>
                  {d}
                </span>
                <span
                  className="truncate"
                  style={{
                    fontSize: 12,
                    color: tone === "amber" ? "#f0cf9d" : tone === "sea" ? "#a9e0d1" : "var(--paper-2)",
                    borderLeft: `2px solid ${
                      tone === "amber" ? "var(--amber)" : tone === "sea" ? "var(--sea)" : "var(--line-strong)"
                    }`,
                    paddingLeft: 8,
                  }}
                >
                  {t}
                </span>
              </div>
            ))}
            <div className="meta mt-1.5" style={{ color: "var(--paper-4)" }}>
              Draft I moved earlier — the lab report keeps Wednesday.
            </div>
          </div>
        </div>

        {/* the citation in transit */}
        <div ref={fly} className="frag absolute top-0 left-0 z-30" style={{ visibility: "hidden" }}>
          <div className="flex items-center gap-2">
            <Cite>Gilmartin 1994, p. 1129</Cite>
            <Chip tone="sea">carried with its page</Chip>
          </div>
        </div>
      </div>
    </section>
  );
}
