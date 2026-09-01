import { describe, expect, it } from "vitest";
import {
  resolveSplitOverlay,
  SPLIT_OVERLAY_HYSTERESIS_PX,
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
