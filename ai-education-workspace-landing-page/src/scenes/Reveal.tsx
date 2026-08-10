import { useRef, useState } from "react";
import { useScene, useSectionRef, clamp, lerp, seg, setO, setT, setVis, streamText, easeOut, easeInOut } from "../engine/ticker";
import { prism, field } from "../webgl/stage";
import { Avatar, Chip, Cursor, Icon, Logo, PEOPLE, PrismMark } from "../components/kit";
import { PageSurface } from "./PageSurface";
import { UndercurrentBar, type CurrentDef } from "./Undercurrent";

const SHELL_CURRENTS: CurrentDef[] = [
  {
    id: "page",
    who: "fellow",
    title: "Building the launch page · section 6 of 8",
    state: "running",
    detail: "",
    progress: 0.74,
  },
  {
    id: "copy",
    who: "method",
    title: "Two lines of copy need your review",
    state: "waiting",
    detail: "",
    progress: 0.95,
  },
  {
    id: "read",
    who: "fellow",
    title: "Reading 14 items on corvée labour",
    state: "running",
    detail: "",
    progress: 0.84,
  },
  { id: "slides", who: "method", title: "Slide outline", state: "done", detail: "", progress: 1 },
];

const REPLY =
  "Section 6 rebuilt: the Undercurrent shows a live current instead of a screenshot. Two lines still need your review.";

const SPACES = [
  ["doc", "Water & Empire — HIST 342", true],
  ["source", "Aral Sea Basin — thesis", false],
  ["people", "Methods seminar — teaching", false],
  ["board", "BIOL 214 lab notebook", false],
  ["plan", "Meltwater Archive — grant", false],
] as const;

export default function Reveal() {
  const sec = useSectionRef("reveal");
  const amb = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const sidebar = useRef<HTMLDivElement>(null);
  const topbar = useRef<HTMLDivElement>(null);
  const threadCol = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const pageCol = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const selection = useRef<HTMLDivElement>(null);
  const selTag = useRef<HTMLDivElement>(null);
  const clueV = useRef<HTMLDivElement>(null);
  const clueH = useRef<HTMLDivElement>(null);
  const clueHandle = useRef<HTMLDivElement>(null);
  const vign = useRef<HTMLDivElement>(null);
  const outsideCur = useRef<HTMLDivElement>(null);
  const pageCur = useRef<HTMLDivElement>(null);
  const reply = useRef<HTMLSpanElement>(null);
  const replyBox = useRef<HTMLDivElement>(null);
  const presence = useRef<(HTMLDivElement | null)[]>([]);
  const prismSlot = useRef<HTMLDivElement>(null);
  const size = useRef({ w: 560, h: 640, x: 0, y: 0 });
  const pwRef = useRef(560);
  const colHRef = useRef(0);
  const lastVW = useRef(0);
  const [pw, setPw] = useState(560);

  useScene(
    "reveal",
    (p, c) => {
      const { vw, vh, mobile: mob } = c;
      const active = p > 0.0001;

      /* --- measure the destination slot inside the product --- */
      const r = slot.current?.getBoundingClientRect();
      if (r && r.width > 10) {
        size.current = { w: r.width, h: r.height, x: r.left, y: r.top };
      }
      const S = size.current;
      if (Math.abs(S.w - pwRef.current) > 2) {
        pwRef.current = S.w;
        setPw(Math.round(S.w));
      }
      if (colHRef.current < 10 || lastVW.current !== vw) {
        lastVW.current = vw;
        colHRef.current = pageCol.current?.offsetHeight ?? 1800;
      }
      if (panel.current) {
        if (panel.current.style.width !== `${Math.round(S.w)}px`) {
          panel.current.style.width = `${Math.round(S.w)}px`;
          panel.current.style.height = `${Math.round(S.h)}px`;
        }
      }

      /* --- camera: from inside the page, back into the room --- */
      const pull = easeInOut(seg(p, 0.14, 0.6));
      const s0 = Math.min(3.1, Math.max(vw / S.w, (vh * 1.02) / S.h) * 1.03);
      const sc = lerp(s0, 1, pull);
      const x = lerp(vw / 2 - (S.w * s0) / 2, S.x, pull);
      const y = lerp(vh / 2 - (S.h * s0) / 2, S.y, pull);
      if (panel.current) {
        panel.current.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${sc.toFixed(4)})`;
        panel.current.style.borderRadius = `${(10 / sc).toFixed(2)}px`;
        panel.current.style.boxShadow = `0 ${(60 * pull).toFixed(0)}px ${(120 * pull).toFixed(
          0
        )}px -40px rgba(0,0,0,${(0.9 * pull).toFixed(2)})`;
        panel.current.style.borderColor = `rgba(233,226,212,${(0.1 * pull).toFixed(3)})`;
      }

      /* --- the page column scrolls: we were reading its last section --- */
      const bottom = -(colHRef.current - S.h);
      const drift = Math.sin(c.t * 0.22) * 10 - 10;
      const innerY = lerp(bottom, 0, easeOut(seg(p, 0.16, 0.66))) + seg(p, 0.7, 1) * drift;
      setT(pageCol.current, 0, innerY, 1);

      /* --- act 7: clues that a parent surface exists --- */
      const clue = seg(p, 0.03, 0.1) * (1 - seg(p, 0.3, 0.42));
      setVis(clueV.current, clue * 0.85);
      setVis(clueH.current, seg(p, 0.06, 0.13) * (1 - seg(p, 0.3, 0.42)) * 0.6);
      setVis(clueHandle.current, seg(p, 0.08, 0.12) * (1 - seg(p, 0.24, 0.34)));
      if (clueHandle.current)
        clueHandle.current.style.transform = `translateY(${(Math.sin(c.t * 1.6) * 2).toFixed(1)}px)`;
      setO(vign.current, seg(p, 0.02, 0.16) * 0.7 + pull * 0.3);

      const oc = seg(p, 0.05, 0.2);
      setVis(outsideCur.current, seg(p, 0.045, 0.08) * (1 - seg(p, 0.22, 0.3)));
      setT(
        outsideCur.current,
        lerp(vw * 1.02, vw * 0.88, oc) + Math.sin(c.t * 0.9) * 4,
        lerp(vh * 0.7, vh * 0.42, oc) + Math.cos(c.t * 0.7) * 6,
        1
      );

      /* --- act 8: the interface materialises, layer by layer --- */
      const layer = (a: number, b: number) => easeOut(seg(p, a, b));
      const lShell = layer(0.22, 0.4);
      const lSide = layer(0.3, 0.48);
      const lTop = layer(0.34, 0.5);
      const lThread = layer(0.38, 0.56);
      const lRail = layer(0.42, 0.6);

      setO(amb.current, lShell * 0.9);
      if (shell.current) {
        shell.current.style.opacity = lShell.toFixed(3);
        const os = lerp(1.035, 1, easeInOut(seg(p, 0.2, 0.62)));
        shell.current.style.transform = `translate3d(0, ${((1 - lShell) * 14).toFixed(1)}px, 0) scale(${os.toFixed(4)})`;
      }
      const mat = (el: HTMLElement | null, l: number, dx: number, dy: number) => {
        if (!el) return;
        el.style.opacity = l.toFixed(3);
        el.style.transform = `translate3d(${(dx * (1 - l)).toFixed(1)}px, ${(dy * (1 - l)).toFixed(1)}px, 0)`;
        el.style.filter = l < 0.99 ? `blur(${((1 - l) * 7).toFixed(2)}px)` : "";
      };
      mat(sidebar.current, lSide, -26, 0);
      mat(topbar.current, lTop, 0, -16);
      mat(threadCol.current, lThread, 30, 0);
      mat(rail.current, lRail, 0, 26);
      setO(toolbar.current, layer(0.56, 0.66));

      presence.current.forEach((el, i) => {
        const l = layer(0.56 + i * 0.03, 0.64 + i * 0.03);
        if (!el) return;
        el.style.opacity = l.toFixed(2);
        el.style.transform = `scale(${lerp(0.4, 1, l).toFixed(3)})`;
      });

      /* --- the thread that made this page --- */
      const rp = seg(p, 0.62, 0.8);
      setO(replyBox.current, clamp(rp * 8));
      if (reply.current) reply.current.textContent = streamText(REPLY, rp);

      /* --- a collaborator works on the page, inside the product --- */
      const cp = seg(p, 0.74, 0.84);
      setVis(pageCur.current, seg(p, 0.72, 0.76) * (1 - seg(p, 0.95, 1)));
      setT(
        pageCur.current,
        lerp(S.x + S.w * 1.3, S.x + S.w * 0.52, cp) + Math.sin(c.t * 0.8) * 2,
        lerp(S.y + S.h * 0.8, S.y + 132, cp) + Math.cos(c.t * 0.6) * 2,
        1
      );
      const sel = seg(p, 0.82, 0.89);
      setVis(selection.current, sel * (1 - seg(p, 0.97, 1)));
      setVis(selTag.current, seg(p, 0.85, 0.91) * (1 - seg(p, 0.97, 1)));
      if (selection.current) {
        selection.current.style.left = `${(S.x + 18).toFixed(0)}px`;
        selection.current.style.top = `${(S.y + 74 + innerY).toFixed(0)}px`;
        selection.current.style.width = `${(S.w - 36).toFixed(0)}px`;
        selection.current.style.height = "128px";
      }
      if (selTag.current) {
        selTag.current.style.left = `${(S.x + 18).toFixed(0)}px`;
        selTag.current.style.top = `${(S.y + 74 + innerY - 20).toFixed(0)}px`;
      }

      /* --- prism: ignites inside the product's activity rail --- */
      if (active) {
        const pr = prismSlot.current?.getBoundingClientRect();
        const ignite = seg(p, 0.52, 0.66);
        prism.opacity = ignite;
        if (pr && pr.width > 4) {
          prism.px = ((pr.left + pr.width / 2) / vw) * 2 - 1;
          prism.py = ((pr.top + pr.height / 2) / vh) * 2 - 1;
        }
        prism.scale = (mob ? 0.04 : 0.05) * lerp(1.5, 1, ignite);
        prism.spin = 1.2;
        prism.intake = 0;
        prism.charge = 0.5 + Math.sin(c.t * 1.2) * 0.14;
        prism.roll = 0;
        prism.tilt = 0;

        // the dot field is clipped first by the page, then by the product's canvas
        const wa = slot.current?.parentElement?.getBoundingClientRect();
        const target = pull < 0.5 ? { l: S.x, t: S.y, w: S.w, h: S.h } : wa
          ? { l: wa.left, t: wa.top, w: wa.width, h: wa.height }
          : { l: S.x, t: S.y, w: S.w, h: S.h };
        const k = easeInOut(seg(p, 0.34, 0.62));
        const l0 = lerp(vw / 2 - (S.w * s0) / 2, target.l, Math.max(pull, k));
        const t0 = lerp(vh / 2 - (S.h * s0) / 2, target.t, Math.max(pull, k));
        const w0 = lerp(S.w * s0, target.w, Math.max(pull, k));
        const h0 = lerp(S.h * s0, target.h, Math.max(pull, k));
        field.clipRect = [l0 / vw, t0 / vh, (l0 + w0) / vw, (t0 + h0) / vh];
        field.clip = seg(p, 0.03, 0.16);
        field.intensity = lerp(0.4, 0.5, pull);
        field.density = 0.9;
        field.cell = 10;
        field.wave = 0.5;
        field.speed = 0.7;
        field.tint = 0.9;
        field.pulse = 0;
      }
    },
    6
  );

  return (
    <section ref={sec} style={{ height: "360vh", position: "relative" }}>
      <div className="stage" style={{ perspective: "1600px" }}>
        {/* ambient room light behind the product */}
        <div
          ref={amb}
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            opacity: 0,
            background:
              "radial-gradient(120% 80% at 50% -10%, rgba(224,173,99,0.09), transparent 60%), radial-gradient(90% 70% at 20% 110%, rgba(124,201,180,0.06), transparent 60%)",
          }}
        />

        {/* ---------------- the product shell ---------------- */}
        <div
          ref={shell}
          className="absolute z-10 flex flex-col overflow-hidden"
          style={{
            inset: "clamp(8px, 1.6vh, 20px) clamp(8px, 1.4vw, 22px)",
            borderRadius: 16,
            border: "1px solid var(--line-strong)",
            background: "transparent",
            boxShadow: "var(--shadow-deep)",
            opacity: 0,
          }}
        >
          {/* top bar */}
          <div
            ref={topbar}
            className="flex items-center gap-3 px-4"
            style={{
              height: 46,
              borderBottom: "1px solid var(--line)",
              flex: "none",
              background: "linear-gradient(180deg, #141715, #101311)",
            }}
          >
            <div className="flex items-center gap-2" style={{ color: "var(--paper-3)" }}>
              <Icon name="board" size={13} />
              <span style={{ fontSize: 12, color: "var(--paper-2)" }}>Water &amp; Empire</span>
              <span style={{ color: "var(--paper-4)" }}>/</span>
              <span style={{ fontSize: 12 }}>Launch page</span>
              <Chip>surface</Chip>
            </div>
            <div className="ml-auto flex items-center gap-2.5">
              <div className="hidden items-center gap-1.5 sm:flex">
                {[PEOPLE.naima, PEOPLE.maya, PEOPLE.tobias].map((pp, i) => (
                  <div
                    key={pp.name}
                    ref={(el) => {
                      presence.current[i] = el;
                    }}
                    style={{ opacity: 0 }}
                  >
                    <Avatar initials={pp.initials} color={pp.color} />
                  </div>
                ))}
              </div>
              <span className="chip">
                <Icon name="people" size={11} /> Share
              </span>
              <button className="btn btn-primary" style={{ height: 28, fontSize: 12, padding: "0 12px" }}>
                Start a workspace
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            {/* sidebar */}
            <div
              ref={sidebar}
              className="hidden flex-col md:flex"
              style={{
                width: 236,
                borderRight: "1px solid var(--line)",
                flex: "none",
                opacity: 0,
                background: "linear-gradient(180deg, #12150f0d, #0d100e), #101311",
              }}
            >
              <div className="flex items-center gap-2 px-3.5 py-3.5">
                <Logo size={15} />
                <span className="chip ml-auto">Adeyemi Group</span>
              </div>
              <div className="px-3.5">
                <div
                  className="flex items-center gap-2 px-2.5"
                  style={{
                    height: 30,
                    borderRadius: 7,
                    border: "1px solid var(--line)",
                    background: "rgba(236,230,218,0.03)",
                    color: "var(--paper-4)",
                  }}
                >
                  <Icon name="search" size={12} />
                  <span style={{ fontSize: 11.5 }}>Ask across everything</span>
                  <span className="meta ml-auto">⌘K</span>
                </div>
              </div>
              <div className="mt-5 px-3.5">
                <span className="label">Spaces</span>
                <div className="mt-2 flex flex-col gap-0.5">
                  {SPACES.map(([ic, name, act]) => (
                    <div key={name} className="nav-item" data-active={act}>
                      <span style={{ color: act ? "var(--amber)" : "var(--paper-4)" }}>
                        <Icon name={ic} size={13} />
                      </span>
                      <span className="truncate">{name}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-5 px-3.5">
                <span className="label">Fellows</span>
                <div className="mt-2 flex flex-col gap-0.5">
                  {[
                    ["Source Fellow", "var(--amber)", "reading"],
                    ["Method Fellow", "var(--rose)", "needs you"],
                    ["Reader", "rgba(236,230,218,0.3)", "idle"],
                  ].map(([n, col, st]) => (
                    <div key={n} className="nav-item">
                      <PrismMark size={13} state={st === "reading" ? "work" : st === "needs you" ? "wait" : "idle"} />
                      <span className="truncate">{n}</span>
                      <span className="meta ml-auto" style={{ color: col, fontSize: 9.5 }}>
                        {st}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-auto flex items-center gap-2 px-3.5 py-3.5" style={{ borderTop: "1px solid var(--line)" }}>
                <Avatar initials="NO" color={PEOPLE.naima.color} />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate" style={{ fontSize: 12 }}>
                    Naima Okonjo
                  </span>
                  <span className="meta">Year 3 · History</span>
                </div>
              </div>
            </div>

            {/* work area */}
            <div
              className="relative flex min-w-0 flex-1 items-stretch justify-center"
              style={{
                padding: "26px 18px 18px",
                background:
                  "radial-gradient(130% 100% at 50% 0%, rgba(236,230,218,0.035), rgba(236,230,218,0) 70%)",
              }}
            >
              {/* the surface's own toolbar (only ever visible once you can see the product) */}
              <div
                ref={toolbar}
                className="absolute z-20 flex items-center gap-2"
                style={{ top: 6, left: "50%", transform: "translateX(-50%)", opacity: 0 }}
              >
                <span className="label">Launch page · tall surface</span>
                <span className="chip">62%</span>
                <span className="chip chip-amber">Fellow editing</span>
              </div>
              {/* destination slot — the page lands exactly here */}
              <div ref={slot} style={{ width: "min(560px, 100%)", height: "100%" }} />
            </div>

            {/* thread */}
            <div
              ref={threadCol}
              className="hidden flex-col lg:flex"
              style={{
                width: 336,
                borderLeft: "1px solid var(--line)",
                flex: "none",
                opacity: 0,
                background: "#101311",
              }}
            >
              <div
                className="flex items-center gap-2 px-4"
                style={{ height: 42, borderBottom: "1px solid var(--line)", flex: "none" }}
              >
                <Icon name="thread" size={13} />
                <span style={{ fontSize: 12.5 }}>Launch page</span>
                <span className="label ml-auto">4 messages</span>
              </div>
              <div className="flex flex-1 flex-col gap-2.5 overflow-hidden p-3.5">
                <Msg who={PEOPLE.naima} time="09:12">
                  Build the launch page from the product story doc. The prism is the only ornament — no stock imagery,
                  no floating screenshots.
                </Msg>
                <Msg who={PEOPLE.fellow} time="09:12" fellow>
                  Working. I'll use HIST 342 as the running example — it's the project with real sources attached.
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Chip tone="amber">reading product story · 12 sections</Chip>
                  </div>
                </Msg>
                <Msg who={PEOPLE.maya} time="10:04">
                  Replaced “in one place” in the headline. We don't say that.
                  <div className="mt-2 flex items-center gap-1.5" style={{ fontSize: 11.5 }}>
                    <span className="del">in one place</span>
                    <Icon name="arrow" size={11} />
                    <span className="ins" style={{ padding: "0 3px" }}>
                      in conversation with each other
                    </span>
                  </div>
                </Msg>
                <div ref={replyBox} style={{ opacity: 0 }}>
                  <Msg who={PEOPLE.fellow} time="now" fellow>
                    <span ref={reply} />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Chip tone="sea">review copy</Chip>
                      <Chip>publish</Chip>
                    </div>
                  </Msg>
                </div>
              </div>
              <div className="p-3" style={{ borderTop: "1px solid var(--line)", flex: "none" }}>
                <div
                  className="flex items-center gap-2 px-3"
                  style={{ height: 34, borderRadius: 8, border: "1px solid var(--line)", color: "var(--paper-4)" }}
                >
                  <span style={{ fontSize: 12 }}>Reply, or ask a Fellow…</span>
                  <span className="ml-auto">
                    <PrismMark size={14} state="idle" />
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* the undercurrent, in situ */}
          <div ref={rail} style={{ flex: "none", opacity: 0 }}>
            <UndercurrentBar
              slotRef={prismSlot}
              items={SHELL_CURRENTS}
              summary="2 running · 1 waiting"
              scale={0.92}
              punch
            />
          </div>
        </div>

        {/* ---------------- the landing page, as an object ---------------- */}
        <div
          ref={panel}
          className="absolute top-0 left-0 z-20 overflow-hidden"
          style={{
            width: 560,
            height: 640,
            transformOrigin: "0 0",
            border: "1px solid transparent",
            background: "#0a0c0a",
          }}
        >
          <PageSurface ref={pageCol} width={pw} />
        </div>

        {/* selection made by a collaborator on the page surface */}
        <div
          ref={selection}
          className="pointer-events-none absolute z-30"
          style={{
            border: "1px solid rgba(124,201,180,0.7)",
            borderRadius: 4,
            background: "rgba(124,201,180,0.06)",
            visibility: "hidden",
          }}
        >
          {[
            [-3, -3],
            [-3, 0],
            [0, -3],
            [0, 0],
          ].map(([a, b], i) => (
            <span
              key={i}
              style={{
                position: "absolute",
                width: 5,
                height: 5,
                background: "var(--sea)",
                borderRadius: 1,
                left: i % 2 === 0 ? a : undefined,
                right: i % 2 === 1 ? a : undefined,
                top: i < 2 ? b : undefined,
                bottom: i >= 2 ? b : undefined,
              }}
            />
          ))}
        </div>
        <div
          ref={selTag}
          className="pointer-events-none absolute z-30"
          style={{ visibility: "hidden" }}
        >
          <span
            className="cursor-label"
            style={{ position: "relative", left: 0, top: 0, background: PEOPLE.maya.color, display: "inline-block" }}
          >
            Maya R. · editing the headline
          </span>
        </div>

        {/* ---------------- act 7 clues ---------------- */}
        <div
          ref={clueV}
          className="pointer-events-none absolute top-0 z-30"
          style={{
            right: "9vw",
            width: 1,
            height: "100%",
            background:
              "linear-gradient(180deg, transparent, rgba(236,230,218,0.35) 22%, rgba(236,230,218,0.35) 78%, transparent)",
            visibility: "hidden",
          }}
        />
        <div
          ref={clueH}
          className="pointer-events-none absolute left-0 z-30"
          style={{
            bottom: "7vh",
            height: 1,
            width: "100%",
            background: "linear-gradient(90deg, transparent, rgba(236,230,218,0.25), transparent)",
            visibility: "hidden",
          }}
        />
        <div
          ref={clueHandle}
          className="pointer-events-none absolute z-30 flex items-center gap-1.5"
          style={{ right: "9vw", top: "48%", visibility: "hidden" }}
        >
          <span
            style={{
              width: 4,
              height: 26,
              borderRadius: 2,
              background: "rgba(236,230,218,0.45)",
              display: "block",
              marginLeft: -2,
            }}
          />
          <span className="label" style={{ fontSize: 8.5 }}>
            surface edge
          </span>
        </div>
        <div
          ref={vign}
          className="pointer-events-none absolute inset-0 z-30"
          style={{
            opacity: 0,
            boxShadow: "inset 0 0 160px 40px rgba(0,0,0,0.75)",
          }}
        />

        <Cursor ref={outsideCur} name="Maya R." color={PEOPLE.maya.color} />
        <Cursor ref={pageCur} name="Maya R." color={PEOPLE.maya.color} />
      </div>
    </section>
  );
}

function Msg({
  who,
  time,
  children,
  fellow,
}: {
  who: { name: string; initials: string; color: string };
  time: string;
  children: React.ReactNode;
  fellow?: boolean;
}) {
  return (
    <div className="thread-msg" style={fellow ? { borderColor: "rgba(224,141,128,0.24)" } : undefined}>
      <div className="mb-1.5 flex items-center gap-2">
        {fellow ? <PrismMark size={14} state="work" /> : <Avatar initials={who.initials} color={who.color} />}
        <span style={{ fontSize: 11.5 }}>{who.name}</span>
        <span className="meta ml-auto">{time}</span>
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.55, color: "var(--paper-2)" }}>{children}</div>
    </div>
  );
}
