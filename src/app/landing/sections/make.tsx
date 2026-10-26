"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { workTypeMeta } from "@/features/spectra/artifacts/presentation";
import { workCardStyle } from "@/features/spectra/components/work-card";
import { openWorkInSide } from "@/features/spectra/components/side-open";
import { targetAttrs } from "@/features/spectra/collaboration/target-attributes";
import { useBuild } from "../kit/build";
import { InlineStudio } from "../kit/inline-studio";
import { typeIntoIsland } from "../kit/landing-island";
import { Surface, usePresence } from "../kit/presence";
import { StoryCards } from "../kit/story-card";
import { useWorld, useWorldEvent } from "../kit/world-context";
import { WORKS } from "../world/works";

/*
 * One set of notes, split like light through the prism into three ways to
 * revise, then gathered back into a folder in Biology. The folder's tabs are
 * the works themselves, open in their real studios: answer the quiz, flip the
 * cards, edit a slide, or open one beside the page. "More" shows that the same
 * place makes the rest of a student's work too.
 */

const QUESTION = "make me something to revise for thursday's test";
const MADE = [WORKS.quiz, WORKS.cards, WORKS.deck];
const MORE = [WORKS.sheet, WORKS.essay, WORKS.ia];
/** Each ray is the colour of the kind of work it becomes. */
const RAYS = ["var(--type-quiz)", "var(--type-flashcards)", "var(--type-slides)"];

type Phase = "idle" | "making" | "filed";

export function Make() {
  const ref = useRef<HTMLElement>(null);
  const build = useBuild(ref, 0.45);
  const world = useWorld();
  const presence = usePresence("make");
  const [phase, setPhase] = useState<Phase>("idle");
  const [made, setMade] = useState<ReadonlySet<string>>(() => new Set());
  const [active, setActive] = useState<string>(WORKS.quiz._id);
  const [more, setMore] = useState(false);
  const asked = useRef(false);

  useWorldEvent((event) => {
    if (event.type === "run_started" && event.reply.key === "make") setPhase((was) => (was === "filed" ? was : "making"));
    if (event.type === "reading" && event.workId && MADE.some((work) => work._id === event.workId)) setMade((was) => new Set(was).add(event.workId!));
    if (event.type === "run_finished" && event.reply.key === "make") {
      setMade(new Set(MADE.map((work) => work._id)));
      window.setTimeout(() => setPhase("filed"), 900);
    }
  });

  useEffect(() => {
    if (!build.started || asked.current) return;
    asked.current = true;
    if (build.skipped) {
      setMade(new Set(MADE.map((work) => work._id)));
      setPhase("filed");
      return;
    }
    let cancelled = false;
    void world.whenIdle().then(() => {
      if (!cancelled) void typeIntoIsland(QUESTION, { fresh: true });
    });
    // If the island is busy elsewhere, the folder is there anyway.
    const timer = window.setTimeout(() => {
      setMade(new Set(MADE.map((work) => work._id)));
      setPhase("filed");
    }, 24_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [build.skipped, build.started, world]);

  // Henry's AI files the three, then lets go.
  const { move, leave } = presence;
  useEffect(() => {
    if (phase !== "filed") return;
    move("henryAi", { path: "make/folder", primitive: "surface", act: { kind: "create" }, label: "Biology SL", note: "Filed in Biology SL" });
    const timer = window.setTimeout(() => leave("henryAi"), 3200);
    return () => window.clearTimeout(timer);
  }, [leave, move, phase]);

  const activeWork = MADE.find((work) => work._id === active) ?? WORKS.quiz;

  return (
    <section ref={ref} id="make" className="landing-section landing-make" data-stage="make" data-island="on" aria-labelledby="make-title">
      <div className="landing-copy">
        <h2 id="make-title" className="landing-heading">
          Make anything from what you already have.
        </h2>
        <p className="landing-lede">
          Ask for something to revise from and Spectra makes it from your own notes: a quiz on the parts you know least, cards
          to flip, slides to talk through. It files them in the class, and every one opens to be changed.
        </p>
      </div>
      <Surface id="make" states={presence.states} className="landing-make-stage">
        <div className="landing-fan" data-phase={phase}>
          <div className="landing-fan-source" style={workCardStyle("document")}>
            <span className="work-card-tab">
              <Icon name={workTypeMeta.document.glyph} size={13} />
              {workTypeMeta.document.label}
            </span>
            <span className="landing-fan-source-face">
              <strong>{WORKS.notes.title}</strong>
              <span>Glycolysis, the link reaction, the Krebs cycle and the electron transport chain.</span>
            </span>
          </div>
          <svg className="landing-fan-rays" viewBox="0 0 300 240" preserveAspectRatio="none" aria-hidden>
            {RAYS.map((colour, index) => (
              <path key={colour} d={`M0 120 C 120 120, 160 ${40 + index * 80}, 300 ${40 + index * 80}`} stroke={colour} data-on={made.has(MADE[index]!._id) || phase === "filed" || undefined} />
            ))}
          </svg>
          <ol className="landing-fan-made" aria-label="Made from the notes">
            {MADE.map((work, index) => {
              const meta = workTypeMeta[work.blueprintKey];
              const done = made.has(work._id);
              return (
                <li key={work._id} style={{ ...workCardStyle(work.blueprintKey), "--i": index } as React.CSSProperties} data-made={done || undefined}>
                  <span className="work-card-tab">
                    <Icon name={meta.glyph} size={13} />
                    {meta.label}
                  </span>
                  <span className="landing-fan-made-face">{done ? work.title : <span className="landing-fan-ghost" aria-label="Being made" />}</span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="landing-folder" data-phase={phase} {...targetAttrs("make/folder", undefined, "surface")} aria-hidden={phase !== "filed"}>
          <div className="landing-folder-head">
            <span className="landing-folder-name">Biology SL</span>
            <span className="landing-folder-sub">Revision for Thursday</span>
          </div>
          <div className="landing-folder-tabs" role="tablist" aria-label="Revision for Thursday">
            {MADE.map((work) => {
              const meta = workTypeMeta[work.blueprintKey];
              return (
                <button
                  key={work._id}
                  type="button"
                  role="tab"
                  aria-selected={active === work._id}
                  className="landing-folder-tab"
                  style={workCardStyle(work.blueprintKey)}
                  onClick={() => setActive(work._id)}
                  tabIndex={phase === "filed" ? 0 : -1}
                >
                  <Icon name={meta.glyph} size={13} />
                  {work.title}
                </button>
              );
            })}
            <button type="button" className="landing-folder-side" onClick={() => openWorkInSide(activeWork._id)} tabIndex={phase === "filed" ? 0 : -1}>
              Open beside
            </button>
          </div>
          <div className="landing-folder-body" role="tabpanel">
            {phase === "filed" ? <InlineStudio key={activeWork._id} work={activeWork} instanceKey={`landing-make-${activeWork._id}`} /> : null}
          </div>
        </div>
      </Surface>

      <div className="landing-more" data-open={more || undefined}>
        {more ? (
          <>
            <p className="landing-more-line">The same place holds the rest of the work: sheets for a lab, essays, drafts a teacher can comment on.</p>
            <StoryCards works={MORE} className="landing-more-cards" />
          </>
        ) : (
          <button type="button" className="landing-button" onClick={() => setMore(true)}>
            Show more kinds of work
          </button>
        )}
      </div>
    </section>
  );
}
