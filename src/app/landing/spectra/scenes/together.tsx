"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/icons";
import { SpectraMark } from "@/components/spectra-mark";
import { RevealLine } from "../reveal-line";
import { prefersStill, useArrived, useSteps, useTyped } from "../use-motion";
import { GROUP } from "../world";

/*
 * A group project, live. Leo's index cards become a slide; Leo selects the
 * chart, Ms Reyes asks where the numbers come from, and Spectra writes the
 * source in under it, so the question is answered before anyone has to.
 * Everyone is in the same slide at the same moment, each in their own colour.
 */

const CARDS = ["Floods displaced 19.2 million in 2023", "Most moves stay inside a country", "Storms: Philippines, Bangladesh, China"];

function Cursor({ name, hue, x, y, shown }: { name: string; hue: string; x: string; y: string; shown: boolean }) {
  return (
    <span className="sp-cursor" data-shown={shown || undefined} style={{ "--x": x, "--y": y, "--hue": hue } as CSSProperties} aria-hidden>
      <svg width="16" height="18" viewBox="0 0 16 18">
        <path d="M1 1 L1 15 L5 11 L8 17 L10.5 16 L7.6 10 L13 10 Z" />
      </svg>
      <span className="sp-cursor-name">{name}</span>
    </span>
  );
}

export function Together() {
  const ref = useRef<HTMLElement>(null);
  const on = useArrived(ref);
  const [still, setStill] = useState(false);
  useEffect(() => setStill(prefersStill()), []);
  // cards → slide → bars → Leo selects → Ms Reyes asks → Spectra answers → resolved → the line
  const step = useSteps(on, [0, 900, 1500, 2400, 3400, 4500, 7000, 7600], still);
  const source = useTyped(GROUP.source, step >= 6, still, 24);
  const top = Math.max(...GROUP.bars.map((bar) => bar.value));

  return (
    <section ref={ref} className="sp-together" aria-label="Group work, live, with your teacher">
      <div className="sp-together-line">
        <RevealLine as="h2" on={step >= 8} text="Your group, your teacher and Spectra." className="sp-say" />
        <RevealLine as="p" on={step >= 8} text="Same slide, same moment." className="sp-say sp-say--soft" delay={6} />
      </div>
      <div className="sp-together-stage" data-beam>
        <div className="sp-cards-fan" data-gathered={step >= 2 || undefined} aria-hidden>
          {CARDS.map((card, index) => (
            <span key={card} className="sp-index-card" style={{ "--i": index } as CSSProperties} data-shown={step >= 1 || undefined}>
              <span className="sp-index-card-who">Leo&apos;s notes</span>
              {card}
            </span>
          ))}
        </div>

        <div className="sp-editor" data-shown={step >= 2 || undefined} aria-hidden>
          <div className="sp-editor-bar">
            <span className="sp-editor-file">
              <Icon name="slides" size={15} />
              {GROUP.deck}
            </span>
            <span className="sp-presence">
              {GROUP.people.map((person) => (
                <span key={person.name} style={{ "--hue": person.hue } as CSSProperties}>
                  {person.name}
                </span>
              ))}
              <span data-spectra>
                <SpectraMark size={12} />
                Spectra
              </span>
            </span>
          </div>
          <div className="sp-editor-body">
            <div className="sp-editor-strip">
              {[0, 1, 2, 3].map((index) => (
                <span key={index} data-on={index === 1 || undefined}>
                  <i />
                  <i />
                </span>
              ))}
            </div>
            <div className="sp-slide-canvas">
              <p className="sp-slide-canvas-title">Disasters move more people than conflict</p>
              <p className="sp-slide-canvas-sub">New internal displacements caused by disasters, millions</p>
              <div className="sp-chart" data-selected={(step >= 4 && step < 7) || undefined}>
                {GROUP.bars.map((bar, index) => (
                  <span key={bar.label} className="sp-bar" style={{ "--h": bar.value / top, "--i": index } as CSSProperties} data-grown={step >= 3 || undefined}>
                    <span className="sp-bar-value">{bar.value}</span>
                    <span className="sp-bar-fill" />
                    <span className="sp-bar-label">{bar.label}</span>
                  </span>
                ))}
                <span className="sp-chart-handles" />
              </div>
              <p className="sp-chart-source" data-shown={step >= 6 || undefined}>
                {source}
                {step >= 6 && source.length < GROUP.source.length ? <span className="sp-caret" data-spectral /> : null}
              </p>
              <div className="sp-pin" data-shown={step >= 5 || undefined} data-resolved={step >= 7 || undefined}>
                <span className="sp-pin-dot">{step >= 7 ? <Icon name="check" size={12} /> : null}</span>
                <span className="sp-pin-bubble">
                  <span className="sp-pin-who">Ms Reyes</span>
                  {GROUP.comment}
                  <span className="sp-pin-state">{step >= 7 ? "Resolved by Spectra" : ""}</span>
                </span>
              </div>
            </div>
          </div>
          <Cursor name="Leo" hue="var(--ink-green)" x={step >= 4 ? "44%" : "70%"} y={step >= 4 ? "70%" : "96%"} shown={step >= 2} />
          <Cursor name="Ms Reyes" hue="var(--ink-orange)" x={step >= 5 ? "93%" : "98%"} y={step >= 5 ? "66%" : "16%"} shown={step >= 3} />
        </div>
      </div>
    </section>
  );
}
