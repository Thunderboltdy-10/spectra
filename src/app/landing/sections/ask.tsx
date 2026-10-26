"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { workTypeMeta } from "@/features/spectra/artifacts/presentation";
import { openWorkInSide } from "@/features/spectra/components/side-open";
import { inkStyle, useClassBook } from "@/features/spectra/school/use-class-book";
import { useBuild } from "../kit/build";
import { typeIntoIsland } from "../kit/landing-island";
import { SceneHead } from "../kit/scene-head";
import { useWorld, useWorldEvent } from "../kit/world-context";
import { SUGGESTED } from "../world/replies";
import { DEADLINES } from "../world/school";
import { dayAt, dayName } from "../world/story";
import { WORKS } from "../world/works";

/*
 * The answer to the glue. Henry asks the island the vague question he would
 * ask a friend, and the real run reads what it needs: ManageBac's tasks, his
 * notes, the IA with Ms Gonzalez's comment. Each lights in the margin while it
 * is read; the answer opens over the page in the island's own card, with its
 * citations, as it would for him.
 */

const QUESTION = "what do I actually have to do this week";
const TASKS = [DEADLINES.biologyTest, DEADLINES.problemSet, DEADLINES.essay];
const READ = [
  { work: WORKS.notes, note: "Four stages; the last is thin" },
  { work: WORKS.ia, note: "One open comment from Ms Gonzalez" },
];

export function Ask() {
  const ref = useRef<HTMLElement>(null);
  const build = useBuild(ref, 0.5);
  const book = useClassBook();
  const world = useWorld();
  const [reading, setReading] = useState<string | null>(null);
  const [read, setRead] = useState<ReadonlySet<string>>(() => new Set());
  const asked = useRef(false);

  useWorldEvent((event) => {
    if (event.type === "reading") {
      const id = event.workId ?? "tasks";
      setReading(id);
      setRead((was) => new Set(was).add(id));
    }
    if (event.type === "run_finished") setReading(null);
  });

  useEffect(() => {
    if (!build.started || build.skipped || asked.current) return;
    asked.current = true;
    const timer = window.setTimeout(() => void world.whenIdle().then(() => typeIntoIsland(QUESTION, { fresh: true })), 700);
    return () => window.clearTimeout(timer);
  }, [build.skipped, build.started, world]);

  const state = (id: string) => (reading === id ? "reading" : read.has(id) ? "read" : undefined);

  return (
    <section data-stage="ask" data-island="on" ref={ref} id="ask" className="landing-section landing-ask" aria-labelledby="ask-title">
      <div className="landing-ask-side">
        <SceneHead id="ask-title" at={dayAt(0, 21, 44)} title="Ask it like you would ask a friend.">
          Spectra has already read your classes, your deadlines and your notes. A vague question gets an answer about your
          week, with the places it came from.
        </SceneHead>

        <div className="landing-ask-reads" aria-label="What Spectra reads to answer">
          <p className="landing-ask-reads-head">What it reads to answer</p>
          <div className="landing-ask-source" data-state={state("tasks")}>
            <p className="landing-ask-source-name">
              <Icon name="school" size={14} />
              ManageBac
              <span>Due this week</span>
            </p>
            <ul>
              {TASKS.map((task) => (
                <li key={task.id} style={inkStyle(book.of(task.classId ?? null, null))}>
                  <i aria-hidden />
                  <span>{task.title}</span>
                  <time>{dayName(task.startAt!)}</time>
                </li>
              ))}
            </ul>
          </div>
          {READ.map(({ work, note }) => (
            <button key={work._id} type="button" className="landing-ask-source" data-state={state(work._id)} onClick={() => openWorkInSide(work._id)}>
              <span className="landing-ask-source-name">
                <Icon name={workTypeMeta[work.blueprintKey].glyph} size={14} />
                {work.title}
                <span>{work.placements?.[0]?.workspaceTitle}</span>
              </span>
              <span className="landing-ask-source-note">{note}</span>
            </button>
          ))}
        </div>

        <div className="landing-chips" aria-label="Ask something else">
          {SUGGESTED.map((text) => (
            <button key={text} type="button" className="landing-chip" onClick={() => void world.whenIdle().then(() => typeIntoIsland(text, { fresh: true, perLetter: 26 }))}>
              {text}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
