"use client";

import { useEffect, useRef } from "react";

type PageStatus = "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";

/**
 * A shelf that keeps going: put the returned ref on a mark at the end of the
 * list, and the next page is asked for as the reader scrolls near it. Only
 * what comes into view is ever read (Convex is the cost that matters).
 */
export function useLoadOnApproach(status: PageStatus, loadMore: (count: number) => void, pageSize = 24) {
  const mark = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = mark.current;
    if (!element || status !== "CanLoadMore" || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore(pageSize);
      },
      // Measured against the shelf's own scroller, so the margin reaches below the fold.
      { root: scroller(element), rootMargin: "0px 0px 600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [loadMore, pageSize, status]);
  return mark;
}

function scroller(element: HTMLElement) {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}
