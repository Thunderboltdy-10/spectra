"use client";

/**
 * A failure in the glass must not cost the page.
 *
 * The prism is the most beautiful thing here and the least important: every
 * beat it plays is also carried by the static renderer, and the narrative is
 * identical either way. So the GL engine is fenced. If the context is lost, if
 * a driver refuses a shader, if the renderer's own lifecycle throws, the object
 * falls back to the SVG that was already composing underneath and the visitor
 * keeps the story.
 *
 * This is not defensive decoration. Without it, one throw inside the canvas
 * unmounts the entire landing tree — the scroll height collapses, the scenes
 * disappear, and the page becomes a blank frame.
 */

import { Component, type ReactNode } from "react";

export class PrismBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onFail?: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    /* Worth saying out loud in development: the page still works, so nothing
       else will point at this. */
    if (process.env.NODE_ENV !== "production") {
      console.error("[prism] engine failed, falling back to the static renderer", error);
    }
    this.props.onFail?.();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
