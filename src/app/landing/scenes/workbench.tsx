"use client";

/**
 * Scene 7 — everything at once, without chaos.
 *
 * Three pieces of the same work, open at the same time, in the product's real
 * workbench. The layout is not a CSS grid dressed up as one: it is a
 * `WorkbenchNode` split tree, and the story edits it with the same functions a
 * person's pointer would call. Pablo splits a pane, then pulls the divider, and
 * `setSplitRatio` is what actually moves.
 *
 * The three panes are deliberately not three of the same thing. A document, a
 * plan and a sheet is the honest claim: unlike surfaces, one workspace, one
 * piece of work.
 */

import { useMemo, useRef } from "react";
import {
  WorkbenchSplitTree,
} from "@/features/spectra/components/workbench-split-tree";
import {
  setSplitRatio,
  type WorkbenchNode,
  type WorkbenchTab,
} from "@/features/spectra/workbench";
import { PlanStudio } from "@/features/spectra/components/plan-studio";
import { SheetsStudio } from "@/features/spectra/components/sheets-studio";
import { SpectraRichContent } from "@/features/spectra/components/spectra-rich-content";
import { SceneRegion } from "../story/scene-region";
import {
  Body,
  Chip,
  Headline,
  Marker,
  Plate,
  useSceneT,
} from "../story/scene-kit";
import { usePrismSlot } from "../prism/prism-slot";
import { clamp01, type Beat } from "../story/beats";
import {
  DOC_BODY,
  FIELD_DATA,
  STUDY_PLAN,
  VERIFIED_SOURCE_IDS,
  WORK,
} from "../story/work";

export const WORKBENCH_BEATS: readonly Beat[] = [
  {
    actor: "spectra",
    from: 0.02,
    to: 0.1,
    path: "workbench/marker",
    primitive: "richtext",
    act: { kind: "type", text: "One workspace" },
  },
  {
    actor: "spectra",
    from: 0.1,
    to: 0.2,
    path: "workbench/line-1",
    primitive: "richtext",
    act: { kind: "type", text: "Everything open" },
  },
  {
    actor: "spectra",
    from: 0.2,
    to: 0.3,
    path: "workbench/line-2",
    primitive: "richtext",
    act: { kind: "type", text: "at once." },
  },

  /* The second pane is a decision, so a person makes it. */
  {
    actor: "pablo",
    from: 0.3,
    to: 0.42,
    path: "workbench/pane/plan",
    primitive: "canvasObject",
    label: "Study plan",
    act: { kind: "drag", to: "workbench/split" },
    note: "Opening the plan beside it",
  },
  {
    actor: "pabloAi",
    from: 0.4,
    to: 0.52,
    path: "workbench/pane/data",
    primitive: "canvasObject",
    label: "Field plots",
    act: { kind: "drag", to: "workbench/split" },
    note: "Bringing the data in",
  },

  /* And then the size of each is a decision too. This is the beat that makes
     the tree real: it moves a ratio, not a width. */
  {
    actor: "pablo",
    from: 0.54,
    to: 0.68,
    path: "workbench/split",
    part: "handle:e",
    primitive: "canvasObject",
    label: "Divider",
    act: { kind: "resize", handle: "handle:e" },
    note: "Giving the document more room",
  },
  {
    actor: "spectra",
    from: 0.66,
    to: 0.78,
    path: "workbench/pane/document",
    primitive: "richtext",
    label: WORK.title,
    act: { kind: "select", from: 0, to: 96, line: 1 },
    note: "Reading what changed",
  },
  {
    actor: "spectra",
    from: 0.8,
    to: 0.98,
    path: "workbench/body",
    primitive: "richtext",
    act: {
      kind: "type",
      text: "Nothing here is a copy of anything else. Edit the sheet and the document that cites it knows, because they are the same work seen from three sides.",
    },
  },
];

const TABS: WorkbenchTab[] = [
  {
    id: "tab-document",
    title: WORK.title,
    minInlineSize: 260,
    preferredInlineSize: 400,
  },
  {
    id: "tab-plan",
    title: "Study plan",
    minInlineSize: 220,
    preferredInlineSize: 300,
  },
  {
    id: "tab-data",
    title: "Field plots",
    minInlineSize: 220,
    preferredInlineSize: 300,
  },
];

/** The document pane, one pane, and the divider Pablo pulls. */
const ONE: WorkbenchNode = {
  type: "pane",
  paneId: "pane:document",
  tabs: [TABS[0]!],
  activeTabId: "tab-document",
};

const PLAN_PANE: WorkbenchNode = {
  type: "pane",
  paneId: "pane:plan",
  tabs: [TABS[1]!],
  activeTabId: "tab-plan",
};

const DATA_PANE: WorkbenchNode = {
  type: "pane",
  paneId: "pane:data",
  tabs: [TABS[2]!],
  activeTabId: "tab-data",
};

const TWO: WorkbenchNode = {
  type: "split",
  splitId: "split:root",
  direction: "horizontal",
  ratio: 0.56,
  first: ONE,
  second: PLAN_PANE,
};

const THREE: WorkbenchNode = {
  type: "split",
  splitId: "split:root",
  direction: "horizontal",
  ratio: 0.56,
  first: ONE,
  second: {
    type: "split",
    splitId: "split:side",
    direction: "vertical",
    ratio: 0.5,
    first: PLAN_PANE,
    second: DATA_PANE,
  },
};

export function WorkbenchScene() {
  const prismRef = useRef<HTMLDivElement>(null);
  const t = useSceneT("workbench");

  usePrismSlot(prismRef, {
    fill: 0.8,
    lambda: 1.6,
    pose: [0.3, -0.2, 0.1],
    poseWeight: 0.28,
    priority: 1,
  });

  /* The tree the story is currently looking at. Panes arrive because somebody
     opened them, and the divider moves because somebody pulled it — the same
     `setSplitRatio` the pointer handler calls. */
  const node = useMemo<WorkbenchNode>(() => {
    const base = t >= 0.5 ? THREE : t >= 0.4 ? TWO : ONE;
    if (t < 0.54) return base;
    const pull = clamp01((t - 0.54) / 0.14);
    return setSplitRatio(base, "split:root", 0.56 + 0.1 * (1 - (1 - pull) ** 3));
  }, [t]);

  const renderTab = useMemo(() => {
    function RenderWorkbenchTab(tab: WorkbenchTab) {
      if (tab.id === "tab-plan")
        return (
          <div className="landing-pane">
            <PlanStudio
              mode="split"
              title="Study plan"
              content={STUDY_PLAN}
              onChange={() => undefined}
              readOnly
            />
          </div>
        );
      if (tab.id === "tab-data")
        return (
          <div className="landing-pane">
            <SheetsStudio
              artifactId="src-dataset"
              content={FIELD_DATA}
              onChange={() => undefined}
              readOnly
              mode="split"
              syncMessage="Auto-saved"
            />
          </div>
        );
      return (
        <div className="landing-pane px-5 py-4">
          <SpectraRichContent
            content={DOC_BODY}
            verifiedSourceIds={VERIFIED_SOURCE_IDS}
            className="text-[14px] leading-[1.72]"
          />
        </div>
      );
    }
    return RenderWorkbenchTab;
  }, []);

  return (
    <SceneRegion scene="workbench">
      <div className="relative h-full">
        <div className="flex items-end gap-12 pb-4">
          <div className="w-[372px] shrink-0">
            <Marker
              beats={WORKBENCH_BEATS}
              scene="workbench"
              path="workbench/marker"
            />
            <Headline
              beats={WORKBENCH_BEATS}
              scene="workbench"
              size="support"
              paths={["workbench/line-1", "workbench/line-2"]}
              className="mt-3"
            />
          </div>
          <Body
            beats={WORKBENCH_BEATS}
            scene="workbench"
            path="workbench/body"
            className="flex-1"
          />
        </div>

        {/* The real split tree. It is given a fixed box because a workbench
            always has one: the window it is in. */}
        <div
          className="relative"
          style={{ height: 492 }}
          data-present={t >= 0.28 ? "true" : "false"}
        >
          <Plate
            scene="workbench"
            path="workbench/split"
            title="Workbench"
            meta={WORK.subject}
            trailing={
              <>
                <Chip tone="violet">
                  {t >= 0.5 ? "3 panes" : t >= 0.4 ? "2 panes" : "1 pane"}
                </Chip>
                <Chip tone="mint" dot>
                  Live
                </Chip>
              </>
            }
            className="h-full"
            radius={1}
          >
            <div className="landing-workbench">
              <WorkbenchSplitTree
                node={node}
                onChange={() => undefined}
                renderTab={renderTab}
              />
            </div>
          </Plate>

          {/* The glass sits behind the workbench here, so the panes read as
              being lit by it rather than pasted over it. */}
          <div
            ref={prismRef}
            className="pointer-events-none absolute left-[-132px] top-[210px] h-[228px] w-[228px]"
            aria-hidden="true"
          />
        </div>
      </div>
    </SceneRegion>
  );
}
