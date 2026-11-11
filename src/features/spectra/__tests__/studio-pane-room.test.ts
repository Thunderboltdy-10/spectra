import { describe, expect, it } from "vitest";
import { studioPaneLayout } from "../components/studio-pane";
import { allocateWorkbenchPanes, resolveWorkbenchPanes } from "../components/split-presentation";

/* F01: Comments, History and References squeezed a work beside its
   conversation into an unreadable strip. The work now asks the row for the
   pane's room; where the row has it the pane sits beside a readable page,
   and where it has not the work covers the page until the pane shuts. */
describe("the artifact's own pane beside a conversation (F01)", () => {
  const documentFloor = 360;

  function row(hostWidth: number, room: number) {
    const panes = [{ id: "studio", floor: documentFloor + room, priority: 0, overlay: false }];
    const overlay = resolveWorkbenchPanes({ hostWidth, contentReserve: 420, panes });
    const widths = allocateWorkbenchPanes({
      hostWidth,
      contentReserve: 420,
      panes: panes.map((pane) => ({ ...pane, overlay: overlay[pane.id], intent: 720 + room, recency: 0, cap: 960 + room })),
    });
    return { overlay: overlay.studio, width: widths.studio ?? hostWidth };
  }

  it("never lays the pane over a side panel that is too narrow to keep the page", () => {
    const shut = studioPaneLayout({ surface: "panel", surfaceWidth: 380, stored: 380, stageMin: documentFloor });
    expect(shut.docked).toBe(false);
    expect(shut.requested).toBe(380);
  });

  for (const [label, hostWidth] of [["1024", 784], ["1280", 1204], ["full HD", 1680]] as const) {
    it(`keeps the page at least its floor at ${label}`, () => {
      const room = studioPaneLayout({ surface: "panel", surfaceWidth: 0, stored: 380, stageMin: documentFloor }).requested;
      const { width } = row(hostWidth, room);
      const pane = studioPaneLayout({ surface: "panel", surfaceWidth: width, stored: 380, stageMin: documentFloor });
      expect(pane.docked).toBe(true);
      expect(width - pane.width).toBeGreaterThanOrEqual(documentFloor);
    });
  }

  it("covers the conversation at 1024 rather than squeezing both", () => {
    expect(row(784, 380).overlay).toBe(true);
    expect(row(784, 0).overlay).toBe(false);
  });

  it("keeps the conversation beside the artifact at full HD", () => {
    const { overlay, width } = row(1680, 380);
    expect(overlay).toBe(false);
    expect(1680 - width).toBeGreaterThanOrEqual(420);
    expect(width).toBeGreaterThan(960);
  });

  it("still docks beside a full artifact only when the page keeps 560", () => {
    expect(studioPaneLayout({ surface: "full", surfaceWidth: 900, stored: 380 }).docked).toBe(false);
    expect(studioPaneLayout({ surface: "full", surfaceWidth: 1000, stored: 380 }).docked).toBe(true);
    expect(studioPaneLayout({ surface: "full", surfaceWidth: 0, stored: 380 }).docked).toBe(true);
  });
});
