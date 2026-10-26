"use client";

import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/icons";
import { SpectraMark } from "@/components/spectra-mark";
import { RevealLine } from "../reveal-line";
import { prefersStill, useArrived, useSteps } from "../use-motion";
import { BRIEF, WEEK } from "../world";

/*
 * The morning. Spectra writes Maya a short letter before she is up: what
 * happened yesterday and four things worth doing today, each one ready to
 * act on. The sun rises over the scene as the reader scrolls toward it and
 * reaches seven o'clock as the letter unfolds; one of the four moves is taken
 * at once and flies into Tuesday, and another can be pressed.
 */

/** The school week; the weekend stays off the page. */
const SCHOOL_WEEK = WEEK.slice(0, 5);

export function Morning() {
  const ref = useRef<HTMLElement>(null);
  const deskRef = useRef<HTMLDivElement>(null);
  const on = useArrived(ref, "0px 0px -30% 0px");
  const [still, setStill] = useState(false);
  useEffect(() => setStill(prefersStill()), []);
  // folded → top opens → bottom opens → moves → "Add task" pressed → it lands in Tuesday → the line
  const step = useSteps(on, [200, 800, 1350, 2000, 3300, 3700, 4300], still);
  const [made, setMade] = useState<"idle" | "making" | "made">("idle");
  const [flight, setFlight] = useState<{ from: DOMRect; to: DOMRect } | null>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const tuesdayRef = useRef<HTMLDivElement>(null);

  // The pressed move leaves its row and lands in Tuesday.
  useEffect(() => {
    if (step < 6 || still) return;
    const from = addRef.current?.getBoundingClientRect();
    const to = tuesdayRef.current?.getBoundingClientRect();
    const desk = deskRef.current?.getBoundingClientRect();
    if (!from || !to || !desk) return;
    setFlight({
      from: new DOMRect(from.left - desk.left, from.top - desk.top, from.width, from.height),
      to: new DOMRect(to.left - desk.left, to.top - desk.top, to.width, to.height),
    });
    const timer = window.setTimeout(() => setFlight(null), 900);
    return () => window.clearTimeout(timer);
  }, [step, still]);

  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const sun = useSpring(scrollYProgress, { stiffness: 80, damping: 22 });
  const sunX = useTransform(sun, [0, 1], ["-34%", "0%"]);
  const sunY = useTransform(sun, [0, 1], [150, 0]);
  const skyGlow = useTransform(sun, [0, 1], [0.25, 1]);
  const ribbonTurn = useTransform(sun, [0, 1], [-14, 0]);

  const added = step >= 7;
  return (
    <section ref={ref} className="sp-morning" aria-label="A letter each morning">
      <motion.div className="sp-sky" style={{ opacity: skyGlow }} aria-hidden>
        <div className="sp-sky-arc" />
        <motion.div className="sp-sun" style={{ x: sunX, y: sunY }}>
          <span />
        </motion.div>
      </motion.div>

      <div ref={deskRef} className="sp-morning-desk">
        <div className="sp-letter" data-step={step} data-beam>
          <div className="sp-letter-panel" data-panel="top" data-open={step >= 2 || undefined}>
            <div className="sp-letter-front">
              <div className="sp-letter-head">
                <SpectraMark size={18} />
                <span>Spectra</span>
                <span className="sp-letter-time">{BRIEF.wake}</span>
              </div>
              <p className="sp-letter-greeting">Good morning, Maya.</p>
            </div>
            <div className="sp-letter-back" />
          </div>
          <div className="sp-letter-panel" data-panel="middle">
            <div className="sp-letter-front">
              <p className="sp-letter-yesterday">{BRIEF.yesterday}</p>
            </div>
          </div>
          <div className="sp-letter-panel" data-panel="bottom" data-open={step >= 3 || undefined}>
            <div className="sp-letter-front">
              <p className="sp-letter-label">Today</p>
              <ul className="sp-moves">
                {BRIEF.moves.map((move, index) => {
                  const pressed = move.id === "add" && step >= 5;
                  return (
                    <li key={move.id} className="sp-move" data-shown={step >= 4 || undefined} style={{ "--i": index } as CSSProperties}>
                      <div ref={move.id === "add" ? addRef : undefined} className="sp-move-body" data-gone={move.id === "add" && step >= 6 && !still ? true : undefined}>
                        <span className="sp-move-title">{move.title}</span>
                        <span className="sp-move-detail">{move.detail}</span>
                      </div>
                      {move.id === "add" ? (
                        <span className="sp-move-act" data-pressed={pressed || undefined} data-done={added || undefined}>
                          {added ? <Icon name="check" size={13} /> : null}
                          {added ? "Added to Tuesday" : move.kind}
                        </span>
                      ) : move.id === "make" ? (
                        <button
                          type="button"
                          className="sp-move-act"
                          data-live
                          data-done={made === "made" || undefined}
                          onClick={() => {
                            if (made !== "idle") return;
                            setMade("making");
                            window.setTimeout(() => setMade("made"), still ? 0 : 1400);
                          }}
                        >
                          {made === "idle" ? move.kind : made === "making" ? <Icon name="working" size={13} animate /> : <Icon name="check" size={13} />}
                          {made === "making" ? "Writing" : made === "made" ? "Ready" : null}
                        </button>
                      ) : (
                        <span className="sp-move-act" data-quiet>
                          {move.kind}
                        </span>
                      )}
                      {move.id === "make" && made === "made" ? (
                        <div className="sp-move-made">
                          <Icon name="quiz" size={14} />
                          <span>
                            <strong>Esters: 10 questions</strong>
                            <span>From Mr Okafor&apos;s slides and your notes. Takes about 8 minutes.</span>
                          </span>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="sp-letter-back" />
          </div>
        </div>

        <div className="sp-morning-side">
          <div className="sp-morning-line">
            <RevealLine as="h2" on={step >= 7} text="Your day, sorted before you wake up." className="sp-say" />
          </div>
          <motion.div className="sp-ribbon" style={{ rotateY: ribbonTurn }} aria-hidden>
          {SCHOOL_WEEK.map((day, index) => (
            <div key={day.day} ref={day.day === "Tue" ? tuesdayRef : undefined} className="sp-ribbon-day" style={{ "--i": index - 2, "--a": Math.abs(index - 2) } as CSSProperties} data-target={day.day === "Tue" || undefined}>
              <span className="sp-ribbon-name">{day.day}</span>
              {day.items.map((item) => (
                <span key={item.title} className="sp-ribbon-item" style={{ "--item-ink": item.ink } as CSSProperties}>
                  {item.title}
                </span>
              ))}
              {day.day === "Tue" && added ? (
                <span className="sp-ribbon-item" data-fresh style={{ "--item-ink": "var(--ink-blue)" } as CSSProperties}>
                  <span className="sp-ribbon-time">17:00</span>
                  Revise esters
                </span>
              ) : null}
            </div>
          ))}
          </motion.div>
        </div>

        {flight ? (
          <span
            className="sp-flight"
            aria-hidden
            style={
              {
                left: flight.from.left,
                top: flight.from.top,
                width: flight.from.width,
                "--dx": `${flight.to.left + flight.to.width / 2 - (flight.from.left + flight.from.width / 2)}px`,
                "--dy": `${flight.to.top + flight.to.height * 0.7 - (flight.from.top + flight.from.height / 2)}px`,
              } as CSSProperties
            }
          >
            Revise esters
          </span>
        ) : null}
      </div>
    </section>
  );
}
