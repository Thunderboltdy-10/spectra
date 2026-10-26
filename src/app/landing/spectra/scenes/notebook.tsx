"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "@/components/icons";
import { RevealLine } from "../reveal-line";
import { prefersStill, useArrived, useSteps, useTyped } from "../use-motion";
import { BOOK_THREAD, SOURCES } from "../world";

/*
 * Maya's chemistry exercise book. Its cover opens on the spine; the left page
 * is everything Spectra has read for this class (the IA task from ManageBac,
 * Mr Okafor's slides, her own notes, files on her laptop) and the right page
 * is her question and its answer. As each part of the answer is written, a
 * thread of light crosses the gutter to the exact sentence it came from and
 * a highlighter runs over it. Pointing at a numbered mark shows it again.
 */

const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function Notebook() {
  const ref = useRef<HTMLElement>(null);
  const on = useArrived(ref);
  const [still, setStill] = useState(false);
  useEffect(() => setStill(prefersStill()), []);
  // cover opens → sources settle → question typed → answer parts 1, 2, 3 → the line
  const step = useSteps(on, [100, 1100, 1700, 3700, 5000, 6300, 7000, 8600], still);
  const asked = useTyped(BOOK_THREAD.ask, step >= 3, still, 30);
  const written = Math.max(0, Math.min(BOOK_THREAD.answer.length, step - 3));
  const [pointed, setPointed] = useState<number | null>(null);
  const lastCite = [...BOOK_THREAD.answer.slice(0, written)].reverse().find((part) => part.cite !== null)?.cite ?? null;
  const showing = pointed ?? (step >= 8 ? null : lastCite);

  const spreadRef = useRef<HTMLDivElement>(null);
  const [arc, setArc] = useState<string | null>(null);
  useIsoLayout(() => {
    const spread = spreadRef.current;
    if (!spread || showing === null) {
      setArc(null);
      return;
    }
    const source = spread.querySelector<HTMLElement>(`[data-source="${showing}"] .sp-source-quote`);
    const mark = spread.querySelector<HTMLElement>(`[data-cite-mark="${showing}"]`);
    if (!source || !mark) return setArc(null);
    const box = spread.getBoundingClientRect();
    const a = source.getBoundingClientRect();
    const b = mark.getBoundingClientRect();
    const from = { x: a.right - box.left + 6, y: a.top - box.top + a.height / 2 };
    const to = { x: b.left - box.left + b.width / 2, y: b.top - box.top + b.height / 2 };
    const lift = Math.max(60, Math.abs(to.x - from.x) * 0.3);
    setArc(`M ${from.x} ${from.y} C ${from.x + lift} ${from.y - lift * 0.6}, ${to.x - lift} ${to.y - lift * 0.6}, ${to.x} ${to.y}`);
  }, [showing, written, step]);

  return (
    <section ref={ref} className="sp-notebook" aria-label="Answers from your own class material">
      <div className="sp-notebook-line">
        <RevealLine as="h2" on={step >= 8} text="It's read everything." className="sp-say" />
        <RevealLine as="p" on={step >= 8} text="Even the slides you missed." className="sp-say sp-say--soft" delay={3} />
      </div>
      <div className="sp-book" data-open={step >= 1 || undefined} data-beam>
        <div className="sp-book-cover" aria-hidden>
          <div className="sp-book-cover-front">
            <span className="sp-book-label">
              <span>Chemistry HL</span>
              <span>Maya Lindgren · DP1</span>
            </span>
          </div>
          <div className="sp-book-cover-inside" />
        </div>
        <div ref={spreadRef} className="sp-book-spread">
          <div className="sp-leaf" data-page="left">
            <p className="sp-leaf-head">What Spectra has read for this class</p>
            <ul className="sp-sources">
              {SOURCES.map((source, index) => (
                <li
                  key={source.id}
                  className="sp-source"
                  data-source={index}
                  data-shown={step >= 2 || undefined}
                  data-lit={showing === index || undefined}
                  style={{ "--i": index } as CSSProperties}
                >
                  <span className="sp-source-glyph">
                    <Icon name={source.glyph as IconName} size={15} />
                  </span>
                  <span className="sp-source-body">
                    <span className="sp-source-title">{source.title}</span>
                    <span className="sp-source-meta">{source.meta}</span>
                    {source.quote ? (
                      <span className="sp-source-quote">
                        <span className="sp-mark">{source.quote}</span>
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="sp-leaf" data-page="right">
            <div className="sp-thread">
              {step >= 3 ? (
                <p className="sp-thread-ask">
                  {asked}
                  {asked.length < BOOK_THREAD.ask.length ? <span className="sp-caret" /> : null}
                </p>
              ) : null}
              {written > 0 ? (
                <p className="sp-thread-answer">
                  {BOOK_THREAD.answer.slice(0, written).map((part, index) => (
                    <span key={index} className="sp-thread-part">
                      {part.text}
                      {part.cite !== null ? (
                        <button
                          type="button"
                          className="sp-cite"
                          data-cite-mark={part.cite}
                          data-lit={showing === part.cite || undefined}
                          onPointerEnter={() => setPointed(part.cite)}
                          onPointerLeave={() => setPointed(null)}
                          onFocus={() => setPointed(part.cite)}
                          onBlur={() => setPointed(null)}
                          aria-label={`Source: ${SOURCES[part.cite].title}`}
                        >
                          {part.cite + 1}
                        </button>
                      ) : null}
                    </span>
                  ))}
                </p>
              ) : step >= 3 && asked.length === BOOK_THREAD.ask.length ? (
                <p className="sp-thread-reading">
                  <Icon name="working" size={14} animate />
                  Reading 5 sources
                </p>
              ) : null}
            </div>
          </div>
          {arc ? (
            <svg className="sp-book-arc" aria-hidden>
              <defs>
                <linearGradient id="sp-arc-light" x1="0" x2="1">
                  <stop offset="0" stopColor="#ffab4a" />
                  <stop offset="0.5" stopColor="#ff647f" />
                  <stop offset="1" stopColor="#9176e8" />
                </linearGradient>
              </defs>
              <path key={arc} d={arc} pathLength={1} className="sp-book-arc-path" />
            </svg>
          ) : null}
        </div>
      </div>
    </section>
  );
}
