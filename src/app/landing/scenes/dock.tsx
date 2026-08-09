"use client";

/**
 * Scene 6 — work that keeps going without you watching it.
 *
 * The Live Dock is the product's answer to "where did my request go", so this
 * scene mounts the real dock and hands it the story's runs. It is not a picture
 * of three tabs: `deriveLiveDockTab` reads these runs and decides the state, the
 * semantic step, the disclosure copy and the field colour, exactly as it does
 * for a live workspace. Change a phase below and the tab changes with it.
 *
 * Three runs, because three is where the point lands: one working, one that
 * genuinely needs an answer, one already finished and keepable.
 */

import { useMemo } from "react";
import { LiveDock } from "@/features/spectra/components/live-dock";
import type {
  SpectraRun,
  SpectraRunTab,
} from "@/features/spectra/data/api";
import { SceneRegion } from "../story/scene-region";
import { Body, Headline, Marker, Plate, useSceneT } from "../story/scene-kit";
import { clamp01, type Beat } from "../story/beats";
import { FIXTURE_TIME, RUN_STEPS, WORK } from "../story/work";

export const DOCK_BEATS: readonly Beat[] = [
  {
    actor: "spectra",
    from: 0.02,
    to: 0.1,
    path: "dock/marker",
    primitive: "richtext",
    act: { kind: "type", text: "While you are elsewhere" },
  },
  {
    actor: "spectra",
    from: 0.1,
    to: 0.22,
    path: "dock/line-1",
    primitive: "richtext",
    act: { kind: "type", text: "Requests keep" },
  },
  {
    actor: "spectra",
    from: 0.22,
    to: 0.33,
    path: "dock/line-2",
    primitive: "richtext",
    act: { kind: "type", text: "running." },
  },

  /* The dock arrives as one object: it is one place, not three widgets. */
  {
    actor: "pabloAi",
    from: 0.3,
    to: 0.44,
    path: "dock/rail",
    primitive: "surface",
    label: "Live Dock",
    act: { kind: "drag", to: "dock/stage" },
    note: "Docking the runs",
  },

  /* The middle run needs a decision, and asking is a first-class outcome. */
  {
    actor: "pabloAi",
    from: 0.48,
    to: 0.58,
    path: "dock/run-sources",
    primitive: "button",
    label: "Needs input",
    act: { kind: "hover" },
    note: "This one needs Pablo",
  },
  {
    actor: "pablo",
    from: 0.58,
    to: 0.72,
    path: "dock/run-sources/answer",
    primitive: "richtext",
    label: "Needs input",
    act: { kind: "type", text: "Use the Week 6 slides." },
    note: "Answering without leaving",
  },
  {
    actor: "spectra",
    from: 0.76,
    to: 0.96,
    path: "dock/body",
    primitive: "richtext",
    act: {
      kind: "type",
      text: "Every run says what it is doing in a sentence you could repeat to someone else. When one needs you, it asks in the dock instead of failing quietly.",
    },
  },
];

const RUN_BASE = {
  sourceSurface: "chat",
  decision: "operate",
  createdAt: FIXTURE_TIME.created,
  updatedAt: FIXTURE_TIME.updated,
} satisfies Partial<SpectraRun>;

function run(input: {
  id: string;
  status: SpectraRun["status"];
  phase?: SpectraRun["phase"];
  prompt: string;
  summary?: string;
  decision?: SpectraRun["decision"];
}): SpectraRun {
  return {
    ...RUN_BASE,
    _id: input.id,
    status: input.status,
    phase: input.phase,
    userPrompt: input.prompt,
    finalSummary: input.summary,
    decision: input.decision ?? "operate",
    threadId: `${input.id}-thread`,
  };
}

function tab(input: {
  id: string;
  title: string;
  run: SpectraRun;
  steps: readonly string[];
  selected?: boolean;
  needsInput?: SpectraRunTab["inputRequest"];
}): SpectraRunTab {
  return {
    _id: input.id,
    runId: input.run._id,
    threadId: `${input.id}-thread`,
    surface: "chat",
    selected: input.selected,
    createdAt: FIXTURE_TIME.created,
    updatedAt: FIXTURE_TIME.updated,
    run: input.run,
    thread: {
      _id: `${input.id}-thread`,
      title: input.title,
      origin: "chat",
      status: "active",
      createdAt: FIXTURE_TIME.created,
      updatedAt: FIXTURE_TIME.updated,
      lastMessageAt: FIXTURE_TIME.lastMessage,
      messageCount: 4,
    },
    inputRequest: input.needsInput ?? null,
    recentSteps: [...input.steps],
  };
}

export function DockScene() {
  const t = useSceneT("dock");

  /* The runs advance because the story advances. `deriveLiveDockTab` turns each
     one into a tab state, so the dock's own model is what decides how these
     read — this scene only decides what is true. */
  const tabs = useMemo<SpectraRunTab[]>(() => {
    const answered = t >= 0.72;
    const closing = t >= 0.86;
    return [
      tab({
        id: "run-revision",
        title: WORK.title,
        steps: closing
          ? [RUN_STEPS.reading, RUN_STEPS.drafting, RUN_STEPS.checking]
          : [RUN_STEPS.reading, RUN_STEPS.drafting],
        run: run({
          id: "run-revision",
          status: "running",
          phase: closing ? "checking" : "streaming",
          prompt: "Turn these notes into a revision document for Friday.",
        }),
      }),
      tab({
        id: "run-sources",
        title: "Which source for the Calvin cycle?",
        selected: !answered,
        steps: [RUN_STEPS.reading],
        needsInput: answered
          ? null
          : {
              kind: "choice",
              prompt:
                "Two sources disagree on the Calvin cycle. Which should the document follow?",
              options: [
                {
                  title: "Week 6 slides",
                  description: "Your teacher's own wording",
                },
                {
                  title: "Campbell, chapter 4",
                  description: "The textbook you already cite",
                },
              ],
            },
        run: run({
          id: "run-sources",
          status: answered ? "running" : "awaiting_confirmation",
          phase: answered ? "updating" : "approval",
          prompt: "Reconcile the Calvin cycle explanation.",
          summary: answered ? RUN_STEPS.updating : undefined,
          decision: answered ? "operate" : "clarify",
        }),
      }),
      tab({
        id: "run-blocks",
        title: "Three study blocks before Friday",
        steps: [RUN_STEPS.scheduling],
        run: run({
          id: "run-blocks",
          status: "completed",
          phase: "completed",
          prompt: "Put revision time in my week.",
          summary:
            "Three blocks placed around football and the Thursday lesson.",
        }),
      }),
    ];
  }, [t]);

  /* The dock is carried in as one object, from below, the way a dock would
     come up from the bottom of a real window. */
  const arrive = clamp01((t - 0.3) / 0.14);
  const settle = 1 - (1 - arrive) ** 3;

  return (
    <SceneRegion scene="dock">
      <div className="relative h-full">
        <div className="flex items-start gap-16 pt-[10px]">
          <div className="w-[352px] shrink-0">
            <Marker beats={DOCK_BEATS} scene="dock" path="dock/marker" />
            <Headline
              beats={DOCK_BEATS}
              scene="dock"
              size="support"
              paths={["dock/line-1", "dock/line-2"]}
              className="mt-4"
            />
            <Body
              beats={DOCK_BEATS}
              scene="dock"
              path="dock/body"
              className="mt-6"
            />
          </div>

          {/* The three runs, as the product's own summary of them. This is the
              claim in miniature: a run is a sentence, not a spinner. */}
          <ul className="mt-3 flex-1 space-y-0 border-t border-[var(--border-subtle)]">
            {SUMMARY.map((row, index) => (
              <li
                key={row.title}
                className="flex items-baseline gap-4 border-b border-[var(--border-subtle)] py-3"
                style={{
                  opacity: t >= 0.36 + index * 0.05 ? 1 : 0,
                  transform: `translate3d(0, ${t >= 0.36 + index * 0.05 ? 0 : 5}px, 0)`,
                  transition:
                    "opacity var(--motion-slow) var(--ease-standard), transform var(--motion-slow) var(--ease-out-expo)",
                }}
              >
                <span className="w-[104px] shrink-0 text-[11px] font-semibold uppercase leading-[1.3] tracking-[0.16em] text-[var(--text-tertiary)]">
                  {row.label}
                </span>
                <span className="text-[15px] leading-[1.5] text-[var(--text-secondary)]">
                  {row.title}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* The dock itself, carried up from the bottom of the frame the way a
            dock arrives in a real window. Full canvas width, because the dock
            spans the workspace rather than sitting in a column. */}
        <div
          className="absolute bottom-[24px] left-0 right-0"
          data-present={arrive > 0.001 ? "true" : "false"}
          style={{
            transform: `translate3d(0, ${((1 - settle) * 108).toFixed(1)}px, 0)`,
            opacity: settle.toFixed(3),
            visibility: arrive > 0.001 ? "visible" : "hidden",
          }}
        >
          <Plate
            scene="dock"
            path="dock/rail"
            title="Live Dock"
            meta="3 runs"
            style={{ minHeight: 208 }}
            radius={1}
          >
            <div className="landing-dock-host">
              <LiveDock storyTabs={tabs} />
            </div>
          </Plate>
        </div>
      </div>
    </SceneRegion>
  );
}

/** How the three runs read as a list, in the words the dock itself uses. */
const SUMMARY = [
  { label: "Working", title: RUN_STEPS.drafting },
  { label: "Needs you", title: "Which source the Calvin cycle should follow" },
  { label: "Done", title: RUN_STEPS.scheduling },
] as const;
