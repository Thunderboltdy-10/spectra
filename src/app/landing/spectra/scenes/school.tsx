"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "@/components/icons";
import { RevealLine } from "../reveal-line";
import { prefersStill, useArrived, useSteps } from "../use-motion";
import { CLASSES, SCHOOL_FACTS } from "../world";

/*
 * Day one. The school connects ManageBac once, and every student's classes
 * arrive by themselves: six books drop onto Maya's shelf, each already
 * holding its tasks. Under the shelf, the three things a school leader needs
 * to hear, and nothing more.
 */

const FACT_GLYPHS: IconName[] = ["school", "people", "shield"];
const HEIGHTS = [0.94, 0.82, 0.9, 1, 0.78, 0.86];

export function School() {
  const ref = useRef<HTMLElement>(null);
  const on = useArrived(ref);
  const [still, setStill] = useState(false);
  useEffect(() => setStill(prefersStill()), []);
  // button → pressed → books fall → counts → facts and the line
  const step = useSteps(on, [0, 900, 1700, 2900, 3500], still);

  return (
    <section ref={ref} className="sp-school" aria-label="For schools">
      <div className="sp-school-line">
        <RevealLine as="h2" on={step >= 5} text="On day one, every class is already there." className="sp-say" />
      </div>
      <div className="sp-school-stage" data-beam>
        <div className="sp-connect" data-state={step >= 3 ? "done" : step >= 2 ? "pressed" : "idle"} aria-hidden>
          <span className="sp-connect-logo">MB</span>
          <span className="sp-connect-text">
            <strong>ManageBac</strong>
            <span>{step >= 3 ? "Connected · 6 classes, 17 tasks" : step >= 2 ? "Connecting" : "Northfield International School"}</span>
          </span>
          <span className="sp-connect-button">
            {step >= 3 ? <Icon name="check" size={14} /> : step >= 2 ? <Icon name="working" size={14} animate /> : null}
            {step >= 3 ? "Connected" : "Connect"}
          </span>
        </div>
        <div className="sp-shelf" aria-hidden>
          {CLASSES.map((entry, index) => (
            <div
              key={entry.key}
              className="sp-spine"
              data-shown={step >= 3 || undefined}
              style={{ "--ink": entry.ink, "--i": index, "--h": HEIGHTS[index] } as CSSProperties}
            >
              <span className="sp-spine-name">{entry.name}</span>
              <span className="sp-spine-teacher">{entry.teacher}</span>
              <span className="sp-spine-count" data-shown={step >= 4 || undefined}>
                {entry.tasks}
              </span>
            </div>
          ))}
          <div className="sp-shelf-board" />
        </div>
        <ul className="sp-facts">
          {SCHOOL_FACTS.map((fact, index) => (
            <li key={fact.title} data-shown={step >= 5 || undefined} style={{ "--i": index } as CSSProperties}>
              <Icon name={FACT_GLYPHS[index]} size={18} />
              <strong>{fact.title}</strong>
              <span>{fact.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
