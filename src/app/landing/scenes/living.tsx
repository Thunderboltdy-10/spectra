"use client";

/**
 * Scene 4 — work that stays alive.
 *
 * The claim: this is not a chat answer that was pasted somewhere. It is a
 * document, it is still being worked on, and two people can be inside it at the
 * same time without anybody merging anything.
 *
 * Everything here is one field. Pablo pulls the document open by its handle,
 * Spectra streams a revision into the Calvin cycle section, and several blocks
 * away Pablo is editing a different paragraph — so the same surface carries two
 * lit influence regions at once. Pablo's AI then selects a factual sentence and
 * attaches the source it checked it against.
 */

import { useMemo, useRef } from "react";
import { SpectraRichContent } from "@/features/spectra/components/spectra-rich-content";
import { targetAttrs } from "@/features/spectra/collaboration/target-attributes";
import { SceneRegion } from "../story/scene-region";
import {
  Body,
  Chip,
  Headline,
  Marker,
  Sized,
  useDuring,
  useSceneT,
} from "../story/scene-kit";
import { usePrismSlot } from "../prism/prism-slot";
import { actorColor, type ActorId } from "../story/actors";
import { typedCount, type Beat } from "../story/beats";
import { DOC_BODY, VERIFIED_SOURCE_IDS, WORK } from "../story/work";

/* The document is authored in three blocks so the story can light one without
   lighting the others. Splitting on the heading marker keeps the product's own
   parser in charge of everything inside each block. */
const BLOCKS = DOC_BODY.split(/\n\n(?=## )/);

/** The sentence Spectra rewrites, and what it becomes. */
const REVISION =
  "Three turns of the cycle produce one molecule of glyceraldehyde-3-phosphate, which is the point where light energy has finally become sugar";

export const LIVING_BEATS: readonly Beat[] = [
  {
    actor: "spectra",
    from: 0.02,
    to: 0.1,
    path: "living/marker",
    primitive: "richtext",
    act: { kind: "type", text: "One document, two people" },
  },
  {
    actor: "pablo",
    from: 0.04,
    to: 0.22,
    path: "living/doc",
    primitive: "canvasObject",
    label: WORK.title,
    act: { kind: "resize", handle: "handle:se" },
    note: "Making room to work",
  },
  {
    actor: "spectra",
    from: 0.2,
    to: 0.3,
    path: "living/line-1",
    primitive: "richtext",
    act: { kind: "type", text: "Not another answer." },
  },
  {
    actor: "spectra",
    from: 0.3,
    to: 0.42,
    path: "living/line-2",
    primitive: "richtext",
    act: { kind: "type", text: "Work that stays alive." },
  },

  /* The two edits that overlap. Both are real acts on the same document, in
     different blocks, at the same moment. */
  {
    actor: "spectra",
    from: 0.4,
    to: 0.68,
    path: "living/doc/calvin",
    primitive: "richtext",
    label: "Calvin cycle",
    act: { kind: "type", text: REVISION },
    note: "Tightening the explanation",
  },
  {
    actor: "pablo",
    from: 0.46,
    to: 0.62,
    path: "living/doc/respiration",
    primitive: "richtext",
    label: "Respiration",
    act: { kind: "select", from: 0, to: 74, line: 1 },
    note: "Rewording the last paragraph",
  },

  /* The source arrives after the sentence exists, which is the only order that
     makes sense: you cannot verify a claim that has not been made. */
  {
    actor: "pabloAi",
    from: 0.66,
    to: 0.78,
    path: "living/doc/light",
    primitive: "richtext",
    label: "Light-dependent reactions",
    act: { kind: "select", from: 0, to: 120, line: 1 },
    note: "Checking against the slides",
  },
  {
    actor: "pabloAi",
    from: 0.78,
    to: 0.86,
    path: "living/doc/light/source",
    primitive: "listItem",
    label: "Week 6 slides",
    act: { kind: "create" },
    note: "Attaching the source",
  },
  {
    actor: "spectra",
    from: 0.84,
    to: 0.98,
    path: "living/body",
    primitive: "richtext",
    act: {
      kind: "type",
      text: "The document keeps its history, its sources and its collaborators. Ask again tomorrow and it changes rather than starting over.",
    },
  },
];

/** Where the glass goes while a document is the subject. */
const LIVING_POSE = [0.24, -0.34, 0.08] as const;

/** A block of the live document, with its own influence region and ledger. */
function Block({
  path,
  markdown,
  live,
  actor,
  note,
  verified,
}: {
  path: string;
  markdown: string;
  live: boolean;
  actor: ActorId;
  note: string;
  verified: readonly string[];
}) {
  return (
    <div className="grid grid-cols-[128px_1fr] items-start gap-4">
      <div
        className="landing-ledger justify-end"
        data-live={live ? "true" : "false"}
      >
        <span
          className="landing-dot"
          style={{ color: actorColor(actor) }}
          aria-hidden="true"
        />
        {note}
      </div>
      <div
        className="landing-region px-3 py-1"
        data-live={live ? "true" : "false"}
        style={{ "--region-ink": actorColor(actor) } as React.CSSProperties}
        {...targetAttrs(path, undefined, "richtext")}
      >
        <SpectraRichContent
          content={markdown}
          verifiedSourceIds={verified}
          className="text-[15px] leading-[1.7]"
        />
      </div>
    </div>
  );
}

export function LivingScene() {
  const prismRef = useRef<HTMLDivElement>(null);

  /* Spectra moves the glass out of the way and shrinks it: for the rest of the
     page the object is a presence in the room, not the subject of the shot. */
  const holding = useDuring("living", 0.16, 0.44);
  usePrismSlot(prismRef, {
    fill: 0.86,
    lambda: 1.8,
    pose: LIVING_POSE,
    poseWeight: 0.42,
    owned: holding,
    priority: 1,
  });

  const t = useSceneT("living");

  /* The revised sentence streams through the product's own incremental parser,
     so the block reflows as a document does rather than as a text animation. */
  const blocks = useMemo(() => {
    const beat = LIVING_BEATS.find(
      (candidate) => candidate.path === "living/doc/calvin",
    );
    const typed = beat ? typedCount(beat, t) : 0;
    const calvin = BLOCKS[1] ?? "";
    const rewritten =
      typed > 0
        ? calvin.replace(
            /Three turns of the cycle produce one molecule of glyceraldehyde-3-phosphate/,
            REVISION.slice(0, Math.max(1, typed)),
          )
        : calvin;
    return [BLOCKS[0] ?? "", rewritten, BLOCKS[2] ?? ""];
  }, [t]);

  /* The source is attached only once Pablo's AI has actually attached it. Until
     then the citation renders in its unverified state, which is the honest
     thing for a claim nobody has checked. */
  const verified = useMemo(
    () => (t >= 0.84 ? VERIFIED_SOURCE_IDS : ["src-textbook"]),
    [t],
  );

  return (
    <SceneRegion scene="living">
      <div className="relative h-full">
        <div className="absolute right-0 top-[8px] w-[336px]">
          <Marker beats={LIVING_BEATS} scene="living" path="living/marker" />
          <Headline
            beats={LIVING_BEATS}
            scene="living"
            size="support"
            paths={["living/line-1", "living/line-2"]}
            className="mt-4"
          />
          <Body
            beats={LIVING_BEATS}
            scene="living"
            path="living/body"
            className="mt-6"
          />
        </div>

        {/* The glass, small and to one side, behind the work. */}
        <div
          ref={prismRef}
          className="absolute right-[-44px] bottom-[-30px] h-[250px] w-[250px]"
          aria-hidden="true"
        />

        {/* The document. Pablo pulls it from letter-ish to working width. */}
        <Sized
          beats={LIVING_BEATS}
          scene="living"
          path="living/doc"
          from={[430, 372]}
          to={[520, 700]}
          className="absolute left-0 top-[26px]"
        >
          <div className="landing-plate h-full w-full">
            <div className="landing-plate-head">
              <span className="landing-plate-title">{WORK.title}</span>
              <span className="truncate">{WORK.subject}</span>
              <span className="ml-auto flex items-center gap-2">
                <Chip tone="mint" dot>
                  Live
                </Chip>
              </span>
            </div>
            <div className="landing-plate-body overflow-hidden">
              <div className="flex flex-col gap-1 py-4 pr-4">
                <Block
                  path="living/doc/light"
                  markdown={blocks[0]!}
                  live={t >= 0.66 && t < 0.88}
                  actor="pabloAi"
                  note="Checked the claim"
                  verified={verified}
                />
                <Block
                  path="living/doc/calvin"
                  markdown={blocks[1]!}
                  live={t >= 0.4 && t < 0.7}
                  actor="spectra"
                  note="Rewriting"
                  verified={verified}
                />
                <Block
                  path="living/doc/respiration"
                  markdown={blocks[2]!}
                  live={t >= 0.46 && t < 0.64}
                  actor="pablo"
                  note="Pablo, editing"
                  verified={verified}
                />
              </div>
            </div>
          </div>
        </Sized>

        {/* The attached source. It appears in the document's own footer band,
            below the body, because that is where a source lives. */}
        <div
          className="absolute left-0 top-[746px] flex items-center gap-2"
          data-present={t >= 0.84 ? "true" : "false"}
          style={{
            opacity: t >= 0.84 ? 1 : 0,
            transform: `translate3d(0, ${t >= 0.84 ? 0 : 6}px, 0)`,
            transition:
              "opacity var(--motion-slow) var(--ease-standard), transform var(--motion-slow) var(--ease-out-expo)",
          }}
          {...targetAttrs("living/doc/light/source", undefined, "listItem")}
        >
          <Chip tone="cyan" dot>
            Week 6 slides, verified
          </Chip>
          <span className="text-[12px] text-[var(--text-tertiary)]">
            Attached by Pablo&rsquo;s AI
          </span>
        </div>
      </div>
    </SceneRegion>
  );
}
