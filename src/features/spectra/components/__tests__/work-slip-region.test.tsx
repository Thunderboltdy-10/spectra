// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSpectraStreamEvent } from "../../ai/stream-events";
import { mergeTouch } from "../../ai/harness-exchange";
import { messageTouches, WorkTouchCards } from "../harness-run-parts";

afterEach(cleanup);

describe("a work slip opens where the run changed it (F5)", () => {
  it("keeps the region through the stream, the merge and the saved reply", () => {
    const event = parseSpectraStreamEvent({
      type: "artifact_touched",
      runId: "run-1",
      artifact: { id: "doc-1", type: "document", title: "Physics progress", action: "edited", region: "block:7" },
    });
    expect(event?.type === "artifact_touched" && event.artifact.region).toBe("block:7");
    const merged = mergeTouch([{ id: "doc-1", type: "document", title: "Physics progress", action: "referenced" }], {
      id: "doc-1", type: "document", title: "Physics progress", action: "edited", region: "block:7",
    });
    expect(merged[0]).toMatchObject({ action: "edited", region: "block:7" });
    expect(messageTouches({ artifacts: [{ id: "doc-1", type: "document", title: "Physics progress", action: "edited", region: "block:7" }] })[0]?.region).toBe("block:7");
    // A made work opens at its start.
    expect(messageTouches({ artifacts: [{ id: "doc-2", type: "document", title: "Sheet", action: "created", region: "block:1" }] })[0]?.region).toBeUndefined();
  });

  it("passes the region to whoever opens it", () => {
    const onOpen = vi.fn();
    render(<WorkTouchCards touches={[{ id: "doc-1", type: "document", title: "Physics progress", action: "edited", region: "block:7" }]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Physics progress" }));
    expect(onOpen).toHaveBeenCalledWith("doc-1", "block:7");
  });
});
