"use client";

/**
 * Text that an actor writes.
 *
 * The visible characters are driven straight from the story clock into the
 * DOM, so a headline can be authored at sixty frames a second without React
 * touching the tree. The trailing characters carry the product's own shimmer
 * while the caret is live, and the caret itself is the presence layer's, not a
 * decorative bar drawn here.
 *
 * Once a line is finished it stays finished. Scrubbing backwards past its
 * start removes it as a block rather than un-typing it: watching a person type
 * in reverse is uncanny, and the product already has a grammar for content
 * arriving and leaving.
 *
 * Because the characters are written imperatively, the markup on its own says
 * nothing. So every line also renders its finished text once, off-screen, for
 * assistive technology and for anything reading the page rather than watching
 * it. That mirror is the page's real content; the animated copy is the
 * performance of it, and is hidden from the accessibility tree.
 */

import { useEffect, useRef, type ElementType } from "react";
import { onStoryFrame } from "./story-clock";
import { storyMotion } from "./story-motion";
import { authoredText, authoringAt, type Beat } from "./beats";
import { targetAttrs } from "@/features/spectra/collaboration/target-attributes";
import { actorColor } from "./actors";
import type { SceneId } from "./timeline";

/** What `Authored` promises to pass to whatever tag it is asked to render. */
type HostProps = {
  ref: React.Ref<HTMLElement>;
  className: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
} & Record<`data-${string}`, string | undefined>;

export function Authored({
  beats,
  scene,
  path,
  as: Tag = "span",
  className,
  /** Rendered before the authored text, e.g. a line that is already committed. */
  prefix,
  style,
}: {
  beats: readonly Beat[];
  scene: SceneId;
  path: string;
  as?: ElementType;
  className?: string;
  prefix?: string;
  style?: React.CSSProperties;
}) {
  /* `as` is authored per call site, so the tag is not statically known. The
     props below are valid on every element this is used with; the cast keeps
     that promise at the one boundary rather than spreading `any` through the
     component. `ComponentType` rather than `ElementType` deliberately: the
     latter would resolve against every intrinsic element in the JSX namespace,
     and that union is large enough for the compiler to refuse to represent it. */
  const Host = Tag as React.ComponentType<HostProps>;
  const hostRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLSpanElement>(null);
  const tailRef = useRef<HTMLSpanElement>(null);

  useEffect(
    () =>
      onStoryFrame((frame) => {
        const host = hostRef.current;
        const head = headRef.current;
        const tail = tailRef.current;
        if (!host || !head || !tail) return;
        const t = frame.scene === scene ? frame.t : frame.index > 0 ? 1 : 0;
        const authored = authoringAt(beats, path, frame.scene === scene ? t : 1);
        if (!authored.text) {
          if (host.dataset.empty !== "true") {
            host.dataset.empty = "true";
            head.textContent = "";
            tail.textContent = "";
          }
          return;
        }
        if (host.dataset.empty === "true") host.dataset.empty = "false";

        /* In calm mode a line arrives whole. The visitor still controls when it
           arrives, because that is their own scroll — what they are spared is
           text assembling itself in front of them. */
        const calm = storyMotion.reduced;
        const count = calm
          ? authored.count > 0
            ? authored.text.length
            : 0
          : authored.count;
        /* The last few characters are the live edge: they carry the shimmer
           while the actor is still writing, and settle the moment they stop. */
        const edge = authored.writing && !calm ? Math.min(3, count) : 0;
        const settled = authored.text.slice(0, count - edge);
        const live = authored.text.slice(count - edge, count);
        if (head.textContent !== settled) head.textContent = settled;
        if (tail.textContent !== live) tail.textContent = live;

        const writing = authored.writing && !calm ? "true" : "false";
        if (host.dataset.writing !== writing) {
          host.dataset.writing = writing;
          host.style.setProperty(
            "--authored-ink",
            authored.actor ? actorColor(authored.actor) : "transparent",
          );
        }
      }),
    [beats, path, scene],
  );

  return (
    <Host
      ref={hostRef}
      className={className ? `spectra-authored ${className}` : "spectra-authored"}
      style={style}
      data-empty="true"
      {...targetAttrs(path)}
    >
      {/* The performance. Hidden from the accessibility tree, because a screen
          reader announcing a headline three characters at a time is not a
          reading of this page, it is an assault on it. */}
      <span aria-hidden="true">
        {prefix}
        <span ref={headRef} />
        <span ref={tailRef} className="spectra-authored-edge" />
      </span>
      {/* The content. Present from the first byte, in the right order, for
          anyone reading the page rather than watching it. */}
      <span className="spectra-authored-read">
        {prefix}
        {authoredText(beats, path)}
      </span>
    </Host>
  );
}

/**
 * A block that only exists once the story has reached it.
 *
 * Objects on the landing are placed by actors, so this never fades anything
 * up out of nothing: it gates whether the object is on the canvas at all, and
 * the object's own entrance grammar (a drag, an expansion, an emission) does
 * the rest.
 */
export function Staged({
  scene,
  at,
  children,
  className,
  style,
}: {
  scene: SceneId;
  /** Scene-local progress at which the object joins the canvas. */
  at: number;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      onStoryFrame((frame) => {
        const node = hostRef.current;
        if (!node) return;
        const past =
          frame.scene === scene ? frame.t >= at : sceneOrder(frame.scene, scene);
        const value = past ? "true" : "false";
        if (node.dataset.present !== value) node.dataset.present = value;
      }),
    [at, scene],
  );

  return (
    <div
      ref={hostRef}
      className={className ? `spectra-staged ${className}` : "spectra-staged"}
      data-present="false"
      style={style}
    >
      {children}
    </div>
  );
}

const ORDER: SceneId[] = [
  "wake",
  "hero",
  "prepare",
  "transform",
  "living",
  "contention",
  "dock",
  "workbench",
  "references",
  "calendar",
  "foundry",
  "scale",
  "reveal",
];

/** True when `current` is at or past `scene`. */
function sceneOrder(current: SceneId, scene: SceneId): boolean {
  return ORDER.indexOf(current) > ORDER.indexOf(scene);
}
