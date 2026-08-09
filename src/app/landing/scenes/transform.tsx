"use client";

/**
 * Scene 3 — fragmented input becomes real work.
 *
 * The first of the two spectacle scenes, and the one that has to be honest.
 * Three genuinely unfinished things are carried into the glass by the three
 * actors. Each one stops being a surface and becomes contained energy at the
 * exact moment it crosses the concealed input face, because the same beat that
 * moves the card writes the wavelength weight the prism's shader reads.
 *
 * What comes out is not a picture of a document: it is the product's real work
 * card, in its real `creating` state, with its real progress shimmer, its title
 * streaming in as Spectra writes it.
 */

import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArtifactCard,
  type ArtifactCardView,
} from "@/features/spectra/components/artifact-card";
import { ThreadCard } from "@/features/spectra/components/thread-card";
import { targetAttrs } from "@/features/spectra/collaboration/target-attributes";
import { SceneRegion } from "../story/scene-region";
import { Body, Headline, useDuring, useSceneT } from "../story/scene-kit";
import { onStoryFrame } from "../story/story-clock";
import { setPrismIngestion, usePrismSlot } from "../prism/prism-slot";
import { clamp01, typedCount, type Beat } from "../story/beats";
import { FIXTURE_TIME, WORK } from "../story/work";

export const TRANSFORM_BEATS: readonly Beat[] = [
  /* Stage A–C: the three fragments are collected. */
  {
    actor: "pablo",
    from: 0.02,
    to: 0.13,
    path: "transform/task",
    primitive: "canvasObject",
    label: "Ecosystems revision",
    act: { kind: "drag", to: "transform/staging" },
    note: "Collecting the assignment",
  },
  {
    actor: "pabloAi",
    from: 0.08,
    to: 0.19,
    path: "transform/notes",
    primitive: "canvasObject",
    label: "Chapter 4 notes",
    act: { kind: "drag", to: "transform/staging" },
  },
  {
    actor: "spectra",
    from: 0.15,
    to: 0.26,
    path: "transform/thread",
    primitive: "canvasObject",
    label: "Revision notes thread",
    act: { kind: "drag", to: "transform/staging" },
  },

  /* Stage D–F: ingestion. One actor, one object, in turn. */
  {
    actor: "pablo",
    from: 0.28,
    to: 0.42,
    path: "transform/task",
    primitive: "canvasObject",
    label: "Ecosystems revision",
    act: { kind: "drag", to: "transform/prism" },
    note: "Feeding the assignment in",
  },
  {
    actor: "pabloAi",
    from: 0.38,
    to: 0.5,
    path: "transform/notes",
    primitive: "canvasObject",
    label: "Chapter 4 notes",
    act: { kind: "drag", to: "transform/prism" },
  },
  {
    actor: "spectra",
    from: 0.46,
    to: 0.58,
    path: "transform/thread",
    primitive: "canvasObject",
    label: "Revision notes thread",
    act: { kind: "drag", to: "transform/prism" },
  },

  /* Stage H–I: the output develops, and all three contribute to it. */
  {
    actor: "pabloAi",
    from: 0.64,
    to: 0.7,
    path: "transform/output",
    primitive: "surface",
    label: "New work",
    act: { kind: "hover" },
    note: "Guiding the edge",
  },
  {
    actor: "spectra",
    from: 0.7,
    to: 0.79,
    path: "transform/output/title",
    primitive: "richtext",
    act: { kind: "type", text: WORK.title },
  },
  {
    actor: "pablo",
    from: 0.79,
    to: 0.85,
    path: "transform/output/deadline",
    primitive: "canvasObject",
    label: "Friday deadline",
    act: { kind: "drag", to: "transform/output" },
    note: "Linking the deadline",
  },
  {
    actor: "pabloAi",
    from: 0.83,
    to: 0.89,
    path: "transform/output/sources",
    primitive: "listItem",
    label: "Sources",
    act: { kind: "create" },
    note: "Attaching sources",
  },

  /* Stage J: resolution. */
  {
    actor: "spectra",
    from: 0.88,
    to: 0.98,
    path: "transform/close",
    primitive: "richtext",
    act: { kind: "type", text: "One request becomes work you can keep." },
  },
];

/**
 * What each fragment becomes inside the glass.
 *
 * Two wavelengths each, index-matched to the prism's contact anchors, so the
 * interior keeps three distinguishable masses before they pool. The colours are
 * the optics', not a palette invented here.
 */
const FEED = [
  {
    path: "transform/task",
    waves: [1, 2],
    from: [-80, 340] as const,
    to: [318, 178] as const,
  },
  {
    path: "transform/notes",
    waves: [4, 3],
    from: [-330, 30] as const,
    to: [286, -14] as const,
  },
  {
    path: "transform/thread",
    waves: [5, 0],
    from: [-250, -280] as const,
    to: [300, -196] as const,
  },
] as const;

/** The ingestion beat window, per fragment: [enter, gone]. */
const CROSS = 0.62;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * A fragment being fed into the glass.
 *
 * Up to the input face it simply travels. Past it, the surface stops being a
 * surface: the box compresses toward the point of contact, its content loses
 * hierarchy before its border does, and what is left is energy the prism is
 * already holding. No particles, no beam, no data stream.
 */
function Fed({
  path,
  to,
  from,
  children,
}: {
  path: string;
  /** Where the concealed input face is, in canvas px, relative to rest. */
  to: readonly [number, number];
  /** Where the fragment came from, in canvas px, relative to rest. */
  from: readonly [number, number];
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      onStoryFrame((frame) => {
        const node = hostRef.current;
        if (!node) return;
        const t = frame.scene === "transform" ? frame.t : frame.index > 0 ? 1 : 0;
        const collect = dragAt(TRANSFORM_BEATS, path, 0, t);
        const feed = dragAt(TRANSFORM_BEATS, path, 1, t);

        const present = collect > 0 ? "true" : "false";
        if (node.dataset.present !== present) node.dataset.present = present;
        if (collect <= 0) return;

        /* Arrival, then departure, on one axis of travel. */
        const arrive = easeOutCubic(collect);
        const cross = clamp01(feed / CROSS);
        const gone = clamp01((feed - CROSS) / (1 - CROSS));
        const x = from[0] * (1 - arrive) + to[0] * easeOutCubic(cross);
        const y = from[1] * (1 - arrive) + to[1] * easeOutCubic(cross);
        const scale = 1 - 0.16 * cross - 0.24 * gone;
        node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(
          1,
        )}px, 0) scale(${scale.toFixed(3)})`;
        node.style.opacity = (1 - gone).toFixed(3);
        /* Content gives way before the frame does, which is what makes it read
           as absorption rather than as a fade. */
        node.style.setProperty("--ingest", cross.toFixed(3));
      }),
    [from, path, to],
  );

  return (
    <div
      ref={hostRef}
      className="landing-ingest"
      data-present="false"
      {...targetAttrs(path, undefined, "canvasObject")}
    >
      {children}
    </div>
  );
}

/** Progress of the `nth` drag beat on `path`, 0..1. */
function dragAt(
  beats: readonly Beat[],
  path: string,
  nth: number,
  t: number,
): number {
  let seen = 0;
  for (const beat of beats) {
    if (beat.act.kind !== "drag" || beat.path !== path) continue;
    if (seen === nth) {
      if (t <= beat.from) return 0;
      if (t >= beat.to) return 1;
      return (t - beat.from) / (beat.to - beat.from);
    }
    seen += 1;
  }
  return 0;
}

const TRANSFORM_POSE = [0.07, -1.02, -0.04] as const;

export function TransformScene() {
  const prismRef = useRef<HTMLDivElement>(null);
  const owned = useDuring("transform", 0, 0.94);

  usePrismSlot(prismRef, {
    fill: 1,
    lambda: 2.4,
    pose: TRANSFORM_POSE,
    poseWeight: 1,
    owned,
    priority: 2,
  });

  /* The glass holds exactly what has been put into it. This is the coupling
     that makes the scene true rather than choreographed: one subscription,
     six weights, written from the same beats that move the cards. */
  useEffect(() => {
    const entries = [0, 0, 0, 0, 0, 0];
    return onStoryFrame((frame) => {
      const here = frame.scene === "transform";
      const t = here ? frame.t : frame.index > 0 ? 1 : 0;
      let held = 0;
      entries.fill(0);
      for (const feed of FEED) {
        const inside = clamp01(
          (dragAt(TRANSFORM_BEATS, feed.path, 1, t) - CROSS * 0.6) /
            (1 - CROSS * 0.6),
        );
        for (const wave of feed.waves) entries[wave] = inside;
        held = Math.max(held, inside);
      }
      setPrismIngestion(here || frame.index > 0 ? held : 0, entries);
    });
  }, []);

  /* The output card is the real Library card in its real creating state. Its
     title is the text Spectra is writing, so the component streams rather than
     being handed a finished string. */
  const growth = useSceneT("transform");

  const outputCard = useMemo<ArtifactCardView>(() => {
    const titleBeat = TRANSFORM_BEATS.find(
      (beat) => beat.path === "transform/output/title",
    );
    const typed = titleBeat ? typedCount(titleBeat, growth) : 0;
    const done = typed >= WORK.title.length;
    const sourcesIn = growth >= 0.89;
    return {
      id: WORK.id,
      title: WORK.title.slice(0, typed),
      blueprintKey: "document",
      summary:
        growth >= 0.74
          ? "Photosynthesis, respiration and the carbon cycle, condensed into five study blocks."
          : "",
      meta: `Document · ${WORK.subject}`,
      placement: "workspace",
      updatedAt: FIXTURE_TIME.updated,
      aiState: done && sourcesIn ? "generated" : "creating",
      aiProgress: clamp01((growth - 0.64) / 0.26),
      metrics: sourcesIn
        ? { Sections: WORK.sections, Sources: WORK.sources }
        : undefined,
    };
  }, [growth]);

  return (
    <SceneRegion scene="transform">
      <div className="relative h-full">
        {/* Left: the staging area. Deliberately collected rather than tiled. */}
        <div
          className="absolute left-0 top-[64px] w-[272px]"
          {...targetAttrs("transform/staging", undefined, "surface")}
        >
          <Fed path="transform/task" from={FEED[0].from} to={FEED[0].to}>
            <ArtifactCard
              artifact={{
                id: "frag-task",
                title: "Ecosystems revision",
                blueprintKey: "planner_task",
                summary:
                  "Three requirements, from the Biology assignment. Due Friday.",
                meta: "Task · from school",
                placement: "inbox",
                updatedAt: FIXTURE_TIME.created,
                metrics: { Requirements: 3 },
              }}
              size="compact"
              quiet
            />
          </Fed>
          <div className="h-[18px]" />
          <div className="translate-x-[26px]">
            <Fed path="transform/notes" from={FEED[1].from} to={FEED[1].to}>
              <ArtifactCard
                artifact={{
                  id: "frag-notes",
                  title: "Chapter 4 notes",
                  blueprintKey: "document",
                  summary:
                    "Unfinished. Four blocks written, one statement with no source.",
                  meta: "Document · 2 sources",
                  placement: "workspace",
                  updatedAt: FIXTURE_TIME.created,
                  aiState: "edited",
                }}
                size="compact"
                quiet
              />
            </Fed>
          </div>
          <div className="h-[18px]" />
          <div className="translate-x-[10px]">
            <Fed path="transform/thread" from={FEED[2].from} to={FEED[2].to}>
              <ThreadCard
                thread={{
                  _id: "frag-thread",
                  title: "What should Friday cover?",
                  origin: "workspace",
                  status: "active",
                  createdAt: FIXTURE_TIME.created,
                  updatedAt: FIXTURE_TIME.created,
                  lastMessageAt: FIXTURE_TIME.created,
                  messageCount: 3,
                  summaryShort: "One decision still open",
                }}
                workspaceLabel={WORK.subject}
                compact
              />
            </Fed>
          </div>
        </div>

        {/* Centre-left: the glass, in its transformation pose. */}
        <div
          ref={prismRef}
          className="absolute left-[236px] top-[168px] h-[430px] w-[430px]"
          {...targetAttrs("transform/prism", undefined, "canvasObject")}
        />

        {/* Right: what comes out. The edge develops first, then the work. */}
        <div
          className="landing-grown absolute right-0 top-[96px] w-[400px]"
          style={
            {
              "--grow": easeOutCubic(clamp01((growth - 0.6) / 0.14)).toFixed(3),
            } as CSSProperties
          }
          data-present={growth >= 0.6 ? "true" : "false"}
          {...targetAttrs("transform/output", undefined, "surface")}
        >
          <div className="landing-output">
            <ArtifactCard artifact={outputCard} size="large" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {growth >= 0.85 ? (
                <span className="landing-chip" data-tone="gold">
                  Due {WORK.due}
                </span>
              ) : null}
              {growth >= 0.89 ? (
                <>
                  <span className="landing-chip" data-tone="cyan">
                    Campbell, ch. 4
                  </span>
                  <span className="landing-chip" data-tone="cyan">
                    Week 6 slides
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="absolute bottom-[36px] left-0 w-[620px]">
          <Headline
            beats={TRANSFORM_BEATS}
            scene="transform"
            size="support"
            paths={["transform/close"]}
          />
          <Body
            beats={TRANSFORM_BEATS}
            scene="transform"
            path="transform/close/body"
            className="mt-4"
          />
        </div>
      </div>
    </SceneRegion>
  );
}
