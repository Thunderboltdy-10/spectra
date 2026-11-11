// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioPane, StudioPaneToolProvider, StudioToolPane, useStudioPane, type StudioPaneKind } from "../components/studio-pane";

vi.mock("../motion/motion-level", () => ({ useSpectraMotion: () => ({ disabled: true, level: "off" }) }));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function Work({ start = "comments" as StudioPaneKind | null, withTool = false }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<StudioPaneKind | null>(start);
  const [tool, setTool] = useState(withTool);
  const pane = useStudioPane({ surfaceRef, surface: "full", kind, onKind: setKind });
  return (
    <div ref={surfaceRef}>
      <p data-testid="state">{`${kind ?? "none"} ${pane.open ? "open" : "closed"}`}</p>
      <StudioPaneToolProvider value={pane.toolHost}>
        {tool ? (
          <StudioToolPane id="format" title="Format" onClose={() => setTool(false)}>
            <p>Number format</p>
          </StudioToolPane>
        ) : null}
      </StudioPaneToolProvider>
      <button type="button" onClick={() => setTool(true)}>Format</button>
      <button type="button" onClick={() => setKind("history")}>History</button>
      <StudioPane pane={pane} kinds={["about", "comments", "history"]} onKind={setKind}>
        <p>{kind} body</p>
      </StudioPane>
    </div>
  );
}

describe("the work's one pane", () => {
  it("names what it shows, switches in place, and closes", () => {
    render(<Work />);
    expect(screen.getByRole("complementary", { name: "Comments" })).toBeTruthy();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["About", "Comments", "History"]);
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByRole("complementary", { name: "Version history" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close this pane" }));
    expect(screen.getByTestId("state").textContent).toBe("none closed");
  });

  it("resizes from the keyboard within its bounds and remembers the width", () => {
    render(<Work />);
    const grip = screen.getByRole("separator", { name: "Resize this pane" });
    expect(grip.getAttribute("aria-valuenow")).toBe("380");
    fireEvent.keyDown(grip, { key: "ArrowLeft" });
    expect(grip.getAttribute("aria-valuenow")).toBe("396");
    expect(window.localStorage.getItem("spectra.panel.studio-pane")).toBe("396");
    for (let index = 0; index < 20; index++) fireEvent.keyDown(grip, { key: "ArrowRight" });
    expect(grip.getAttribute("aria-valuenow")).toBe("300");
  });

  it("gives its place to a studio tool, and a work button puts the tool away", () => {
    render(<Work start={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    expect(screen.getByRole("complementary", { name: "Format" }).textContent).toContain("Number format");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.queryByText("Number format")).toBeNull();
    expect(screen.getByRole("complementary", { name: "Version history" })).toBeTruthy();
  });
});
