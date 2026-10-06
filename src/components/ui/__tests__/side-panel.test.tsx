// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spectraBus } from "@/features/spectra/events";
import { PanelTabs, SidePanel } from "../side-panel";
import { EmptyState, ProblemState } from "../page-state";
import { PageHeader } from "../page-header";

beforeEach(() => {
  window.localStorage.clear();
  spectraBus.setQuery("side.open", null);
});
afterEach(cleanup);

function Page() {
  return (
    <div className="relative flex">
      <main>Stage</main>
      <SidePanel id="test.details" title="Details" icon="info">
        <p>Panel body</p>
      </SidePanel>
    </div>
  );
}

describe("SidePanel", () => {
  it("collapses to an edge tab, remembers it, and restores on one click", () => {
    render(<Page />);
    expect(screen.getByRole("complementary", { name: "Details" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("spectra.panel.test.details")!)).toMatchObject({ open: false });

    cleanup();
    render(<Page />);
    expect(screen.queryByText("Panel body")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("Panel body")).toBeTruthy();
  });

  it("tucks away while a closable panel holds the Side, and comes back when it closes", () => {
    render(<Page />);
    act(() => spectraBus.setQuery("side.open", { kind: "thread" }));
    expect(screen.queryByText("Panel body")).toBeNull();
    expect(screen.getByRole("button", { name: "Show details" })).toBeTruthy();
    act(() => spectraBus.setQuery("side.open", null));
    expect(screen.getByText("Panel body")).toBeTruthy();
    // Tucking is the shell's doing: the remembered state stays open.
    expect(window.localStorage.getItem("spectra.panel.test.details")).toBeNull();
  });

  it("resizes from the keyboard within its limits", () => {
    render(<Page />);
    const handle = screen.getByRole("separator", { name: "Resize details" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(Number(handle.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(340);
  });
});

describe("PanelTabs", () => {
  it("moves between tabs with the arrow keys", () => {
    let value = "details";
    const tabs = [
      { id: "details", label: "Details", icon: "info" as const },
      { id: "comments", label: "Comments", icon: "conversations" as const },
    ];
    const view = render(<PanelTabs tabs={tabs} value={value} onChange={(id) => (value = id)} label="Companion" />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Details" }), { key: "ArrowRight" });
    expect(value).toBe("comments");
    view.rerender(<PanelTabs tabs={tabs} value={value} onChange={(id) => (value = id)} label="Companion" />);
    expect(screen.getByRole("tab", { name: "Comments" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("page anatomy", () => {
  it("puts the title in one heading on the header line", () => {
    render(<PageHeader title="School" />);
    const heading = screen.getByRole("heading", { level: 1, name: "School" });
    expect(heading.className).toContain("font-display");
  });

  it("gives every state a next step", () => {
    render(
      <>
        <EmptyState icon="task" title="No tasks yet" detail="Sync ManageBac to bring them in." action={<button>Sync now</button>} />
        <ProblemState title="Tasks didn't load" detail="Check your connection." action={<button>Try again</button>} />
      </>,
    );
    expect(screen.getByRole("button", { name: "Sync now" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Tasks didn't load");
  });
});
