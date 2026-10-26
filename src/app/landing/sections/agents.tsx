"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/icons";
import { workTypeMeta } from "@/features/spectra/artifacts/presentation";
import { workCardStyle } from "@/features/spectra/components/work-card";
import { targetAttrs } from "@/features/spectra/collaboration/target-attributes";
import { useBuild, useSteps } from "../kit/build";
import { Surface, usePresence } from "../kit/presence";

/*
 * For teachers. Ms Gonzalez has an agent read last week's source analyses
 * against her rubric. Her AI goes through the class one by one, gives each a
 * first mark with the reason, and puts the ones it is unsure of first. Then
 * she opens one: the mark is hers to decide.
 */

type Submission = { name: string; marks?: [number, number, number]; flag?: string };

const CLASS: Submission[] = [
  { name: "Amara", marks: [5, 4, 5] },
  { name: "Ben", marks: [4, 4, 3] },
  { name: "Chloé", flag: "The second source is never named" },
  { name: "Daniel", marks: [6, 5, 5] },
  { name: "Elif", marks: [3, 4, 4] },
  { name: "Farah", marks: [5, 5, 4] },
  { name: "Gabriel", marks: [4, 3, 4] },
  { name: "Henry", marks: [5, 4, 4] },
  { name: "Isla", flag: "Over the word limit by 240" },
  { name: "Jonas", marks: [4, 5, 4] },
  { name: "Kaito", marks: [6, 6, 5] },
  { name: "Lucía", marks: [5, 4, 5] },
  { name: "Mateo", marks: [3, 3, 4] },
  { name: "Nadia", marks: [5, 5, 5] },
  { name: "Omar", marks: [4, 4, 4] },
  { name: "Priya", marks: [6, 5, 6] },
  { name: "Quinn", marks: [4, 3, 3] },
  { name: "Rosa", flag: "Reads like a different voice from the draft" },
  { name: "Sami", marks: [5, 4, 4] },
  { name: "Tomás", marks: [4, 5, 5] },
  { name: "Uma", marks: [5, 5, 4] },
  { name: "Viktor", marks: [3, 4, 3] },
  { name: "Wen", marks: [6, 5, 5] },
  { name: "Yusuf", marks: [4, 4, 5] },
];

const READ_MS = 240;
const DURATIONS = [1200, ...CLASS.map(() => READ_MS), 1600, 2600, 2400];
const START = 2;
const END = START + CLASS.length - 1;

export function Agents() {
  const ref = useRef<HTMLElement>(null);
  const step = useSteps(useBuild(ref, 0.45), DURATIONS);
  const presence = usePresence("agents");
  const read = Math.max(0, Math.min(CLASS.length, step - START + 1));
  const sorted = step > END;
  const opened = step > END + 1;
  const { move, leave } = presence;

  useEffect(() => {
    if (step === 1) move("gonzalez", { path: "agents/agent/run", primitive: "button", act: { kind: "press" }, label: "Run on 24 submissions" });
    else if (step >= START && step <= END) {
      leave("gonzalez");
      move("gonzalezAi", { path: `agents/class/${step - START}`, primitive: "listItem", act: { kind: "focus" }, label: CLASS[step - START]!.name, note: "Reading against the rubric" });
    } else if (step === END + 1) {
      move("gonzalezAi", { path: "agents/class", primitive: "surface", act: { kind: "reorder", from: 8, to: 0 }, note: "Three to look at first" });
    } else if (step === END + 2) {
      leave("gonzalezAi");
      move("gonzalez", { path: "agents/class/2", primitive: "listItem", act: { kind: "press" }, label: "Chloé" });
    } else if (step > END + 2) {
      move("gonzalez", { path: "agents/open/mark", primitive: "dropdown", act: { kind: "menuOpen" }, label: "Criterion A" });
    }
  }, [leave, move, step]);

  const order = sorted ? [...CLASS.keys()].sort((a, b) => Number(Boolean(CLASS[b]!.flag)) - Number(Boolean(CLASS[a]!.flag))) : [...CLASS.keys()];

  return (
    <section ref={ref} id="teachers" className="landing-section landing-agents" data-stage="agents" aria-labelledby="agents-title">
      <div className="landing-copy">
        <h2 id="agents-title" className="landing-heading">
          For teachers, an agent takes the first pass.
        </h2>
        <p className="landing-lede">
          Ms Gonzalez sets an agent to read last week&rsquo;s source analyses against her rubric. It gives each a first mark
          with the line it is based on and puts the ones it is unsure of at the top. Every mark is still hers.
        </p>
      </div>
      <Surface id="agents" states={presence.states} className="landing-agents-stage">
        <article className="landing-agent" style={workCardStyle("agent")}>
          <span className="work-card-tab">
            <Icon name={workTypeMeta.agent.glyph} size={13} />
            {workTypeMeta.agent.label}
          </span>
          <div className="landing-agent-face">
            <h3>First reader: source analysis</h3>
            <p className="landing-agent-owner">Ms Gonzalez, for History HL</p>
            <p className="landing-agent-instructions">
              Read each analysis against the rubric. For every criterion give a mark out of 6 and quote the sentence it rests
              on. If you are not sure, say why and put it first. Never write to the student.
            </p>
            <p className="landing-agent-uses">
              <span>Uses</span> Source analysis rubric, the source pack
            </p>
            <button type="button" className="landing-agent-run" data-pressed={step >= 1 || undefined} tabIndex={-1} {...targetAttrs("agents/agent/run", undefined, "button")}>
              {step === 0 ? "Run on 24 submissions" : read < CLASS.length ? `Reading ${read} of 24` : "24 read"}
            </button>
          </div>
        </article>

        <div className="landing-class" {...targetAttrs("agents/class", undefined, "surface")}>
          <p className="landing-class-head">
            Paper 1 practice: the Reichstag Fire
            <span>{sorted ? "3 to look at first" : `${read} of 24 read`}</span>
          </p>
          <ol className="landing-class-list">
            {order.map((index) => {
              const entry = CLASS[index]!;
              const done = index < read;
              return (
                <li
                  key={entry.name}
                  className="landing-sub"
                  data-done={done || undefined}
                  data-flag={done && entry.flag ? "" : undefined}
                  data-open={(opened && index === 2) || undefined}
                  {...targetAttrs(`agents/class/${index}`, undefined, "listItem")}
                >
                  <span className="landing-sub-name">{entry.name}</span>
                  {!done ? (
                    <span className="landing-sub-wait">Not read yet</span>
                  ) : entry.flag ? (
                    <span className="landing-sub-flag">{entry.flag}</span>
                  ) : (
                    <span className="landing-sub-marks">
                      A {entry.marks![0]} <span aria-hidden>/</span> B {entry.marks![1]} <span aria-hidden>/</span> C {entry.marks![2]}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {opened ? (
            <div className="landing-sub-open">
              <p className="landing-sub-quote">
                &ldquo;The other source shows the Nazis wanted to look legal, which is useful because it is from the time.&rdquo;
              </p>
              <p className="landing-sub-why">Which source? The analysis never names it, so Criterion A is unclear.</p>
              <label className="landing-sub-mark" {...targetAttrs("agents/open/mark", undefined, "dropdown")}>
                Criterion A
                <select defaultValue="3" aria-label="Mark for Criterion A">
                  {[1, 2, 3, 4, 5, 6].map((mark) => (
                    <option key={mark} value={mark}>
                      {mark} of 6
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </div>
      </Surface>
    </section>
  );
}
