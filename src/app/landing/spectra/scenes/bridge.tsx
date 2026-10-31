"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { SpectraMark } from "@/components/spectra-mark";
import type { InteractionState } from "@/features/spectra/collaboration/interaction-model";
import { editorIn, findText, markText, replaceText, unmarkText, waitForEditor } from "../../kit/doc-hand";
import { InlineStudio } from "../../kit/inline-studio";
import { perform } from "../../kit/perform";
import { Surface, usePresence, type Move } from "../../kit/presence";
import { Written } from "../../kit/written";
import { CAST, type CastId } from "../../world/story";
import { WORKS } from "../../world/works";
import { PEOPLE, sleep, useHands } from "../hands";
import { dimAll, flash, shine, travel } from "../light/light";
import { useLoop, type Beat } from "../loop";
import { BridgePrism, newDrive, pulse } from "../prism/bridge-prism";
import { Window } from "../window";

/*
 * The same file twice: Henry's History IA as Word has it on his laptop, and
 * as Spectra has it, kept in step by Bridge, with Spectra's glass prism
 * between them. Pipes run from the laptop into the prism and out to Spectra;
 * every save goes through them as light, and the prism lights and turns as it
 * passes. He writes a sentence in Word and saves; it is in Spectra. Then his
 * AI rewords the paragraph Ms Gonzalez asked about and picks out the vote, in
 * Spectra, with the hand it has in the app (kit/perform), and each change goes
 * back to the file on the laptop as it is made.
 * The laptop is drawn; Spectra's side is the real document studio and
 * presence. A visitor can spin the prism whenever they like.
 */

const FILE = "History IA draft.docx";
const OLD = "Its value is that it was spoken by an opponent in the room, at the time, knowing the risk.";
const NEW =
  "Its value lies in its origin: Wels spoke for the SPD in the Reichstag on 23 March 1933, minutes before the vote, knowing what opposing it could cost.";
const VOTE = "444 votes to 94";
const END = "the conditions of the vote were not free.";
const SENTENCE = " Wels himself spoke with the SA lining the walls.";
const WHERE = ["Word", "Spectra"] as const;

const A2_START = "The second source is a speech by Otto Wels, leader of the SPD, given in the Reichstag before the vote. ";
const B1_START = "The Act was passed by ";
const B1_MIDDLE = ", but the vote took place with SA men lining the Kroll Opera House and the Communist deputies already arrested or in hiding. It was legal in form, but ";

type Content = { blocks: Array<{ id: string; text: string }> };
/** The draft with one block's words changed, as the file has it after a save. */
const changed = (content: Content, id: string, from: string, to: string): Content => ({
  ...content,
  blocks: content.blocks.map((block) => (block.id === id ? { ...block, text: block.text.replace(from, to) } : block)),
});
const DRAFT = WORKS.ia.content as Content;
const WRITTEN = changed(DRAFT, "ia-b1", END, END + SENTENCE);
const REWORDED = changed(WRITTEN, "ia-a2", OLD, NEW);

type Saved = "saved" | "editing" | "saving" | "spectra";
/** The two pipes: laptop to prism, prism to Spectra, in the stage's own pixels. */
type Pipes = { width: number; height: number; word: string; spectra: string };

/** A pipe's path between two points, leaving and arriving level. */
const pipe = (from: [number, number], to: [number, number]) => {
  const bend = (to[0] - from[0]) * 0.55;
  return `M${from[0]} ${from[1]}C${from[0] + bend} ${from[1]} ${to[0] - bend} ${to[1]} ${to[0]} ${to[1]}`;
};
type Sync = "idle" | "from-word" | "writing" | "to-word";

const SYNC_LINE: Record<Sync, string> = {
  idle: "In sync with Henry's MacBook Air",
  "from-word": "Saved in Word, just now",
  writing: "Spectra is editing the file",
  "to-word": "Saved to Henry's MacBook Air",
};

/** The file as Spectra has it from the laptop: by its file's name. */
const IA_FILE = { ...WORKS.ia, title: FILE };

export function Bridge({ film = false }: { film?: boolean } = {}) {
  const sceneRef = useRef<HTMLElement>(null);
  const wordRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const studioRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const presence = usePresence("bridge");
  const { move, put, leave } = presence;
  // The page's body lives in its editor, as in the app, so each frame of the work is written into it block by block.
  const shown = useRef<Content>(DRAFT);
  const show = useCallback((content: unknown) => {
    const next = content as Content;
    const editor = editorIn(studioRef.current);
    if (editor)
      for (const block of next.blocks) {
        const was = shown.current.blocks.find((old) => old.id === block.id)?.text;
        if (was && was !== block.text) replaceText(editor, was, block.text);
      }
    shown.current = next;
  }, []);
  const { layer, hand } = useHands();
  const [where, setWhere] = useState(0);
  const [typed, setTyped] = useState(0);
  const [saved, setSaved] = useState<Saved>("saved");
  const [sync, setSync] = useState<Sync>("idle");
  const [bold, setBold] = useState(false);
  const [reworded, setReworded] = useState(false);
  const [fresh, setFresh] = useState<"vote" | "reword" | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<HTMLDivElement>(null);
  const pipesRef = useRef<SVGSVGElement>(null);
  const [pipes, setPipes] = useState<Pipes | null>(null);
  const drive = useMemo(() => newDrive(), []);

  // The pipes are measured from the page: out of the laptop's screen, into the prism, out to Spectra's window.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const room = stage.getBoundingClientRect();
      const screen = stage.querySelector(".sp-laptop-screen")?.getBoundingClientRect();
      const core = coreRef.current?.getBoundingClientRect();
      const app = appRef.current?.querySelector(".sp-window")?.getBoundingClientRect();
      if (!screen || !core || !app || !core.width) return setPipes(null);
      const x = (value: number) => Math.round(value - room.left);
      const y = (value: number) => Math.round(value - room.top);
      const centre: [number, number] = [x(core.left + core.width / 2), y(core.top + core.height / 2)];
      setPipes({
        width: Math.round(room.width),
        height: Math.round(room.height),
        word: pipe([x(screen.right) - 12, y(screen.top + screen.height * 0.5)], centre),
        spectra: pipe(centre, [x(app.left) + 12, y(app.top + app.height * 0.42)]),
      });
    };
    measure();
    const sized = new ResizeObserver(measure);
    sized.observe(stage);
    return () => sized.disconnect();
  }, []);

  useEffect(() => {
    const word = wordRef.current;
    const app = appRef.current?.querySelector<HTMLElement>(".sp-window");
    if (word) shine("bridge-word", { el: word, halo: { radius: 12 }, rx: 110, ry: 80, strength: 0.55, hues: [3.6, 4.4], flow: 0.6, ease: 1400 });
    if (app) shine("bridge-app", { el: app, halo: { radius: 16 }, rx: 110, ry: 80, strength: 0.6, hues: [4.6, 5.8], flow: 0.6, ease: 1400 });
    return () => dimAll("bridge");
  }, []);

  /** Points Henry's AI at `text` in Spectra's copy, as the presence layer draws a selection. */
  const pointAt = useCallback(
    (id: CastId, text: string, extra: Partial<Move> = {}) => {
      const editor = editorIn(studioRef.current);
      const range = editor ? findText(editor, text) : null;
      if (!range?.blockId) return null;
      move(id, {
        path: `/blocks/${range.blockId}`,
        primitive: "richtext",
        act: { kind: "select", span: { anchor: { offset: range.offset }, head: { offset: range.offset + text.length } } },
        ...extra,
      });
      return studioRef.current?.querySelector(`[data-block-id="${range.blockId}"], [data-id="${range.blockId}"]`) ?? studioRef.current;
    },
    [move],
  );

  /** Light runs down one pipe, the way the save is going. */
  const spark = async (which: "word" | "spectra", backwards: boolean) => {
    const path = pipesRef.current?.querySelector<SVGPathElement>(`[data-pipe="${which}"]`);
    if (!path) return;
    const light = path.cloneNode() as SVGPathElement;
    light.removeAttribute("data-pipe");
    light.setAttribute("class", "sp-pipe-spark");
    path.parentNode?.append(light);
    const along = [0.3, -1];
    await light
      .animate([{ strokeDashoffset: backwards ? along[1]! : along[0]! }, { strokeDashoffset: backwards ? along[0]! : along[1]! }], {
        duration: 460,
        easing: "cubic-bezier(0.45, 0, 0.55, 1)",
      })
      .finished.catch(() => undefined);
    light.remove();
  };

  /** A save crossing over: through the pipe into the prism, which lights and turns, and out the other side. */
  const send = async (from: "word" | "spectra", hue: string, signal: AbortSignal) => {
    const there = from === "word";
    await spark(there ? "word" : "spectra", !there);
    pulse(drive, hue);
    await sleep(160, signal).catch(() => undefined);
    await spark(there ? "spectra" : "word", !there);
    const reached = there ? studioRef.current : wordRef.current;
    if (reached) flash({ el: reached, rx: 220, ry: 120, strength: 0.5, hues: there ? [3.4, 4.4] : [4.6, 5.6], hold: 380 });
  };

  useLoop(sceneRef, {
    open: async ({ wait }) => {
      const title = sceneRef.current?.querySelector(".sp-heading");
      const stage = sceneRef.current?.querySelector(".sp-bridge-stage");
      if (title && stage) {
        const box = title.getBoundingClientRect();
        travel("bridge-title", [box.left + box.width * 0.5, box.top + window.scrollY + box.height * 0.6], stage, {
          at: [0.5, 0.35],
          rx: 460,
          ry: 220,
          strength: 0.45,
          hues: [3.6, 5.4],
          flow: 0.5,
          ease: 500,
          ms: 1700,
        });
        window.setTimeout(() => dimAll("bridge-title", 1600), 2100);
      }
      await wait(300);
    },
    round: async (beat: Beat) => {
      const { wait, signal } = beat;
      const editor = await waitForEditor(() => studioRef.current, signal).catch(() => null);
      if (!editor || signal.aborted) return;

      // In Word, on the laptop: Henry adds a sentence and saves.
      setWhere(0);
      const henry = hand(PEOPLE.henry, signal);
      await henry.show(caretRef.current, [0, 0.6]);
      await henry.press();
      setSaved("editing");
      for (let length = 0; length <= SENTENCE.length && !signal.aborted; length += 1 + Math.round(Math.random())) {
        setTyped(Math.min(SENTENCE.length, length));
        await wait(18);
      }
      setTyped(SENTENCE.length);
      await wait(150);
      void henry.hide().then(() => henry.remove());
      setSaved("saving");
      await wait(250);
      setSaved("saved");

      // Bridge carries the save across, through the prism; it is in Spectra's copy.
      await send("word", "#4f9fe6", signal);
      if (signal.aborted) return;
      show(WRITTEN);
      setSync("from-word");
      await wait(60);
      const added = pointAt("henry", SENTENCE.trim());
      leave("henry");
      if (added) flash({ el: added, rx: 300, ry: 90, strength: 0.6, hues: [3.4, 4.2], hold: 600 });
      await wait(900);

      // In Spectra: Henry's AI edits, and each change is written to the file on the laptop.
      setWhere(1);
      setSync("writing");
      const ai = { surface: "bridge", show: (state: InteractionState | null) => put("henryAi", state), apply: show, wait, signal };
      await perform(WORKS.ia, WRITTEN, REWORDED, CAST.henryAi, "bridge-reword", ai);
      if (signal.aborted) return;
      await send("spectra", "#ff647f", signal);
      setReworded(true);
      setFresh("reword");
      setSaved("spectra");
      await wait(400);

      flash({ el: pointAt("henryAi", VOTE, { note: "Bold" }), rx: 240, ry: 90, strength: 0.6, hues: [4.6, 5.6], hold: 500 });
      await wait(400);
      const now = editorIn(studioRef.current);
      if (now) markText(now, VOTE, "bold");
      await send("spectra", "#9176e8", signal);
      setBold(true);
      setFresh("vote");
      setSync("to-word");
      await wait(1400);
      leave("henryAi");
      setFresh(null);
      await wait(400);
      if (signal.aborted) return;

      // The draft as it was, for the next round.
      setSync("idle");
      setSaved("saved");
      setTyped(0);
      setBold(false);
      setReworded(false);
      unmarkText(editorIn(studioRef.current) ?? editor, VOTE, "bold");
      show(DRAFT);
      await wait(500);
    },
  });

  return (
    <section ref={sceneRef} className="sp-scene sp-bridge" aria-labelledby="sp-bridge-title">
      <div className="sp-scene-copy" data-centred>
        <Written id="sp-bridge-title" className="sp-heading" text={"The files on your laptop,\nedited in {}."} flip={{ words: WHERE, index: where }} />
        <p className="sp-lede">
          Bridge keeps the folders you choose in step with their class. Write in Word and Spectra has it. Ask Spectra to edit, and the
          change is in the file on your laptop as it is made.
        </p>
      </div>

      <div ref={stageRef} className="sp-bridge-stage">
        {pipes ? (
          <svg ref={pipesRef} className="sp-bridge-pipes" width={pipes.width} height={pipes.height} aria-hidden>
            <defs>
              <linearGradient id="sp-pipe-light" x1="0" x2={pipes.width} y1="0" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#4f9fe6" />
                <stop offset="0.2" stopColor="#48c997" />
                <stop offset="0.4" stopColor="#ffe066" />
                <stop offset="0.6" stopColor="#ffab4a" />
                <stop offset="0.8" stopColor="#ff647f" />
                <stop offset="1" stopColor="#9176e8" />
              </linearGradient>
            </defs>
            {(["word", "spectra"] as const).map((which) => (
              <g key={which}>
                <path className="sp-pipe" d={pipes[which]} />
                <path className="sp-pipe-shine" d={pipes[which]} />
                <path className="sp-pipe-way" data-pipe={which} d={pipes[which]} pathLength={1} />
              </g>
            ))}
          </svg>
        ) : null}
        <div className="sp-laptop" aria-label="Henry's laptop">
          <div className="sp-laptop-screen">
            <div ref={wordRef} className="sp-word" data-saved={saved}>
              <div className="sp-os-bar">
                <span className="sp-os-lights" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                <span className="sp-os-title">
                  <span className="sp-word-badge" aria-hidden>
                    W
                  </span>
                  {FILE}
                </span>
                <span className="sp-word-state">
                  {saved === "editing" ? "Edited" : saved === "saving" ? "Saving…" : saved === "spectra" ? "Updated by Spectra" : "Saved"}
                </span>
              </div>
              <div className="sp-word-ribbon" aria-hidden>
                <span>Home</span>
                <span>Insert</span>
                <span>Layout</span>
                <span>Review</span>
              </div>
              <div className="sp-word-page">
                <p className="sp-word-heading">Identification and evaluation of sources</p>
                <p>
                  {A2_START}
                  <span className="sp-word-change" data-fresh={fresh === "reword" || undefined}>
                    {reworded ? NEW : OLD}
                  </span>
                </p>
                <p className="sp-word-heading">Investigation</p>
                <p>
                  {B1_START}
                  <span className="sp-word-change" data-fresh={fresh === "vote" || undefined}>
                    {bold ? <strong>{VOTE}</strong> : VOTE}
                  </span>
                  {B1_MIDDLE}
                  {END}
                  <span className="sp-word-typed">{SENTENCE.slice(0, typed)}</span>
                  <span ref={caretRef} className="sp-word-caret" data-on={saved === "editing" || undefined} />
                </p>
                <p className="sp-word-ghost" aria-hidden>
                  <span />
                  <span />
                  <span />
                </p>
              </div>
            </div>
          </div>
          <div className="sp-laptop-base" aria-hidden />
        </div>

        <BridgePrism drive={drive} anchorRef={coreRef} />

        <div ref={appRef} className="sp-bridge-app">
          <Window at="library" width={film ? 800 : 860} height={film ? 1060 : 640} label="Henry's Spectra">
            <div className="sp-bridge-doc">
              <p className="sp-bridge-sync" data-sync={sync} aria-live="polite">
                <span className="sp-bridge-file">
                  <Icon name="document" size={14} />
                  {FILE}
                </span>
                <span key={sync} className="sp-bridge-line">
                  {sync === "writing" ? <SpectraMark size={13} /> : <i className="sp-bridge-dot" />}
                  {SYNC_LINE[sync]}
                </span>
              </p>
              <Surface id="bridge" states={presence.states} className="sp-bridge-surface">
                <div ref={studioRef} className="sp-bridge-studio">
                  <InlineStudio work={IA_FILE} instanceKey="landing-bridge-ia" className="sp-studio" />
                </div>
              </Surface>
            </div>
          </Window>
        </div>
        {layer}
      </div>
    </section>
  );
}
