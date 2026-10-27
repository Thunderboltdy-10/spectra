"use client";

import { useEffect, useRef, useState, type ElementType } from "react";

/*
 * A heading Spectra writes, the way it writes in a document (MOTION.md,
 * "Spectra writing"): the words are there at once, faint, and resolve from a
 * slight blur a word at a time while a soft spectral band crosses behind
 * them and the prism caret rides the end of the line. It is done in well
 * under a second, so the heading reads as soon as it is seen.
 */

const PER_WORD = 34;

export function Written({
  as: Tag = "h2",
  text,
  id,
  className,
  delay = 0,
}: {
  as?: ElementType;
  text: string;
  id?: string;
  className?: string;
  /** Milliseconds after it comes into view. */
  delay?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  // A line break in the text is a line of its own; the words count on across lines.
  const words = text.split(/\s+/);
  let counted = 0;
  const lines = text
    .split("\n")
    .map((line) => line.split(" ").map((word) => ({ word, index: counted++ })));
  const label = text.replace(/\n/g, " ");
  const [shown, setShown] = useState(0);
  const [state, setState] = useState<"waiting" | "writing" | "written">(
    "waiting",
  );

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(words.length);
      setState("written");
      return;
    }
    let timer = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        const start = performance.now() + delay;
        const step = () => {
          const count = Math.max(
            0,
            Math.ceil((performance.now() - start) / PER_WORD),
          );
          setState(count > 0 ? "writing" : "waiting");
          setShown(Math.min(words.length, count));
          if (count < words.length) timer = window.setTimeout(step, 16);
          else timer = window.setTimeout(() => setState("written"), 520);
        };
        step();
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
    // The words are fixed for a heading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay]);

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
          {line.map(({ word, index }) => (
            <span key={index}>
              <span className="sp-w" data-on={index < shown || undefined}>
                {word}
              </span>
              {index === shown - 1 && state === "writing" ? (
                <span className="sp-written-caret" />
              ) : null}
              {index < words.length - 1 ? " " : null}
            </span>
          ))}
        </span>
      ))}
    </Tag>
  );
}
