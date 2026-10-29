"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "@/components/icons";
import { postSpectra, type SpectraArtifactEmbed } from "@/features/spectra/data/api";
import { ArtifactEmbed } from "@/features/spectra/components/artifact-embed";
import { refreshRunTabs } from "@/features/spectra/island/run-tabs";
import { LandingIsland, islandField, typeIntoIsland, useLandingEngine } from "../../kit/landing-island";
import { useWorld, useWorldEvent } from "../../kit/world-context";
import { Written } from "../../kit/written";
import { DEADLINES } from "../../world/school";
import { dayName } from "../../world/story";
import { WORKS, type StoryWork } from "../../world/works";
import { PEOPLE, useHands } from "../hands";
import { dimAll, flash, shine, travel } from "../light/light";
import { useLoop, type Beat } from "../loop";
import { Scaled } from "../window";

/*
 * The island, large, as the one thing on the page. Henry hands it his Biology
 * notes and asks for something to revise from. While it works it says what it
 * is doing, its reading lights up the notes, and what it makes comes out of it
 * as the cards it would sit on a page as: a quiz, flashcards and slides, each
 * working where it lands. A visitor can bring any card to the top to look at
 * it; the island itself is a picture here and takes no input.
 */

const MAKE = `make me something to revise for ${DEADLINES.biologyTest.startAt ? dayName(DEADLINES.biologyTest.startAt) : "Thursday"}'s test`;
const MADE = [WORKS.quiz, WORKS.cards, WORKS.deck];
const HUES: Record<string, [number, number]> = {
  [WORKS.quiz._id]: [5.8, 6.4],
  [WORKS.cards._id]: [4.6, 5.4],
  [WORKS.deck._id]: [0.4, 1.2],
};
/** What the island says it is doing, in order; each made card lands as its line is written. */
const STEPS: { text: string; lands?: string; marks?: number }[] = [
  { text: "Reading Cell respiration notes", marks: 3 },
  { text: "Writing a quiz on the electron transport chain", lands: WORKS.quiz._id },
  { text: "Turning the key terms into flashcards", lands: WORKS.cards._id },
  { text: "Making five slides, filed in Biology SL", lands: WORKS.deck._id },
];
/** Where each card lies in the fan: across, down, and its turn. */
const FAN: Record<string, { x: number; y: number; turn: number }> = {
  [WORKS.quiz._id]: { x: 350, y: 34, turn: -4 },
  [WORKS.cards._id]: { x: 615, y: 6, turn: 0 },
  [WORKS.deck._id]: { x: 880, y: 34, turn: 4 },
};

/** The kind of each card, shown in its place until it arrives. */
const SLOTS: Record<string, { kind: string; icon: IconName; tint: string }> = {
  [WORKS.quiz._id]: { kind: "Quiz", icon: "quiz", tint: "#ff647f" },
  [WORKS.cards._id]: { kind: "Flashcards", icon: "flashcards", tint: "#9176e8" },
  [WORKS.deck._id]: { kind: "Slides", icon: "slides", tint: "#ffab4a" },
};

const STAGE = { width: 1240, height: 640 };

function embedOf(work: StoryWork): SpectraArtifactEmbed {
  return {
    embedId: `landing-${work._id}`,
    containerType: "thread",
    containerId: "landing-ask",
    containerRegionId: "reply:landing-ask",
    sourceArtifactId: work._id,
    mode: "expanded",
    interaction: "interact",
    versionPolicy: "live",
    contextPolicy: "none",
    state: "ready",
    source: {
      artifactId: work._id,
      title: work.title,
      blueprintKey: work.blueprintKey,
      updatedAt: work.updatedAt,
      snapshot: { title: work.title, content: work.content },
    },
  };
}
const EMBEDS = Object.fromEntries(MADE.map((work) => [work._id, embedOf(work)]));

export function Ask() {
  const world = useWorld();
  const sceneRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLDivElement>(null);
  const isleRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const { layer, hand } = useHands();
  const [made, setMade] = useState<ReadonlySet<string>>(() => new Set());
  const [marks, setMarks] = useState(0);
  const [status, setStatus] = useState<{ text: string; shown: number } | null>(null);
  const [top, setTop] = useState<string | null>(null);
  /** The cards from bottom to top: the last one looked at stays above the others. */
  const [order, setOrder] = useState<readonly string[]>(() => MADE.map((work) => work._id));
  const waiting = useRef<{ key: string; runId: string | null; done: boolean } | null>(null);
  /** The last round's run: its tab gives way to the next one's, so the rail keeps one. */
  const lastRun = useRef<string | null>(null);
  const engine = useLandingEngine(() => undefined);

  useWorldEvent((event) => {
    const run = waiting.current;
    if (!run) return;
    if (event.type === "run_started" && event.reply.key === run.key) run.runId = event.runId;
    if (event.type === "run_finished" && event.runId === run.runId) run.done = true;
  });

  // The island's line writes itself out, a few letters at a time.
  useEffect(() => {
    if (!status || status.shown >= status.text.length) return;
    const timer = window.setTimeout(
      () => setStatus((was) => (was ? { ...was, shown: Math.min(was.text.length, was.shown + 3) } : was)),
      14,
    );
    return () => window.clearTimeout(timer);
  }, [status]);

  // The island sits in its own light.
  useEffect(() => {
    const isle = isleRef.current;
    if (!isle) return;
    shine("ask-isle", { el: isle, at: [0.5, 0.5], rx: 520, ry: 120, strength: 0.32, hues: [3.4, 5.4], flow: 0.6, ease: 1600 });
    return () => dimAll("ask");
  }, []);

  const say = (text: string) => setStatus({ text, shown: 0 });

  const round = async (beat: Beat) => {
    const { wait, signal } = beat;
    const notes = notesRef.current;
    const field = islandField();
    if (!notes || !field) return;
    setMade(new Set());
    setMarks(0);
    setStatus(null);
    setTop(null);
    await wait(150);

    // Henry hands the island his notes.
    const henry = hand(PEOPLE.henry, signal);
    await henry.show(notes, [0.45, 0.4]);
    await henry.press({ light: false });
    henry.grab(notes);
    await henry.move(field, { ms: 480, aim: [0.3, 0.5] });
    await henry.drop();
    await henry.hide();
    henry.remove();
    if (signal.aborted) return;

    // He asks; the island answers in a run of its own, which stays a tab on its rail.
    if (lastRun.current) {
      await postSpectra({ action: "hideRunTab", runId: lastRun.current }).catch(() => undefined);
      await refreshRunTabs(true);
      lastRun.current = null;
    }
    await world.whenIdle();
    waiting.current = { key: "make", runId: null, done: false };
    world.pace = 0.2;
    world.quiet = true;
    await typeIntoIsland(MAKE, {
      fresh: true,
      perLetter: 12,
      references: [{ id: WORKS.notes._id, type: WORKS.notes.blueprintKey, title: WORKS.notes.title }],
    });
    if (signal.aborted) return;

    for (const step of STEPS) {
      say(step.text);
      if (step.marks) {
        for (let mark = 1; mark <= step.marks && !signal.aborted; mark += 1) {
          await wait(180);
          setMarks(mark);
        }
        await wait(120);
        continue;
      }
      await wait(260);
      const id = step.lands!;
      setMade((was) => new Set(was).add(id));
      await wait(40);
      const card = cardRefs.current[id];
      if (card) flash({ el: card, rx: 220, ry: 200, strength: 0.5, hues: HUES[id]!, hold: 360 });
      await wait(220);
    }
    say(`Done. Three things for ${DEADLINES.biologyTest.startAt ? dayName(DEADLINES.biologyTest.startAt) : "the test"}, in Biology SL`);
    for (let tries = 0; !waiting.current?.done && tries < 25 && !signal.aborted; tries += 1) await wait(80);
    lastRun.current = waiting.current?.runId ?? null;
    waiting.current = null;
  };

  // It plays once: what the island made stays on the page for the reader to look through.
  useLoop(sceneRef, {
    open: async (beat) => {
      const { wait } = beat;
      const title = sceneRef.current?.querySelector(".sp-heading");
      const isle = isleRef.current;
      if (title && isle) {
        const box = title.getBoundingClientRect();
        travel("ask-title", [box.left + box.width * 0.5, box.top + window.scrollY + box.height * 0.5], isle, {
          at: [0.5, 0.5],
          rx: 420,
          ry: 160,
          strength: 0.36,
          hues: [3.6, 5.4],
          flow: 0.5,
          ease: 500,
          ms: 1500,
        });
        window.setTimeout(() => dimAll("ask-title", 1400), 1800);
      }
      await wait(250);
      await round(beat);
    },
  });

  return (
    <section ref={sceneRef} className="sp-scene sp-ask" aria-labelledby="sp-ask-title">
      <div className="sp-scene-copy" data-centred>
        <Written id="sp-ask-title" className="sp-heading" text={"Ask once.\nGet the work back."} />
        <p className="sp-lede">
          Spectra doesn&rsquo;t stop at an answer. It writes the quiz, builds the slides and files them in the right class.
        </p>
      </div>

      <div className="sp-ask-room">
        <Scaled width={STAGE.width} height={STAGE.height} least={0.8}>
          <div ref={stageRef} className="sp-ask-stage" style={{ width: "100%", height: "100%" }}>
            <div className="sp-ask-isle-room">
              <div ref={isleRef} className="sp-ask-isle" inert aria-label="Spectra's island">
                <LandingIsland engine={engine} />
              </div>
              <p className="sp-ask-status" data-on={status ? "" : undefined} aria-live="polite">
                {status ? (
                  <>
                    <i aria-hidden />
                    {status.text.slice(0, status.shown)}
                  </>
                ) : null}
              </p>
            </div>

            <div ref={notesRef} className="sp-ask-notes" data-marks={marks}>
              <span className="sp-ask-kind">
                <i aria-hidden />
                Notes, Biology SL
              </span>
              <b>{WORKS.notes.title}</b>
              <p>
                Glycolysis happens in the cytoplasm and splits glucose into two <mark data-mark="1">pyruvate</mark>. The link reaction
                and Krebs cycle run in the <mark data-mark="2">mitochondrial matrix</mark>, and the{" "}
                <mark data-mark="3">electron transport chain</mark> on the inner membrane makes most of the ATP.
              </p>
              <span className="sp-ask-line" style={{ width: "92%" }} />
              <span className="sp-ask-line" style={{ width: "80%" }} />
              <span className="sp-ask-line" style={{ width: "86%" }} />
              <span className="sp-ask-line" style={{ width: "58%" }} />
            </div>

            <svg className="sp-ask-arrow" data-on={made.size ? "" : undefined} width="80" height="24" viewBox="0 0 80 24" aria-hidden>
              <path d="M4 12h66" />
              <path d="M62 5l9 7-9 7" />
            </svg>

            {/* Where each card will lie, waiting in the fan before the island fills it. */}
            {MADE.map((work) => {
              const place = FAN[work._id]!;
              return (
                <span
                  key={`slot-${work._id}`}
                  className="sp-ask-slot"
                  data-filled={made.has(work._id) || undefined}
                  style={{ "--x": `${place.x}px`, "--y": `${place.y}px`, "--turn": `${place.turn}deg`, "--tint": SLOTS[work._id]!.tint } as CSSProperties}
                  aria-hidden
                >
                  <Icon name={SLOTS[work._id]!.icon} size={16} />
                  {SLOTS[work._id]!.kind}
                </span>
              );
            })}

            {MADE.map((work, index) => {
              const place = FAN[work._id]!;
              return (
                // Marked as an open work, as the island looks for: what it made is on screen, so it calls out nothing.
                <div
                  key={work._id}
                  ref={(node) => {
                    cardRefs.current[work._id] = node;
                  }}
                  className="sp-ask-made spectra-artifact-studio"
                  data-artifact-id={work._id}
                  data-made={made.has(work._id) || undefined}
                  data-top={top === work._id || undefined}
                  style={{ "--x": `${place.x}px`, "--y": `${place.y}px`, "--turn": `${place.turn}deg`, "--i": index, "--z": order.indexOf(work._id) } as CSSProperties}
                  onPointerEnter={() => {
                    setTop(work._id);
                    setOrder((was) => [...was.filter((id) => id !== work._id), work._id]);
                  }}
                  onPointerLeave={() => setTop((was) => (was === work._id ? null : was))}
                >
                  {made.has(work._id) ? <ArtifactEmbed embed={EMBEDS[work._id]!} /> : null}
                </div>
              );
            })}
          </div>
        </Scaled>
        {layer}
      </div>
    </section>
  );
}
