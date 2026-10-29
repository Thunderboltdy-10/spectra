"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/*
 * A heading Spectra writes. It streams in line by line, the way an answer
 * arrives: each line's words land left to right, each one lit by the part of
 * the spectrum it lands under, and the colour drains to ink behind it. The
 * whole heading is written in well under a second and a half, and reads from
 * the first word.
 *
 * A heading can carry one word that changes ("Work on it with {}"): the
 * scene says which word shows, and the old one lifts away as the new one is
 * written in its place.
 */

const SPECTRUM = ["#ff647f", "#ffab4a", "#e7b52f", "#48c997", "#4f9fe6", "#9176e8"];
const PER_LINE = 240;
const PER_WORD = 52;

/** A colour along the spectrum, 0 red to 1 violet, wrapping. */
function spectrumAt(t: number) {
  const wrapped = ((t % 1) + 1) % 1;
  return SPECTRUM[Math.min(SPECTRUM.length - 1, Math.floor(wrapped * SPECTRUM.length))]!;
}

const lessMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Groups the heading's words into the lines the browser laid them on, and times each one. */
function time(root: HTMLElement) {
  const words = [...root.querySelectorAll<HTMLElement>("[data-w]")];
  const box = root.getBoundingClientRect();
  let line = -1;
  let top = Number.NEGATIVE_INFINITY;
  let inLine = 0;
  let last = 0;
  for (const word of words) {
    const at = word.getBoundingClientRect();
    if (at.top > top + at.height * 0.5) {
      line += 1;
      top = at.top;
      inLine = 0;
    }
    const delay = line * PER_LINE + inLine * PER_WORD;
    const across = box.width ? (at.left + at.width / 2 - box.left) / box.width : 0;
    word.style.setProperty("--d", `${delay}ms`);
    word.style.setProperty("--c", spectrumAt(across * 0.85 + line * 0.17));
    inLine += 1;
    last = Math.max(last, delay);
  }
  return last;
}

export function Written({
  as: Tag = "h2",
  text,
  id,
  className,
  delay = 0,
  flip,
}: {
  as?: "h1" | "h2";
  /** A line break starts a new line; `{}` is where the changing word goes. */
  text: string;
  id?: string;
  className?: string;
  /** Milliseconds after it comes into view. */
  delay?: number;
  /** The words that take turns at `{}`, and which one shows now. */
  flip?: { words: readonly string[]; index: number };
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [state, setState] = useState<"waiting" | "writing" | "written">("waiting");
  const shownWord = flip ? flip.words[flip.index % flip.words.length]! : "";
  const label = text.replace(/\n/g, " ").replace("{}", shownWord);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    time(node);
    const sized = new ResizeObserver(() => time(node));
    sized.observe(node);
    return () => sized.disconnect();
  }, [text]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (lessMotion()) {
      setState("written");
      return;
    }
    let timer = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        timer = window.setTimeout(() => {
          const last = time(node);
          setState("writing");
          timer = window.setTimeout(() => setState("written"), last + 1200);
        }, delay);
      },
      { rootMargin: "0px 0px -14% 0px" },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [delay]);

  let counted = 0;
  const lines = text.split("\n");
  return (
    <Tag
      ref={ref}
      id={id}
      className={className ? `sp-written ${className}` : "sp-written"}
      data-state={state}
      data-light-text
      aria-label={label}
    >
      {lines.map((line, row) => (
        <span key={row} className="sp-written-line" aria-hidden>
          {line.split(" ").map((word, index, all) => {
            const key = counted++;
            const gap = index < all.length - 1 ? " " : null;
            if (word.includes("{}") && flip) {
              const [before, after] = word.split("{}");
              return (
                <span key={key} className="sp-w-group">
                  {before ? <span className="sp-w" data-w>{before}</span> : null}
                  <Flip word={shownWord} />
                  {after ? <span className="sp-w" data-w>{after}</span> : null}
                  {gap}
                </span>
              );
            }
            return (
              <span key={key}>
                <span className="sp-w" data-w>
                  {word}
                </span>
                {gap}
              </span>
            );
          })}
        </span>
      ))}
    </Tag>
  );
}

/**
 * The word that changes. Its width eases to the new word's, the old word
 * lifts and fades, and the new one is written in letter by letter through the
 * spectrum before it settles to ink.
 */
function Flip({ word }: { word: string }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState({ word, previous: null as string | null, turn: 0 });
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    setShown((was) => (was.word === word ? was : { word, previous: was.word, turn: was.turn + 1 }));
  }, [word]);

  useLayoutEffect(() => {
    const measure = measureRef.current;
    if (measure) setWidth(measure.getBoundingClientRect().width);
  }, [shown.word]);

  return (
    <span ref={boxRef} className="sp-flip" data-w style={width ? { width } : undefined}>
      <span ref={measureRef} className="sp-flip-measure" aria-hidden>
        {shown.word}
      </span>
      {shown.previous ? (
        <span key={`out-${shown.turn}`} className="sp-flip-out">
          {shown.previous}
        </span>
      ) : null}
      <span key={`in-${shown.turn}`} className="sp-flip-in" data-turn={shown.turn}>
        {[...shown.word].map((letter, index) => (
          <span
            key={index}
            style={{
              ["--i" as string]: index,
              ["--c" as string]: spectrumAt(index / Math.max(6, shown.word.length) + shown.turn * 0.23),
            }}
          >
            {letter === " " ? " " : letter}
          </span>
        ))}
      </span>
    </span>
  );
}
