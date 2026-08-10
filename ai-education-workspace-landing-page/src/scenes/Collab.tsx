import { useRef } from "react";
import { useScene, useSectionRef, clamp, lerp, seg, segL, setO, setT, setVis, streamText, easeOut } from "../engine/ticker";
import { prism, field } from "../webgl/stage";
import { Avatar, Chip, Cite, Cursor, Icon, PEOPLE, PrismMark } from "../components/kit";

const KEEP = "The corvée was abolished in 1892, seven years after the first perennial canal — which means the canal ";
const TRY = KEEP + "did not free anyone";
const FINAL = KEEP + "freed no one; it changed who was compelled, and how.";

export default function Collab() {
  const sec = useSectionRef("collab");
  const doc = useRef<HTMLDivElement>(null);
  const typed = useRef<HTMLSpanElement>(null);
  const caret = useRef<HTMLSpanElement>(null);
  const selPhrase = useRef<HTMLSpanElement>(null);
  const comment = useRef<HTMLDivElement>(null);
  const connector = useRef<HTMLDivElement>(null);
  const resolved = useRef<HTMLDivElement>(null);
  const insCite = useRef<HTMLSpanElement>(null);
  const insPhrase = useRef<HTMLSpanElement>(null);
  const delPhrase = useRef<HTMLSpanElement>(null);
  const ctrlA = useRef<HTMLDivElement>(null);
  const ctrlB = useRef<HTMLDivElement>(null);
  const cMaya = useRef<HTMLDivElement>(null);
  const cNaima = useRef<HTMLDivElement>(null);
  const cFellow = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLDivElement>(null);

  useScene(
    "collab",
    (p, c) => {
      const { vw, vh, mobile: mob } = c;
      const active = p > 0.0001 && p < 0.9999;
      const enter = easeOut(seg(p, 0, 0.1));
      const outP = seg(p, 0.93, 1);

      const dx = mob ? vw * 0.04 : Math.max(vw * 0.08, vw / 2 - (mob ? 0 : 470));
      const dy = vh * (mob ? 0.08 : 0.13);
      setT(doc.current, dx, dy + (1 - enter) * 44 - outP * vh * 0.3, lerp(0.98, 1, enter) * (1 - outP * 0.06));
      setO(doc.current, enter * (1 - outP));

      /* --- Naima writes, hesitates, rewrites --- */
      const t1 = segL(p, 0.08, 0.27);
      const pause = p > 0.27 && p < 0.315;
      const del = segL(p, 0.315, 0.35);
      const t2 = segL(p, 0.35, 0.52);
      let text: string;
      if (p < 0.27) text = streamText(TRY, t1);
      else if (pause) text = TRY;
      else if (del < 1) text = TRY.slice(0, Math.round(lerp(TRY.length, KEEP.length, del)));
      else text = KEEP + streamText(FINAL.slice(KEEP.length), t2);
      if (typed.current) typed.current.textContent = text;
      if (caret.current) {
        const writing = (t1 > 0 && t1 < 1) || pause || (del > 0 && t2 < 1);
        caret.current.style.opacity = writing ? "1" : "0";
      }

      /* --- Maya reviews an earlier line --- */
      const mSel = seg(p, 0.2, 0.28);
      if (selPhrase.current) selPhrase.current.style.backgroundSize = `${(mSel * 100).toFixed(0)}% 100%`;
      const cIn = seg(p, 0.29, 0.36);
      const cOut = seg(p, 0.86, 0.92);
      const docW = Math.min(680, vw * 0.92);
      const cmX = mob ? vw * 0.06 : Math.min(dx + docW + 42, vw - 292);
      const cmY = dy + (mob ? 470 : 140);
      setVis(comment.current, cIn * (1 - cOut));
      setT(comment.current, cmX + (1 - cIn) * 18, cmY, lerp(0.96, 1, cIn));
      setVis(connector.current, mob ? 0 : cIn * (1 - cOut) * 0.9);
      if (connector.current && !mob) {
        connector.current.style.left = `${dx + docW + 4}px`;
        connector.current.style.top = `${cmY + 34}px`;
        connector.current.style.width = `${Math.max(0, cmX - (dx + docW) - 10)}px`;
      }
      setVis(resolved.current, cOut * (1 - outP));
      setT(resolved.current, cmX, cmY, 1);

      /* --- the Fellow proposes two changes --- */
      const sIn = seg(p, 0.54, 0.62);
      const accept = seg(p, 0.68, 0.75);
      const reject = seg(p, 0.79, 0.87);

      if (insCite.current) {
        insCite.current.style.maxWidth = `${(sIn * 172).toFixed(0)}px`;
        insCite.current.style.opacity = clamp(sIn * 2).toFixed(2);
        // accepted: the highlight settles out, the text stays
        insCite.current.style.filter = `saturate(${(1 - accept * 0.15).toFixed(2)})`;
      }
      if (ctrlA.current) {
        setVis(ctrlA.current, sIn * (1 - seg(p, 0.74, 0.78)));
        setT(ctrlA.current, 0, (1 - sIn) * 8 - accept * 6, 1);
        ctrlA.current.dataset.state = accept > 0.5 ? "accepted" : "open";
      }
      if (insPhrase.current) {
        const width = sIn * 168 * (1 - reject);
        insPhrase.current.style.maxWidth = `${width.toFixed(0)}px`;
        insPhrase.current.style.opacity = (clamp(sIn * 2) * (1 - clamp(reject * 1.4))).toFixed(2);
        insPhrase.current.style.transform = `translateY(${(reject * -7).toFixed(1)}px)`;
      }
      if (delPhrase.current) {
        delPhrase.current.style.color = reject > 0.6 ? "var(--paper-2)" : sIn > 0.4 ? "var(--paper-4)" : "var(--paper-2)";
        delPhrase.current.style.textDecoration = sIn > 0.4 && reject < 0.6 ? "line-through" : "none";
        delPhrase.current.style.textDecorationColor = "rgba(224,141,128,0.8)";
      }
      if (ctrlB.current) {
        setVis(ctrlB.current, sIn * (1 - seg(p, 0.85, 0.9)));
        setT(ctrlB.current, 0, (1 - sIn) * 8, 1);
        ctrlB.current.dataset.state = reject > 0.5 ? "rejected" : "open";
      }

      /* --- cursors: few, deliberate, with pauses --- */
      const naimaY = dy + (mob ? 250 : 268);
      setVis(cNaima.current, seg(p, 0.05, 0.1) * (1 - seg(p, 0.55, 0.6)));
      setT(cNaima.current, dx + (mob ? 40 : 96) + Math.sin(c.t * 0.7) * 1.5, naimaY + 46, 1);

      const mp = seg(p, 0.14, 0.22);
      setVis(cMaya.current, seg(p, 0.12, 0.16) * (1 - seg(p, 0.4, 0.46)));
      setT(
        cMaya.current,
        lerp(dx + vw * 0.3, dx + (mob ? 150 : 292), mp) + Math.sin(c.t * 1.1) * 2,
        lerp(dy + 320, dy + (mob ? 178 : 186), mp) + Math.cos(c.t * 0.8) * 2,
        1
      );

      const fp = seg(p, 0.5, 0.58);
      setVis(cFellow.current, seg(p, 0.48, 0.53) * (1 - seg(p, 0.63, 0.68)));
      setT(
        cFellow.current,
        lerp(dx + vw * 0.42, dx + (mob ? 120 : 356), fp) + Math.sin(c.t * 0.9) * 2,
        lerp(dy + 420, dy + (mob ? 300 : 300), fp),
        1
      );

      setO(status.current, seg(p, 0.9, 0.96) * (1 - outP));
      setO(title.current, seg(p, 0.02, 0.1) * (1 - seg(p, 0.9, 0.98)));

      if (active) {
        prism.opacity = 0.34;
        prism.px = mob ? 0.62 : 0.84;
        prism.py = mob ? -0.82 : -0.74;
        prism.scale = mob ? 0.22 : 0.3;
        prism.spin = 0.5;
        prism.intake = 0;
        prism.charge = 0.2 + seg(p, 0.5, 0.62) * 0.35 - seg(p, 0.75, 0.9) * 0.2;
        prism.roll = 0;
        prism.tilt = 0;
        field.intensity = 0.22;
        field.density = 0.7;
        field.cell = 13;
        field.wave = 0.45;
        field.speed = 0.6;
        field.tint = lerp(0.2, 1.4, seg(p, 0.5, 0.62)) - seg(p, 0.86, 0.95) * 1.2;
        field.pulse = Math.sin(clamp(segL(p, 0.54, 0.64)) * Math.PI) * 0.3;
        field.clip = 0;
      }
    },
    4
  );

  return (
    <section ref={sec} style={{ height: "240vh", position: "relative" }}>
      <div className="stage">
        <div
          ref={title}
          className="absolute z-30 flex items-center gap-3"
          style={{ left: "clamp(20px, 5vw, 64px)", top: 26 }}
        >
          <PrismMark size={14} state="work" />
          <span className="label">Suggestions arrive as edits you can refuse</span>
        </div>

        <div
          ref={doc}
          className="frag surface absolute top-0 left-0 z-20"
          style={{ width: "min(680px, 92vw)", opacity: 0 }}
        >
          <div
            className="flex items-center gap-2.5 px-6 pt-4 pb-3"
            style={{ borderBottom: "1px solid var(--line)" }}
          >
            <Icon name="doc" size={13} />
            <span className="label">Essay 2 · §2 Chronology</span>
            <span className="ml-auto flex items-center gap-2">
              <span className="flex -space-x-1.5">
                <Avatar initials={PEOPLE.naima.initials} color={PEOPLE.naima.color} />
                <Avatar initials={PEOPLE.maya.initials} color={PEOPLE.maya.color} />
              </span>
              <Chip>autosaved</Chip>
            </span>
          </div>

          <div className="px-6 py-5" style={{ position: "relative" }}>
            <p className="serif-body" style={{ fontSize: 18.5, lineHeight: 1.72, color: "var(--paper-2)" }}>
              Egypt's engineers described perennial irrigation as a technical improvement.{" "}
              <span
                ref={selPhrase}
                style={{
                  backgroundImage: "linear-gradient(rgba(124,201,180,0.22), rgba(124,201,180,0.22))",
                  backgroundRepeat: "no-repeat",
                  backgroundSize: "0% 100%",
                  boxShadow: "none",
                }}
              >
                The archive is less discreet.
              </span>
            </p>

            <p className="serif-body mt-4" style={{ fontSize: 18.5, lineHeight: 1.72, color: "var(--paper)" }}>
              <span ref={typed} />
              <span
                ref={insCite}
                className="ins"
                style={{
                  display: "inline-block",
                  maxWidth: 0,
                  overflow: "hidden",
                  verticalAlign: "bottom",
                  whiteSpace: "nowrap",
                  opacity: 0,
                }}
              >
                {" "}
                <Cite>Barak 2013, p. 74</Cite>
              </span>
              <span ref={caret} className="caret" />
            </p>

            <p className="serif-body mt-4" style={{ fontSize: 18.5, lineHeight: 1.72, color: "var(--paper-2)" }}>
              What the ledgers record is not liberty but a change of instrument:{" "}
              <span ref={delPhrase}>a levy of days became a levy of water</span>
              <span
                ref={insPhrase}
                className="ins"
                style={{
                  display: "inline-block",
                  maxWidth: 0,
                  overflow: "hidden",
                  verticalAlign: "bottom",
                  whiteSpace: "nowrap",
                  opacity: 0,
                }}
              >
                {" "}
                compulsion was redistributed
              </span>
              .
            </p>

            {/* accept / reject controls */}
            <div
              ref={ctrlA}
              data-state="open"
              className="absolute z-30 flex items-center gap-2"
              style={{ left: 24, top: 208, visibility: "hidden" }}
            >
              <Suggestion label="attach the source for 1892" />
            </div>
            <div
              ref={ctrlB}
              data-state="open"
              className="absolute z-30 flex items-center gap-2"
              style={{ left: 24, top: 330, visibility: "hidden" }}
            >
              <Suggestion label="tighten to “compulsion was redistributed”" />
            </div>
          </div>

          <div
            ref={status}
            className="flex flex-wrap items-center gap-2 px-6 py-3"
            style={{ borderTop: "1px solid var(--line)", opacity: 0 }}
          >
            <Chip tone="amber" icon={<Icon name="clock" size={11} />}>
              562 / 900 words · Draft I due Mon
            </Chip>
            <Chip tone="sea" icon={<Icon name="check" size={11} />}>
              1 suggestion accepted
            </Chip>
            <Chip icon={<Icon name="x" size={11} />}>1 declined — Verso keeps your phrasing</Chip>
          </div>
        </div>

        {/* margin comment */}
        <div
          ref={connector}
          className="pointer-events-none absolute top-0 left-0 z-20"
          style={{
            width: 74,
            height: 1,
            background: "linear-gradient(90deg, rgba(124,201,180,0.7), rgba(124,201,180,0.15))",
            visibility: "hidden",
          }}
        />
        <div
          ref={comment}
          className="frag surface absolute top-0 left-0 z-30"
          style={{
            width: 268,
            padding: "12px 14px",
            visibility: "hidden",
          }}
        >
          <div className="mb-1.5 flex items-center gap-2">
            <Avatar initials={PEOPLE.maya.initials} color={PEOPLE.maya.color} />
            <span style={{ fontSize: 12 }}>Maya R.</span>
            <span className="meta ml-auto">now</span>
          </div>
          <p style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--paper-2)" }}>
            Keep this line. But the counter-argument he asked for still isn't anywhere — put it before this paragraph,
            not after.
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <span className="chip">Reply</span>
            <span className="chip chip-sea">Resolve</span>
          </div>
        </div>
        <div
          ref={resolved}
          className="absolute top-0 left-0 z-30 flex items-center gap-2"
          style={{ visibility: "hidden", width: 268 }}
        >
          <span
            className="dots dots-sea"
            style={{ width: 26, height: 8, ["--dot-s" as string]: "5px", ["--dot-r" as string]: "0.9px" }}
          />
          <span className="meta" style={{ color: "#a9e0d1" }}>
            resolved by Maya — counter-argument moved up
          </span>
        </div>

        <Cursor ref={cNaima} name="You" color={PEOPLE.naima.color} />
        <Cursor ref={cMaya} name="Maya R." color={PEOPLE.maya.color} />
        <Cursor ref={cFellow} name="Source Fellow" color={PEOPLE.fellow.color} kind="fellow" />
      </div>
    </section>
  );
}

function Suggestion({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-2.5"
      style={{
        padding: "5px 6px 5px 10px",
        borderRadius: 8,
        border: "1px solid rgba(224,141,128,0.32)",
        background: "rgba(20,18,17,0.92)",
        backdropFilter: "blur(10px)",
        boxShadow: "0 12px 30px -14px rgba(0,0,0,0.9)",
      }}
    >
      <PrismMark size={13} state="work" />
      <span style={{ fontSize: 11.5, color: "var(--paper-2)" }}>{label}</span>
      <span
        className="flex items-center justify-center"
        style={{ width: 22, height: 20, borderRadius: 5, background: "rgba(124,201,180,0.16)", color: "#a9e0d1" }}
      >
        <Icon name="check" size={12} />
      </span>
      <span
        className="flex items-center justify-center"
        style={{ width: 22, height: 20, borderRadius: 5, background: "rgba(236,230,218,0.06)", color: "var(--paper-3)" }}
      >
        <Icon name="x" size={12} />
      </span>
    </div>
  );
}
