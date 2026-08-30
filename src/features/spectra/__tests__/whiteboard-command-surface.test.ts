import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { capabilityForLocalId, projectBindingsFromIr } from "../capabilities";
import { dispatchStudioCommand } from "../commands/dispatch";
import { commandContext, tabsFor } from "../commands/registry";
import { planWorkbarOverflow } from "../components/workbar-overflow";

describe("P12.I3 whiteboard command routing", () => {
  it("routes shipped and refused paths through one IR availability gate", () => {
    const vote = vi.fn();
    const freehand = vi.fn();
    const bindings = projectBindingsFromIr("whiteboard", [
      { id: "vote-adjust", label: "Add vote", onSelect: vote },
      { id: "tool-freehand", label: "Freehand ink", onSelect: freehand },
    ]);
    const context = commandContext("whiteboard", () => true, "edit");

    expect(
      dispatchStudioCommand({
        type: "whiteboard",
        id: "vote-adjust",
        bindings,
        ctx: context,
        params: 1,
      }),
    ).toBe(true);
    expect(vote).toHaveBeenCalledWith(1);

    expect(
      dispatchStudioCommand({
        type: "whiteboard",
        id: "tool-freehand",
        bindings,
        ctx: context,
      }),
    ).toBe(false);
    expect(freehand).not.toHaveBeenCalled();
    expect(
      capabilityForLocalId("whiteboard", "tool-freehand")?.availability(
        context,
      ),
    ).toEqual({
      state: "disabled",
      reason:
        "Freehand ink is not available yet. Use shapes, connectors, text, or the laser pointer.",
    });
  });

  it("exposes Facilitate and Export without duplicating the Shape context tab", () => {
    expect(tabsFor("whiteboard", "Shape")).toEqual([
      "General",
      "Insert",
      "Arrange",
      "Facilitate",
      "Export",
      "Shape",
    ]);
  });

  it("keeps keyboard, page, layer, template, selection, and inspector UI on dispatch", () => {
    const source = readFileSync(
      "src/features/spectra/components/whiteboard-studio.tsx",
      "utf8",
    );
    expect(source).toContain("actions={workbarActions}");
    expect(source).not.toContain('actions={projectBindingsFromIr("whiteboard"');
    expect(source).toContain(
      'const nudgeId = arrow[0] ? "selection-nudge-x" : "selection-nudge-y";',
    );
    expect(source).toContain("dispatchBoardCommand(nudgeId, amount)");
    for (const command of [
      "selection-delete",
      "selection-group",
      "selection-ungroup",
      "selection-duplicate",
      "selection-all",
      "page-navigate",
      "page-add",
      "layer-add",
      "layer-visibility",
      "layer-lock",
      "template-brainwriting",
      "connector-reverse",
      "connector-delete",
      "connector-label",
      "connector-layer",
      "node-text",
      "node-content",
      "node-label",
      "node-embed-source",
    ]) {
      expect(source, command).toMatch(
        new RegExp(`dispatchBoardCommand\\(\\s*"${command}"`),
      );
    }
    expect(source).not.toContain("onClick={addPage}");
    expect(source).not.toContain("onClick={addLayer}");
    expect(source).not.toContain("onClick={deleteSelected}");
  });
});

describe("P12.I3 whiteboard narrow overflow and visual states", () => {
  it("moves advanced depth commands to one overflow before essential tools", () => {
    const items = [
      ...["select", "hand", "note", "connector", "undo"].map((id) => ({
        id,
        fullWidth: 74,
        iconWidth: 32,
        priority: "essential" as const,
      })),
      ...["shape", "section", "laser", "vote", "template", "export-frame"].map(
        (id) => ({
          id,
          fullWidth: 108,
          iconWidth: 32,
          priority: "advanced" as const,
        }),
      ),
    ];
    const plan = planWorkbarOverflow(items, 250);
    expect(plan.overflowIds).toEqual(
      expect.arrayContaining([
        "shape",
        "section",
        "laser",
        "vote",
        "template",
        "export-frame",
      ]),
    );
    expect(plan.visibleIds).toEqual(
      expect.arrayContaining(["select", "hand", "note", "connector", "undo"]),
    );
    expect(
      plan.visibleIds.filter((id) => plan.overflowIds.includes(id)),
    ).toEqual([]);
  });

  it("defines grid, shape, section, vote, laser, connector, and narrow states", () => {
    const css = readFileSync("src/styles/spectra-app.css", "utf8");
    for (const selector of [
      '.whiteboard-canvas[data-grid="true"]',
      '.whiteboard-canvas[data-tool="laser"]',
      ".whiteboard-shape-surface",
      '.whiteboard-node[data-shape="diamond"]',
      '.whiteboard-node[data-shape="triangle"]',
      '.whiteboard-node[data-shape="hexagon"]',
      '.whiteboard-node[data-type="section"]',
      ".whiteboard-section-title",
      ".whiteboard-vote-count",
      ".whiteboard-laser",
      ".whiteboard-edges > g > path",
      '.whiteboard-template-list i[data-template="brainwriting"]',
      "@container spectra-studio (max-width: 760px)",
      ".whiteboard-multi-toolbar::-webkit-scrollbar",
    ]) {
      expect(css, selector).toContain(selector);
    }
    expect(css).toContain("overflow-x: auto");
  });
});
