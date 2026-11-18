"use client";

import { useConvex } from "convex/react";
import { useEffect, useState, type RefObject } from "react";
import { api } from "../../../../../convex/_generated/api";

/** Settings rows found by meaning (cosine against the query), on top of the literal word match. */
const MIN_SCORE = 0.38;
/** Only rows close to the best one: a vague query should not light up half the page. */
const NEAR_BEST = 0.1;
const MOST = 8;
const AFTER_MS = 250;

/** A row's identity for matching: what it says, spaced. */
export const settingText = (element: Element) =>
  element.getAttribute("data-setting-meaning") ?? (element.textContent ?? "").replace(/\s+/g, " ").trim();

/** What gets embedded: the row's words with the section and group it sits in. */
function meaningText(element: Element) {
  const section = element.closest("[data-settings-section]")?.querySelector("[data-settings-section-name]")?.textContent?.trim();
  const group = element.closest("[data-setting-group]")?.querySelector("header")?.textContent?.replace(/\s+/g, " ").trim();
  return [section, group, settingText(element)].filter(Boolean).join(" > ");
}

/** Picks the texts worth showing from their scores. Exported for tests. */
export function meaningfulTexts(texts: readonly string[], scores: readonly number[]) {
  const best = Math.max(0, ...scores);
  return new Set(
    texts
      .map((text, index) => ({ text, score: scores[index] ?? 0 }))
      .filter(({ score }) => score >= MIN_SCORE && score >= best - NEAR_BEST)
      .sort((a, b) => b.score - a.score)
      .slice(0, MOST)
      .map(({ text }) => text),
  );
}

/**
 * Asks the server which setting rows (and row-less sections) mean what the query asks, by the
 * rows' own words. Returns the matching row texts for the current query; empty while waiting,
 * when the query is short, or when embeddings are unavailable (the literal match still works).
 */
export function useSettingsMeaning(query: string, root: RefObject<HTMLElement | null>) {
  // Settings also render signed out, without a Convex client; meaning search is then skipped.
  const convex = useConvex();
  const [found, setFound] = useState<{ query: string; texts: Set<string> } | null>(null);
  const wanted = query.trim();
  useEffect(() => {
    if (wanted.length < 3 || !convex) return;
    let live = true;
    const timer = window.setTimeout(() => {
      const element = root.current;
      if (!element) return;
      const rows = [...element.querySelectorAll("[data-setting-row]")];
      const bare = [...element.querySelectorAll("[data-settings-section]")].filter((section) => !section.querySelector("[data-setting-row]"));
      const keyed = new Map<string, string>();
      for (const item of [...rows, ...bare]) {
        const key = settingText(item);
        if (key && !keyed.has(key)) keyed.set(key, meaningText(item));
      }
      const keys = [...keyed.keys()];
      const texts = [...keyed.values()];
      if (!texts.length) return;
      convex
        .action(api.semantic.rankTexts, { query: wanted, texts })
        .then(({ scores }) => {
          if (live) setFound({ query: wanted, texts: meaningfulTexts(keys, scores) });
        })
        .catch(() => {
          if (live) setFound({ query: wanted, texts: new Set() });
        });
    }, AFTER_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [convex, root, wanted]);
  return found?.query === wanted ? found.texts : EMPTY;
}

const EMPTY: ReadonlySet<string> = new Set();
