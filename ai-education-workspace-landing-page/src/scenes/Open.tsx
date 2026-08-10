import { useRef } from "react";
import { useScene, useSectionRef, clamp, lerp, seg, segL, setO, setT, setVis, streamText, easeOut } from "../engine/ticker";
import { prism, field } from "../webgl/stage";
import { Avatar, Chip, Cite, Cursor, Icon, Logo, PEOPLE, PrismMark } from "../components/kit";

const HEAD_A = "Research, drafts and deadlines that stay ";
const TAIL_1 = "in one place.";
const TAIL_2 = "in conversation with each other.";
const SUB =
  "Verso is an AI-native workspace for students, educators and research teams. Fellows work inside the document with you, keep every source attached to the claim it supports, and carry a project's context from the first question to the final submission.";

export default function Open() {
  const sec = useSectionRef("open") as React.RefObject<HTMLElement>;
  const nav = useRef<HTMLDivElement>(null);
  const comp = useRef<HTMLDivElement>(null);
  const eyebrow = useRef<HTMLDivElement>(null);
  const headA = useRef<HTMLSpanElement>(null);
  const tail1 = useRef<HTMLSpanElement>(null);
  const tail2 = useRef<HTMLSpanElement>(null);
  const caret = useRef<HTMLSpanElement>(null);
  const sub = useRef<HTMLParagraphElement>(null);
  const cta = useRef<HTMLDivElement>(null);
  const cue = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const pin = useRef<HTMLDivElement>(null);
  const guide = useRef<HTMLDivElement>(null);
  const cMaya = useRef<HTMLDivElement>(null);
  const cFellow = useRef<HTMLDivElement>(null);
  const cTob = useRef<HTMLDivElement>(null);
  const t0 = useRef(-1);

  useScene(
    "open",
    (p, c) => {
      if (t0.current < 0) t0.current = c.t;
      const e = c.t - t0.current;
      const vw = c.vw;
      const vh = c.vh;
      const mob = c.mobile;
      const active = p < 0.9999;

      /* ---------- load: the surface wakes up ---------- */
      const boot = clamp(e / 1.1);
      const typeP = clamp((e - 0.55) / 2.5);
      // believable pacing: a hesitation after "deadlines"
      let tp = typeP;
      if (tp > 0.42 && tp < 0.5) tp = 0.42;
      const fullA = HEAD_A.length;
      const shown = Math.round(streamText(HEAD_A + TAIL_1, tp).length);

      /* ---------- act 2: the phrase is replaced ---------- */
      const selP = seg(p, 0.2, 0.28); // selection sweeps across the cliché
      const delP = segL(p, 0.29, 0.335); // deletion
      const wrP = segL(p, 0.35, 0.52); // fellow writes the replacement

      const t1Len = delP > 0 ? Math.round(TAIL_1.length * (1 - delP)) : Math.max(0, shown - fullA);
      if (headA.current) headA.current.textContent = HEAD_A.slice(0, Math.min(shown, fullA));
      if (tail1.current) {
        tail1.current.textContent = TAIL_1.slice(0, t1Len);
        tail1.current.style.backgroundSize = `${(selP * 100 * (1 - delP)).toFixed(1)}% 100%`;
      }
      const t2 = wrP > 0 ? streamText(TAIL_2, wrP) : "";
      if (tail2.current) tail2.current.textContent = t2;
      if (caret.current) {
        const typing = (tp > 0 && tp < 1) || (delP > 0 && wrP < 1);
        caret.current.style.opacity = typing || p < 0.06 ? "1" : "0";
        caret.current.style.background = wrP > 0 && wrP < 1 ? PEOPLE.fellow.color : "var(--amber)";
      }

      setO(eyebrow.current, clamp(boot * 1.2) * (1 - seg(p, 0.86, 1)));
      const subIn = clamp((e - 2.4) / 1.1);
      setO(sub.current, subIn * (1 - seg(p, 0.82, 0.98)));
      setO(cta.current, clamp((e - 3.0) / 1.0) * (1 - seg(p, 0.82, 0.98)));
      setO(cue.current, clamp((e - 3.6) / 1.2) * (1 - seg(p, 0.05, 0.16)));
      setO(nav.current, clamp((e - 0.2) / 0.9) * (1 - seg(p, 0.9, 1)));

      /* ---------- composition drift + hand-off ---------- */
      const out = seg(p, 0.78, 1);
      setT(comp.current, 0, -out * vh * 0.42 - seg(p, 0, 0.8) * 26, 1 - out * 0.04);
      // the CTA row yields when the fellow inserts a component beneath it
      const yieldY = seg(p, 0.55, 0.66) * (mob ? 84 : 96);
      setT(cta.current, 0, yieldY);

      /* ---------- the dragged-in component ---------- */
      // geometry of the drop target, in viewport px
      const colX = mob ? vw * 0.06 : vw * 0.075;
      const dropY = mob ? vh * 0.74 : vh * 0.635;
      const lift = seg(p, 0.5, 0.56);
      const travel = seg(p, 0.53, 0.68);
      const settle = seg(p, 0.66, 0.73);
      const alignFix = seg(p, 0.74, 0.8); // snaps to the text column's left edge
      const startX = vw * (mob ? 1.02 : 0.97);
      const startY = vh * (mob ? 1.05 : 0.9);
      const cx = lerp(startX, colX + (1 - alignFix) * 34, travel);
      const cy = lerp(startY, dropY, travel);
      const cs = 1 + lift * 0.035 - settle * 0.035;
      const crot = lerp(2.2, 0, travel) * (1 - settle * 0.6);
      setT(card.current, cx, cy - out * vh * 0.42, cs, crot);
      setVis(card.current, clamp(travel * 3) * (1 - out * 1.4));
      if (card.current)
        card.current.style.boxShadow = `0 ${(10 + lift * 34 - settle * 30).toFixed(0)}px ${(
          26 +
          lift * 60 -
          settle * 50
        ).toFixed(0)}px -18px rgba(0,0,0,${(0.5 + lift * 0.45).toFixed(2)})`;

      // alignment guide flashes at the moment of the snap
      setVis(guide.current, Math.sin(clamp(segL(p, 0.735, 0.815)) * Math.PI) * 0.9);
      if (guide.current) guide.current.style.left = `${colX}px`;

      /* ---------- reaction pin ---------- */
      const pinIn = seg(p, 0.845, 0.885);
      setVis(pin.current, pinIn * (1 - out * 1.5));
      setT(pin.current, colX + (mob ? 150 : 330), dropY - 18 - out * vh * 0.42, 0.9 + pinIn * 0.1);

      /* ---------- cursors: approach, act, pause, leave ---------- */
      const maya = {
        x: lerp(vw * 0.62, colX + (mob ? vw * 0.5 : 560), seg(p, 0.13, 0.22)),
        y: lerp(vh * 0.86, vh * (mob ? 0.44 : 0.475), seg(p, 0.13, 0.22)),
      };
      const mayaDrag = seg(p, 0.22, 0.285);
      setT(
        cMaya.current,
        maya.x - mayaDrag * (mob ? vw * 0.3 : 300) + Math.sin(c.t * 0.9) * 2,
        maya.y + Math.cos(c.t * 0.7) * 1.6,
        1
      );
      setVis(cMaya.current, seg(p, 0.11, 0.15) * (1 - seg(p, 0.33, 0.4)));

      const fx = lerp(colX + (mob ? vw * 0.2 : 250), colX + (mob ? vw * 0.55 : 660), seg(p, 0.35, 0.52));
      setT(
        cFellow.current,
        p < 0.5 ? fx : lerp(fx, startX * 0.92, seg(p, 0.5, 0.545)),
        p < 0.5
          ? vh * (mob ? 0.5 : 0.53) + Math.sin(c.t * 1.1) * 2
          : lerp(vh * (mob ? 0.5 : 0.53), lerp(startY, dropY, travel) - 6, seg(p, 0.5, 0.56)),
        1
      );
      setVis(cFellow.current, seg(p, 0.33, 0.37) * (1 - seg(p, 0.7, 0.76)));

      setT(
        cTob.current,
        colX + (mob ? 130 : 306) + Math.sin(c.t * 0.8) * 3,
        dropY - 4 + Math.cos(c.t * 0.6) * 2 - out * vh * 0.42,
        1
      );
      setVis(cTob.current, seg(p, 0.8, 0.845) * (1 - seg(p, 0.9, 0.95)));

      /* ---------- prism + field direction ---------- */
      if (active) {
        const bootS = easeOut(clamp(e / 1.6));
        prism.opacity = bootS;
        prism.px = mob ? 0 : lerp(0.47, 0.36, p) + c.nx * 0.012;
        prism.py = (mob ? -0.5 : -0.24) + p * 0.1 - out * 0.5 + c.ny * 0.01;
        prism.scale = (mob ? 0.6 : 0.94) * lerp(0.55, 1, bootS) * (1 + p * 0.06);
        prism.spin = 1;
        prism.charge = 0.05 + selP * 0.12 + (wrP > 0 && wrP < 1 ? 0.28 : 0);
        prism.intake = 0;
        prism.tilt = 0;
        prism.roll = 0;
        field.intensity = lerp(0, mob ? 0.42 : 0.58, easeOut(clamp(e / 2.2))) * (1 - out * 0.5);
        field.density = 1;
        field.cell = 11;
        field.wave = 1 - out * 0.3;
        field.speed = 1 + (wrP > 0 && wrP < 1 ? 0.5 : 0);
        field.tint = 0.35 + selP * 0.5;
        field.pulse = Math.sin(clamp(segL(p, 0.28, 0.35)) * Math.PI) * 0.5;
        field.clip = 0;
      }
    },
    1
  );

  return (
    <section ref={sec as React.RefObject<HTMLElement>} style={{ height: "320vh", position: "relative" }}>
      <div className="stage">
        {/* nav */}
        <div
          ref={nav}
          className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between"
          style={{ padding: "26px clamp(20px, 5vw, 64px)", opacity: 0 }}
        >
          <Logo size={19} />
          <nav className="hidden items-center gap-7 md:flex" style={{ fontSize: 13, color: "var(--paper-3)" }}>
            <span>Fellows</span>
            <span>For faculty</span>
            <span>Research</span>
            <span>Pricing</span>
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline" style={{ fontSize: 13, color: "var(--paper-3)" }}>
              Sign in
            </span>
            <button className="btn" style={{ height: 34, fontSize: 12.5 }}>
              Start a workspace
            </button>
          </div>
        </div>

        {/* composition */}
        <div
          ref={comp}
          className="absolute inset-0 z-20 flex flex-col justify-center"
          style={{ padding: "0 clamp(20px, 7.5vw, 118px)", willChange: "transform" }}
        >
          <div style={{ maxWidth: 940 }}>
            <div ref={eyebrow} className="mb-7 flex items-center gap-3" style={{ opacity: 0 }}>
              <span className="label">Workspace · study, research, teaching</span>
              <span
                className="dots dots-amber"
                style={{ width: 62, height: 6, ["--dot-s" as string]: "6px", ["--dot-r" as string]: "0.8px" }}
              />
            </div>
            <h1
              className="display"
              style={{
                fontSize: "clamp(34px, 5.4vw, 74px)",
                lineHeight: 0.99,
                maxWidth: "16ch",
                margin: 0,
              }}
            >
              <span ref={headA} />
              <span
                ref={tail1}
                style={{
                  backgroundImage: "linear-gradient(rgba(124,201,180,0.28), rgba(124,201,180,0.28))",
                  backgroundRepeat: "no-repeat",
                  backgroundSize: "0% 100%",
                  boxDecorationBreak: "clone",
                  WebkitBoxDecorationBreak: "clone",
                }}
              />
              <span ref={tail2} style={{ fontStyle: "italic", color: "var(--amber)" }} />
              <span ref={caret} className="caret" />
            </h1>
            <p ref={sub} className="body mt-8" style={{ maxWidth: 560, opacity: 0 }}>
              {SUB}
            </p>
            <div
              ref={cta}
              className="mt-9 flex flex-wrap items-center gap-3"
              style={{ willChange: "transform", opacity: 0 }}
            >
              <button className="btn btn-primary">
                Start a workspace
                <Icon name="arrow" size={14} />
              </button>
              <button className="btn">See a seminar in Verso</button>
            </div>
          </div>
        </div>

        {/* the component a Fellow drags in */}
        <div
          ref={card}
          className="frag surface absolute top-0 left-0 z-20"
          style={{ width: "min(560px, 86vw)", padding: "14px 16px 16px", visibility: "hidden" }}
        >
          <div className="flex items-center gap-2.5">
            <Avatar initials={PEOPLE.fellow.initials} color={PEOPLE.fellow.color} />
            <span style={{ fontSize: 12.5, color: "var(--paper)" }}>Source Fellow</span>
            <span className="label">HIST 342 · Water &amp; Empire</span>
            <span className="ml-auto">
              <PrismMark size={15} state="done" />
            </span>
          </div>
          <p className="mt-2.5" style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--paper-2)" }}>
            Willcocks dates the first perennial canal to 1885 <Cite>Willcocks 1899, p. 112</Cite>; the gauge table in
            your reader says 1887. I've flagged the discrepancy in your notes and left the earlier date in the draft.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip tone="sea" icon={<Icon name="link" size={11} />}>
              attached to §2 Chronology
            </Chip>
            <Chip icon={<Icon name="clock" size={11} />}>2 min ago</Chip>
          </div>
        </div>

        {/* alignment guide */}
        <div
          ref={guide}
          className="pointer-events-none absolute top-0 z-30"
          style={{
            width: 1,
            height: "100%",
            background: "linear-gradient(180deg, transparent, rgba(224,173,99,0.75) 30%, rgba(224,173,99,0.75) 70%, transparent)",
            visibility: "hidden",
          }}
        />

        {/* reaction pin */}
        <div
          ref={pin}
          className="frag absolute top-0 left-0 z-30 flex items-center gap-2"
          style={{
            padding: "6px 10px",
            borderRadius: "3px 12px 12px 12px",
            background: "rgba(167,154,214,0.16)",
            border: "1px solid rgba(167,154,214,0.4)",
            backdropFilter: "blur(8px)",
            visibility: "hidden",
          }}
        >
          <Avatar initials={PEOPLE.tobias.initials} color={PEOPLE.tobias.color} />
          <span style={{ fontSize: 12, color: "var(--paper-2)" }}>Open with this in Thursday's seminar.</span>
        </div>

        <Cursor ref={cMaya} name="Maya R." color={PEOPLE.maya.color} />
        <Cursor ref={cFellow} name="Source Fellow" color={PEOPLE.fellow.color} kind="fellow" />
        <Cursor ref={cTob} name="Dr. Adeyemi" color={PEOPLE.tobias.color} />

        {/* scroll cue */}
        <div
          ref={cue}
          className="absolute bottom-8 z-30 flex items-center gap-3"
          style={{ left: "clamp(20px, 7.5vw, 118px)" }}
        >
          <span
            className="dots dots-drift"
            style={{ width: 44, height: 5, ["--dot-s" as string]: "5px", ["--dot-r" as string]: "0.7px" }}
          />
          <span className="label">Scroll — this page is still being written</span>
        </div>
      </div>
    </section>
  );
}
