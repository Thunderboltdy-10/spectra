"use client";

/**
 * Scene furniture.
 *
 * The small vocabulary every scene draws on: a headline an actor writes, a
 * marker, a body paragraph, an object that gets carried in. Nothing here is a
 * marketing component — it is the typography and placement grammar of the page,
 * shared so that thirteen scenes read as one surface rather than thirteen.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Authored } from "./authored";
import { onStoryFrame, useStoryValue } from "./story-clock";
import { beatProgress, carriedAt, type Beat } from "./beats";
import { actorColor } from "./actors";
import { useNearScene } from "./near";
import {
  partAttrs,
  targetAttrs,
} from "@/features/spectra/collaboration/target-attributes";
import type { SceneId } from "./timeline";

/* ------------------------------------------------------------------ *
 * Typography
 *
 * Five sizes for the whole page (§12). Anything outside this set is a
 * mistake, not a decision.
 * ------------------------------------------------------------------ */

export const TYPE = {
  hero: "text-[94px] leading-[0.94] tracking-[-0.045em] font-semibold",
  section: "text-[64px] leading-[1.02] tracking-[-0.035em] font-semibold",
  support: "text-display leading-[1.08] tracking-[-0.025em] font-semibold",
  body: "text-heading leading-[1.6] tracking-[-0.006em]",
  micro:
    "text-micro leading-[1.3] tracking-[0.16em] font-semibold uppercase",
} as const;

/** A small eyebrow marker. Typed by an actor, like everything else. */
export function Marker({
  beats,
  scene,
  path,
  className,
}: {
  beats: readonly Beat[];
  scene: SceneId;
  path: string;
  className?: string;
}) {
  return (
    <Authored
      beats={beats}
      scene={scene}
      path={path}
      className={`${TYPE.micro} text-[var(--text-tertiary)] ${className ?? ""}`}
    />
  );
}

/**
 * A headline. Written by an actor, one line per path.
 *
 * Lines are separate paths because they are separate acts: an actor finishes
 * one line and starts the next, and the caret has to be somewhere specific.
 */
export function Headline({
  beats,
  scene,
  paths,
  size = "section",
  className,
  accentLast = false,
}: {
  beats: readonly Beat[];
  scene: SceneId;
  paths: readonly string[];
  size?: keyof typeof TYPE;
  className?: string;
  /** Render the final line in Spectra violet. Used once, in the hero. */
  accentLast?: boolean;
}) {
  return (
    <h2
      className={`${TYPE[size]} text-[var(--text-primary)] ${className ?? ""}`}
    >
      {paths.map((path, index) => (
        <Authored
          key={path}
          beats={beats}
          scene={scene}
          path={path}
          as="span"
          className="block"
          style={
            accentLast && index === paths.length - 1
              ? { color: "var(--brand-primary)" }
              : undefined
          }
        />
      ))}
    </h2>
  );
}

/** Supporting body copy. */
export function Body({
  beats,
  scene,
  path,
  className,
}: {
  beats: readonly Beat[];
  scene: SceneId;
  path: string;
  className?: string;
}) {
  return (
    <Authored
      beats={beats}
      scene={scene}
      path={path}
      as="p"
      className={`${TYPE.body} max-w-[46ch] text-[var(--text-secondary)] ${
        className ?? ""
      }`}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Objects that arrive
 * ------------------------------------------------------------------ */

/**
 * An object an actor carries onto the canvas.
 *
 * This is the answer to "where did that come from" (§13). The object exists
 * from the moment the drag begins, travels from a stated origin, and lands.
 * Nothing on this page fades up out of nothing.
 *
 * The travel is written as a transform on a wrapper, driven by the same beat
 * that publishes the actor's drag, so the cursor and the object are genuinely
 * the same event rather than two animations that happen to agree.
 */
export function Carried({
  beats,
  scene,
  path,
  from,
  children,
  className,
  style,
}: {
  beats: readonly Beat[];
  scene: SceneId;
  path: string;
  /** Where the object comes from, in canvas px relative to its resting place. */
  from: readonly [number, number];
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      onStoryFrame((frame) => {
        const node = hostRef.current;
        if (!node) return;
        const t = frame.scene === scene ? frame.t : frame.index > 0 ? 1 : 0;
        const carried = carriedAt(beats, path, t);
        const present = carried.present ? "true" : "false";
        if (node.dataset.present !== present) node.dataset.present = present;
        if (!carried.present) return;

        /* Weight: the object lags the cursor slightly and settles rather than
           snapping. `1 - (1-p)^3` reaches the destination smoothly with the
           deceleration a real dragged object has when a hand lets go. */
        const p = carried.progress;
        const settle = 1 - (1 - p) ** 3;
        const x = from[0] * (1 - settle);
        const y = from[1] * (1 - settle);
        const lift = p > 0 && p < 1 ? (1 - Math.abs(p * 2 - 1)) * 0.014 : 0;
        node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(
          1,
        )}px, 0) scale(${(1 + lift).toFixed(4)})`;

        const carrying = p > 0.01 && p < 0.99;
        const value = carrying ? "true" : "false";
        if (node.dataset.carrying !== value) {
          node.dataset.carrying = value;
          node.style.setProperty(
            "--carry-ink",
            carried.actor ? actorColor(carried.actor) : "transparent",
          );
        }
      }),
    [beats, from, path, scene],
  );

  return (
    <div
      ref={hostRef}
      className={className ? `landing-carried ${className}` : "landing-carried"}
      data-present="false"
      style={style}
    >
      {children}
    </div>
  );
}

/**
 * A block whose own progress drives it: appears at `at`, resolved by `to`.
 *
 * Used for things that are not carried but grow — an output document
 * developing out of the prism, a shelf expanding because input is needed. The
 * child reads `--grow` and decides what that means for it, so nothing here
 * imposes a generic entrance.
 */
export function Grown({
  scene,
  at,
  to,
  children,
  className,
  style,
}: {
  scene: SceneId;
  at: number;
  to: number;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      onStoryFrame((frame) => {
        const node = hostRef.current;
        if (!node) return;
        const t = frame.scene === scene ? frame.t : frame.index > 0 ? 1 : 0;
        const raw = to > at ? (t - at) / (to - at) : t >= at ? 1 : 0;
        const grow = raw < 0 ? 0 : raw > 1 ? 1 : raw;
        const present = grow > 0.001 ? "true" : "false";
        if (node.dataset.present !== present) node.dataset.present = present;
        node.style.setProperty("--grow", grow.toFixed(4));
      }),
    [at, scene, to],
  );

  return (
    <div
      ref={hostRef}
      className={className ? `landing-grown ${className}` : "landing-grown"}
      data-present="false"
      style={style}
    >
      {children}
    </div>
  );
}

/**
 * A box an actor resizes by its handle.
 *
 * The point is not that a rectangle changes size: it is that a person decided
 * a document needed more room and pulled it open, and the presence layer's own
 * resize frame lands on the handle they pulled because the handle is a real
 * annotated part of a real target.
 */
export function Sized({
  beats,
  scene,
  path,
  from,
  to,
  handle = "handle:se",
  children,
  className,
  style,
}: {
  beats: readonly Beat[];
  scene: SceneId;
  path: string;
  /** Size before the pull, in canvas px. */
  from: readonly [number, number];
  /** Size after it. */
  to: readonly [number, number];
  handle?: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      onStoryFrame((frame) => {
        const node = hostRef.current;
        if (!node) return;
        const t = frame.scene === scene ? frame.t : frame.index > 0 ? 1 : 0;
        const beat = beats.find(
          (candidate) =>
            candidate.act.kind === "resize" && candidate.path === path,
        );
        const p = beat ? beatProgress(beat, t) : t > 0 ? 1 : 0;
        /* A hand pulling a handle does not overshoot and does not snap: it
           decelerates into the size the person wanted. */
        const eased = 1 - (1 - p) ** 3;
        node.style.width = `${Math.round(from[0] + (to[0] - from[0]) * eased)}px`;
        node.style.height = `${Math.round(
          from[1] + (to[1] - from[1]) * eased,
        )}px`;
        const live = p > 0.02 && p < 0.98 ? "true" : "false";
        if (node.dataset.resizing !== live) node.dataset.resizing = live;
      }),
    [beats, from, path, scene, to],
  );

  return (
    <div
      ref={hostRef}
      className={className ? `landing-sized ${className}` : "landing-sized"}
      data-resizing="false"
      style={{ width: from[0], height: from[1], ...style }}
      {...targetAttrs(path, undefined, "canvasObject")}
    >
      {children}
      <span
        className="landing-handle"
        aria-hidden="true"
        {...partAttrs(handle)}
      />
    </div>
  );
}

/**
 * Scene-local progress on a DOM node, for children that want to read it in CSS.
 *
 * One subscription, one custom property. Scenes use this instead of each
 * element opening its own channel to the clock.
 */
export function useSceneStyle(
  ref: React.RefObject<HTMLElement | null>,
  scene: SceneId,
) {
  useEffect(
    () =>
      onStoryFrame((frame) => {
        const node = ref.current;
        if (!node) return;
        const here = frame.scene === scene;
        const t = here ? frame.t : frame.index > 0 ? 1 : 0;
        node.style.setProperty("--scene-t", t.toFixed(4));
        const value = here ? "true" : "false";
        if (node.dataset.live !== value) node.dataset.live = value;
      }),
    [ref, scene],
  );
}

/* ------------------------------------------------------------------ *
 * Plates
 * ------------------------------------------------------------------ */

/**
 * How a real product surface is mounted on the canvas.
 *
 * A plate is a frame and a header, nothing more. It never restyles what it
 * holds: the surface inside is the product's own component, and a future
 * change to that component shows up here without anyone editing this file.
 *
 * The plate also decides *when* the surface is real. A spreadsheet, a rich
 * text editor and a workbench do not all need to be mounted while the visitor
 * is reading the hero, so a plate stands its surface up one scene ahead and
 * stands it down one scene behind, holding its own shape in between. The tall
 * page stays honest at reveal scale because the frame never left.
 */
export function Plate({
  scene,
  path,
  title,
  meta,
  trailing,
  children,
  className,
  style,
  quiet = false,
  radius = 1,
  head = true,
}: {
  scene: SceneId;
  /** Semantic path, so actors can target the surface as a whole. */
  path: string;
  title?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  quiet?: boolean;
  /** How many scenes away the surface stays mounted. */
  radius?: number;
  head?: boolean;
}) {
  const near = useNearScene(scene, radius);
  return (
    <div
      className={className ? `landing-plate ${className}` : "landing-plate"}
      data-quiet={quiet ? "true" : "false"}
      style={style}
      {...targetAttrs(path, undefined, "surface")}
    >
      {head ? (
        <div className="landing-plate-head">
          {title ? <span className="landing-plate-title">{title}</span> : null}
          {meta ? <span className="truncate">{meta}</span> : null}
          {trailing ? <span className="ml-auto flex items-center gap-2">{trailing}</span> : null}
        </div>
      ) : null}
      <div className="landing-plate-body">
        {near ? children : <div className="landing-plate-husk" aria-hidden="true" />}
      </div>
    </div>
  );
}

/**
 * Whether the story is inside a window of a scene, at step resolution.
 *
 * For structural decisions that a beat implies but cannot express: whether an
 * actor currently owns the prism, whether a panel has been opened, whether a
 * tab is the selected one. Re-renders a handful of times per traversal.
 */
/**
 * Scene-local progress at step resolution.
 *
 * For the handful of decisions that must exist in the React tree rather than in
 * CSS: whether a chip has been attached, which state a real component should be
 * handed. Quantised to 1/24 of a scene, so a traversal costs two dozen renders
 * rather than two thousand.
 */
export function useSceneT(scene: SceneId): number {
  const select = useCallback(
    (step: { scene: SceneId; step: number; index: number }) =>
      step.scene === scene ? step.step / 24 : step.index > INDEX[scene] ? 1 : 0,
    [scene],
  );
  return useStoryValue(select);
}

const INDEX: Record<SceneId, number> = {
  wake: 0,
  hero: 1,
  prepare: 2,
  transform: 3,
  living: 4,
  contention: 5,
  dock: 6,
  workbench: 7,
  references: 8,
  calendar: 9,
  foundry: 10,
  scale: 11,
  reveal: 12,
};

export function useDuring(scene: SceneId, from: number, to: number): boolean {
  const select = useCallback(
    (step: { scene: SceneId; step: number }) =>
      step.scene === scene && step.step / 24 >= from && step.step / 24 <= to,
    [scene, from, to],
  );
  return useStoryValue(select);
}

/**
 * Which of a set of views the story has switched to, at step resolution.
 *
 * A real tab rail is a real tab rail: one view is mounted, and the story
 * selects between them the way a person would.
 */
export function useSwitched<T extends string>(
  scene: SceneId,
  stops: readonly (readonly [number, T])[],
  initial: T,
): T {
  const select = useCallback(
    (step: { scene: SceneId; step: number; index: number }) => {
      const t =
        step.scene === scene ? step.step / 24 : step.index > 0 ? 1 : 0;
      let value = initial;
      for (const [at, next] of stops) if (t >= at) value = next;
      return value;
    },
    [scene, stops, initial],
  );
  return useStoryValue(select);
}

/**
 * The reading layer of a scene.
 *
 * Everything else on this page is written by an actor, which is the point — but
 * a page where every word waits for a cursor is a page with nothing to read.
 * A caption is the author's own voice: present from the first byte, standing
 * still, telling the visitor what the surface beside it is for.
 *
 * It is also the answer to a composition problem. Scenes that put all their
 * weight in one interface read as a screenshot with space around it; a column of
 * quiet text on the other side gives the frame two things to balance.
 */
export function SceneCaption({
  eyebrow,
  title,
  note,
  className,
}: {
  eyebrow?: string;
  title?: string;
  note?: string;
  className?: string;
}) {
  return (
    <div className={`landing-caption ${className ?? ""}`}>
      {eyebrow ? (
        <p className={`${TYPE.micro} text-[var(--text-tertiary)]`}>{eyebrow}</p>
      ) : null}
      {title ? (
        <h3 className="landing-caption-title">{title}</h3>
      ) : null}
      {note ? <p className="landing-caption-note">{note}</p> : null}
    </div>
  );
}

/** A status chip. Same shape rule as the product: pills are for status only. */
export function Chip({
  tone,
  children,
  dot = false,
}: {
  tone?: "violet" | "cyan" | "mint" | "gold";
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span className="landing-chip" data-tone={tone}>
      {dot ? <span className="landing-dot" /> : null}
      {children}
    </span>
  );
}
