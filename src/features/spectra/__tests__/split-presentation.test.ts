import { describe, expect, it } from "vitest";
import {
  allocateWorkbenchPanes,
  resolveSidebarRail,
  resolveSplitOverlay,
  resolveWorkbenchPanes,
  SIDE_PANEL_FLOOR_PX,
  SIDEBAR_EXPANDED_PX,
  SIDEBAR_RAILED_PX,
  SIDEBAR_RAIL_HYSTERESIS_PX,
  SPLIT_OVERLAY_HYSTERESIS_PX,
  WORKBENCH_CONTENT_RESERVE_PX,
  type WorkbenchPaneAllocation,
  type WorkbenchPaneSpec,
} from "../components/split-presentation";

/**
 * The split/overlay boundary is the one authority for narrow workbenches
 * (CANON D44): below it the studio covers the content column instead of
 * squeezing the library into an unreadable strip beside a clipped panel.
 */
describe("resolveSplitOverlay", () => {
  const documentFloors = { panelMinWidth: 360, contentReserve: 420 };
  const sheetsFloors = { panelMinWidth: 520, contentReserve: 420 };

  it("keeps the split when both floors fit the host", () => {
    expect(
      resolveSplitOverlay({ hostWidth: 780, ...documentFloors, overlay: false }),
    ).toBe(false);
    expect(
      resolveSplitOverlay({ hostWidth: 1200, ...sheetsFloors, overlay: false }),
    ).toBe(false);
  });

  it("promotes to overlay the moment the floors stop fitting", () => {
    // 768px viewport with the expanded sidebar leaves a 528px host.
    expect(
      resolveSplitOverlay({ hostWidth: 528, ...documentFloors, overlay: false }),
    ).toBe(true);
    // 1024px viewport: a document still splits (784px host), sheets cannot.
    expect(
      resolveSplitOverlay({ hostWidth: 784, ...documentFloors, overlay: false }),
    ).toBe(false);
    expect(
      resolveSplitOverlay({ hostWidth: 784, ...sheetsFloors, overlay: false }),
    ).toBe(true);
  });

  it("holds the overlay through the hysteresis band so the boundary cannot flap", () => {
    const needed = documentFloors.panelMinWidth + documentFloors.contentReserve;
    expect(
      resolveSplitOverlay({
        hostWidth: needed + SPLIT_OVERLAY_HYSTERESIS_PX - 1,
        ...documentFloors,
        overlay: true,
      }),
    ).toBe(true);
    expect(
      resolveSplitOverlay({
        hostWidth: needed + SPLIT_OVERLAY_HYSTERESIS_PX,
        ...documentFloors,
        overlay: true,
      }),
    ).toBe(false);
  });

  it("never changes presentation for an unmeasured host", () => {
    expect(
      resolveSplitOverlay({ hostWidth: 0, ...documentFloors, overlay: false }),
    ).toBe(false);
    expect(
      resolveSplitOverlay({ hostWidth: 0, ...documentFloors, overlay: true }),
    ).toBe(true);
  });
});

/**
 * The row-level budget: every open panel is resolved together so a side
 * panel can never squeeze the library into an unreadable strip — the
 * lowest-priority panel leaves the flow and overlays the content column
 * instead (CANON D44).
 */
describe("resolveWorkbenchPanes", () => {
  const reserve = WORKBENCH_CONTENT_RESERVE_PX; // 420
  const studio = (overlay = false): WorkbenchPaneSpec => ({
    id: "studio",
    floor: 360, // document registry floor
    priority: 0,
    overlay,
  });
  const thread = (overlay = false): WorkbenchPaneSpec => ({
    id: "thread",
    floor: SIDE_PANEL_FLOOR_PX, // 360
    priority: 1,
    overlay,
  });
  const run = (overlay = false): WorkbenchPaneSpec => ({
    id: "run",
    floor: SIDE_PANEL_FLOOR_PX,
    priority: 2,
    overlay,
  });

  it("keeps every panel in flow when the row fits floors plus reserve", () => {
    // 1440px window, expanded sidebar: 1200px row fits 360+360+420.
    const result = resolveWorkbenchPanes({
      hostWidth: 1200,
      contentReserve: reserve,
      panes: [studio(), thread()],
    });
    expect(result).toEqual({ studio: false, thread: false });
  });

  it("promotes the lowest-priority panel first when the row tightens", () => {
    // 1280px window with an expanded sidebar: 1040px row. The studio still
    // splits; the thread overlays the content column instead of crushing
    // the library to 280px (the pre-budget behavior).
    const result = resolveWorkbenchPanes({
      hostWidth: 1040,
      contentReserve: reserve,
      panes: [studio(), thread()],
    });
    expect(result).toEqual({ studio: false, thread: true });
  });

  it("splits the studio alone when only its own floor plus reserve fit", () => {
    // 1024px window, expanded sidebar: 784px row leaves 424px — exactly the
    // reserve — beside a document studio, so the studio stays in flow and
    // the thread overlays.
    const result = resolveWorkbenchPanes({
      hostWidth: 784,
      contentReserve: reserve,
      panes: [studio(), thread()],
    });
    expect(result).toEqual({ studio: false, thread: true });
  });

  it("never lets an in-flow side panel push an overlay below its own floor", () => {
    // Sheets needs 520px. An 860px row overlays the studio (860-520 < 420);
    // the thread may not split beside it, because that would leave the
    // studio's overlay only 500px — under its own floor.
    const sheets = { ...studio(), floor: 520 };
    const result = resolveWorkbenchPanes({
      hostWidth: 860,
      contentReserve: reserve,
      panes: [sheets, thread()],
    });
    expect(result).toEqual({ studio: true, thread: true });
  });

  it("lets a side panel split beside an overlayed studio when both floors fit", () => {
    // Sheets needs 520px. A 900px row overlays the studio (900-520 < 420)
    // but the thread can split — the overlay region it leaves (540px) feeds
    // the studio's floor.
    const sheets = { ...studio(), floor: 520 };
    const result = resolveWorkbenchPanes({
      hostWidth: 900,
      contentReserve: reserve,
      panes: [sheets, thread()],
    });
    expect(result).toEqual({ studio: true, thread: false });
  });

  it("stacks every panel as an overlay on the narrowest supported desktop", () => {
    // 768px window, railed sidebar: 692px row.
    const result = resolveWorkbenchPanes({
      hostWidth: 692,
      contentReserve: reserve,
      panes: [studio(), thread(), run()],
    });
    expect(result).toEqual({ studio: true, thread: true, run: true });
  });

  it("drops closed panels from the result so reopening starts in flow", () => {
    const result = resolveWorkbenchPanes({
      hostWidth: 1040,
      contentReserve: reserve,
      panes: [studio()],
    });
    expect(result).toEqual({ studio: false });
    expect("thread" in result).toBe(false);
  });

  it("holds a panel's presentation through the hysteresis band", () => {
    const needed = 360 + 360 + reserve; // studio + thread + library
    const overlay = resolveWorkbenchPanes({
      hostWidth: needed + SPLIT_OVERLAY_HYSTERESIS_PX - 1,
      contentReserve: reserve,
      panes: [studio(), thread(true)],
    });
    expect(overlay.thread).toBe(true);
    const split = resolveWorkbenchPanes({
      hostWidth: needed + SPLIT_OVERLAY_HYSTERESIS_PX,
      contentReserve: reserve,
      panes: [studio(), thread(true)],
    });
    expect(split.thread).toBe(false);
  });

  it("never changes any presentation for an unmeasured host", () => {
    const result = resolveWorkbenchPanes({
      hostWidth: 0,
      contentReserve: reserve,
      panes: [studio(), thread(true)],
    });
    expect(result).toEqual({ studio: false, thread: true });
  });
});

/**
 * The sidebar is the first pressure valve: rail it when the expanded chrome
 * would force a panel out of the flow, restore it when the window can hold
 * the full demand again. Window-based, so the rail cannot feed back into
 * its own decision.
 */
describe("resolveSidebarRail", () => {
  const demand = WORKBENCH_CONTENT_RESERVE_PX + 360 + 360; // reserve + studio + thread

  it("rails when the expanded sidebar cannot fit the open panels", () => {
    // 1280px window: expanded host 1040 < 1140 demand.
    expect(
      resolveSidebarRail({
        windowWidth: 1280,
        expandedWidth: SIDEBAR_EXPANDED_PX,
        railedWidth: SIDEBAR_RAILED_PX,
        demand,
        railed: false,
      }),
    ).toBe(true);
  });

  it("stays expanded when everything fits beside the full sidebar", () => {
    expect(
      resolveSidebarRail({
        windowWidth: 1440,
        expandedWidth: SIDEBAR_EXPANDED_PX,
        railedWidth: SIDEBAR_RAILED_PX,
        demand,
        railed: false,
      }),
    ).toBe(false);
  });

  it("holds the rail through the hysteresis band so the chrome cannot flap", () => {
    const restoreAt = demand + SIDEBAR_EXPANDED_PX + SIDEBAR_RAIL_HYSTERESIS_PX;
    expect(
      resolveSidebarRail({
        windowWidth: restoreAt - 1,
        expandedWidth: SIDEBAR_EXPANDED_PX,
        railedWidth: SIDEBAR_RAILED_PX,
        demand,
        railed: true,
      }),
    ).toBe(true);
    expect(
      resolveSidebarRail({
        windowWidth: restoreAt,
        expandedWidth: SIDEBAR_EXPANDED_PX,
        railedWidth: SIDEBAR_RAILED_PX,
        demand,
        railed: true,
      }),
    ).toBe(false);
  });

  it("never rails for an empty workbench", () => {
    expect(
      resolveSidebarRail({
        windowWidth: 900,
        expandedWidth: SIDEBAR_EXPANDED_PX,
        railedWidth: SIDEBAR_RAILED_PX,
        demand: 0,
        railed: false,
      }),
    ).toBe(false);
  });
});

/**
 * One allocation pass owns every in-flow panel width. Per-panel fitters
 * measuring each other oscillated (each refit chased room the other had
 * just taken, and the row could sum over budget); a pure function of
 * (host, intents) cannot thrash.
 */
describe("allocateWorkbenchPanes", () => {
  const reserve = WORKBENCH_CONTENT_RESERVE_PX; // 420
  const pane = (
    id: string,
    floor: number,
    intent: number,
    priority: number,
    overlay = false,
    recency = 0,
  ): WorkbenchPaneAllocation => ({ id, floor, intent, priority, overlay, recency });

  it("gives every panel its intent when the row is wide", () => {
    // 1920px window, expanded sidebar: 1680px row.
    const result = allocateWorkbenchPanes({
      hostWidth: 1680,
      contentReserve: reserve,
      panes: [pane("studio", 360, 720, 0), pane("thread", 360, 480, 1)],
    });
    expect(result).toEqual({ studio: 720, thread: 480 });
  });

  it("feeds the studio before the thread when the row tightens", () => {
    // 1440px window, expanded sidebar: 1200px row, 780px panel budget.
    // Floors first (360+360), then the 60px of slack goes to the work.
    const result = allocateWorkbenchPanes({
      hostWidth: 1200,
      contentReserve: reserve,
      panes: [pane("studio", 360, 720, 0), pane("thread", 360, 480, 1)],
    });
    expect(result).toEqual({ studio: 420, thread: 360 });
    // The library keeps its full reserve by construction.
    expect(1200 - result.studio - result.thread).toBe(reserve);
  });

  it("lets an explicit drag outrank default priority", () => {
    // Same row, but the user just dragged the thread wider: the thread's
    // intent is served first and the studio yields toward its floor.
    const result = allocateWorkbenchPanes({
      hostWidth: 1200,
      contentReserve: reserve,
      panes: [
        pane("studio", 360, 720, 0, false, 100),
        pane("thread", 360, 560, 1, false, 200),
      ],
    });
    expect(result).toEqual({ studio: 360, thread: 420 });
    expect(1200 - result.studio - result.thread).toBe(reserve);
  });

  it("excludes overlay panels and hands their room to the split studio", () => {
    // 1280px window, expanded sidebar: 1040px row, thread overlayed.
    const result = allocateWorkbenchPanes({
      hostWidth: 1040,
      contentReserve: reserve,
      panes: [pane("studio", 360, 720, 0), pane("thread", 360, 480, 1, true)],
    });
    expect(result).toEqual({ studio: 620 });
    expect(result.thread).toBeUndefined();
  });

  it("is idempotent — the output re-applied as intents changes nothing", () => {
    const first = allocateWorkbenchPanes({
      hostWidth: 1200,
      contentReserve: reserve,
      panes: [pane("studio", 360, 720, 0), pane("thread", 360, 480, 1)],
    });
    const second = allocateWorkbenchPanes({
      hostWidth: 1200,
      contentReserve: reserve,
      panes: [
        pane("studio", 360, first.studio, 0),
        pane("thread", 360, first.thread, 1),
      ],
    });
    expect(second).toEqual(first);
  });

  it("degrades to proportional shares if the floors ever exceed the budget", () => {
    const result = allocateWorkbenchPanes({
      hostWidth: 700,
      contentReserve: reserve,
      panes: [pane("studio", 360, 720, 0), pane("thread", 360, 480, 1)],
    });
    expect(result.studio + result.thread).toBeLessThanOrEqual(280);
    expect(result.studio).toBeGreaterThan(0);
  });

  it("allocates nothing for an unmeasured host or an empty row", () => {
    expect(
      allocateWorkbenchPanes({
        hostWidth: 0,
        contentReserve: reserve,
        panes: [pane("studio", 360, 720, 0)],
      }),
    ).toEqual({});
    expect(
      allocateWorkbenchPanes({
        hostWidth: 1200,
        contentReserve: reserve,
        panes: [],
      }),
    ).toEqual({});
  });
});
