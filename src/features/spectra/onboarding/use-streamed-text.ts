"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSpectraMotionSnapshot } from "../motion/motion-level";

/*
 * Spectra's tour note arrives the way its replies do: a few words at a time,
 * pausing briefly after a clause and longer after a sentence. Reduced motion
 * shows the whole note at once, and finish() lets an impatient reader skip
 * to the end.
 */

const WORD_MS = 34;
const CLAUSE_MS = 120;
const SENTENCE_MS = 260;

function pauseAfter(word: string) {
  if (/[.!?]$/.test(word)) return SENTENCE_MS;
  if (/[,;:]$/.test(word)) return CLAUSE_MS;
  return WORD_MS + Math.min(30, word.length * 2);
}

export function useStreamedText(text: string) {
  const words = useMemo(() => text.split(/(?<=\s)/), [text]);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (getSpectraMotionSnapshot().disabled) {
      setCount(Number.MAX_SAFE_INTEGER);
      return;
    }
    setCount(0);
    let shown = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      shown += 1;
      setCount(shown);
      if (shown < words.length) timer = setTimeout(next, pauseAfter(words[shown - 1]!.trim()));
    };
    timer = setTimeout(next, 180);
    return () => clearTimeout(timer);
  }, [words]);

  const finish = useCallback(() => setCount(Number.MAX_SAFE_INTEGER), []);
  const done = count >= words.length;
  return { shown: done ? text : words.slice(0, count).join(""), done, finish };
}
