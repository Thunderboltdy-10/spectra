// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const bus = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("../../events", () => ({ spectraBus: bus }));
import { ViewOnlyCover } from "../view-only-cover";

afterEach(cleanup);

describe("a view-only preview's controls (F7)", () => {
  it("say they cannot be used here and offer the work", () => {
    render(<ViewOnlyCover workId="graph-1"><button type="button">Hide labels</button></ViewOnlyCover>);
    fireEvent.click(screen.getByRole("button", { name: "View only. Open this to change it" }));
    expect(screen.getByRole("status").textContent).toContain("Open this to change it");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(bus.command).toHaveBeenCalledWith("work.open", { workId: "graph-1", surface: "panel" });
  });
});
