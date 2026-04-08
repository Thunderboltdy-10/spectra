// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { NodeProps } from "@xyflow/react";
import {
  buildWorkspaceNodes,
  CategoryFieldNode,
  type ArtifactSummary,
  type InternalContentData,
  type PlannerItemSummary,
  type ThreadSummary,
} from "@/components/workspace/views/internal-content-nodes";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

function renderCategory(type: "threads" | "planner" | "artifacts", items: InternalContentData["threads" | "plannerItems" | "artifacts"]) {
  const noop = () => {};
  const data = {
    label: type.toUpperCase(),
    type,
    items,
    onOpenPanel: noop,
    accentColor: "var(--accent-cyan)",
    band: "summary" as const,
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  act(() => {
    const props = {
      data,
      id: `${type}-node`,
      type: "categoryField",
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
      selected: false,
      dragging: false,
      zIndex: 0,
      isConnectable: false,
      targetPosition: undefined,
      sourcePosition: undefined,
    } as unknown as NodeProps<never>;

    root.render(
      <CategoryFieldNode {...props} />,
    );
  });

  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function renderArtifactGlance(artifact: ArtifactSummary) {
  return renderCategory("artifacts", [artifact]);
}

describe("workspace glance renderers", () => {
  it("builds dedicated lanes for each canonical artifact family", () => {
    const artifacts: ArtifactSummary[] = [
      { id: "a1", title: "Note", type: "document", renderMode: "note", createdAt: 1, contentSummary: "Long note" },
      { id: "a2", title: "Visual", type: "visualization", renderMode: "visualization", createdAt: 1, contentSummary: "Chart summary" },
      { id: "a3", title: "Code", type: "document", renderMode: "code_project", createdAt: 1, contentSummary: "const x = 1", language: "ts" },
      { id: "a4", title: "Export", type: "reference", renderMode: "bookmark", createdAt: 1, contentSummary: "Reference export" },
      { id: "a5", title: "Board", type: "custom", renderMode: "whiteboard", createdAt: 1, contentSummary: "Board state" },
      { id: "a6", title: "Deck", type: "document", renderMode: "flashcard_deck", createdAt: 1, cardCount: 12, contentSummary: "Cards" },
      { id: "a7", title: "Quiz", type: "visualization", renderMode: "quiz", createdAt: 1, questionCount: 7, lastScore: 83, contentSummary: "Quiz state" },
    ];

    const result = buildWorkspaceNodes({
      threads: [],
      notes: [],
      plannerItems: [],
      artifacts,
      widgets: [],
      loading: false,
      onOpenPanel: () => {},
      band: "detail",
      workstreamTitle: "Physics",
      workstreamEmoji: "🧪",
    }, { x: 0, y: 0 });

    const laneLabels = result.nodes
      .filter((node) => node.type === "categoryField")
      .map((node) => (node.data as { label: string }).label);

    expect(laneLabels).toEqual(expect.arrayContaining(["VISUALS", "CODE", "STUDY", "BOARDS", "ARTIFACTS"]));
  });

  it("renders glance thread cards with type label and summary copy", () => {
    const threads: ThreadSummary[] = [
      { id: "t1", title: "Essay feedback", messageCount: 3, lastActivityAt: Date.now() - 1000 * 60 * 30 },
    ];

    const { container, cleanup } = renderCategory("threads", threads);

    expect(container.textContent).toContain("Essay feedback");
    expect(container.innerHTML.toLowerCase()).toContain("message-square");
    expect(container.textContent).toMatch(/Essay feedback/i);
    cleanup();
  });

  it("renders glance planner cards with status dot and due summary", () => {
    const plannerItems: PlannerItemSummary[] = [
      { id: "p1", title: "Revise kinematics", status: "in_progress", dueAt: new Date("2026-05-10").getTime() },
    ];

    const { container, cleanup } = renderCategory("planner", plannerItems);

    expect(container.textContent).toContain("Revise kinematics");
    expect(container.innerHTML.toLowerCase()).toContain("calendar-clock");
    expect(container.innerHTML).toContain("hover:bg-white");
    cleanup();
  });

  it("renders artifact glance cards with canonical labels and truncated summaries", () => {
    const artifacts: ArtifactSummary[] = [
      {
        id: "q1",
        title: "Quadratics quiz",
        type: "visualization",
        renderMode: "quiz",
        createdAt: 1,
        questionCount: 10,
        lastScore: 92,
        contentSummary: "A".repeat(220),
      },
    ];

    const { container, cleanup } = renderArtifactGlance(artifacts[0]);

    expect(container.textContent).toContain("Quadratics quiz");
    expect(container.innerHTML.toLowerCase()).toContain("sparkles");
    cleanup();
  });

  it("renders code glance cards with language metadata instead of a generic artifact label", () => {
    const artifacts: ArtifactSummary[] = [
      {
        id: "c1",
        title: "Projectile sim",
        type: "document",
        renderMode: "code_project",
        createdAt: 1,
        language: "python",
        contentSummary: "Simulates the launch angle and drag over time.",
      },
    ];

    const { container, cleanup } = renderArtifactGlance(artifacts[0]);

    expect(container.textContent).toContain("Projectile sim");
    expect(container.innerHTML.toLowerCase()).toContain("sparkles");
    cleanup();
  });
});
