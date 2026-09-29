// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioTabRail } from "../components/artifact-studio-shell";

beforeEach(() => {
  const slot = document.createElement("div");
  slot.id = "spectra-shell-tab-slot";
  document.body.append(slot);
});

afterEach(() => {
  cleanup();
  document.getElementById("spectra-shell-tab-slot")?.remove();
});

describe("studio tab rail", () => {
  it("renders activate and close as sibling buttons, never a button inside a button", () => {
    const onActivateHub = vi.fn();
    const onCloseHub = vi.fn();
    render(
      <StudioTabRail
        hubTabs={[
          { id: "hub-1", label: "All work" },
          { id: "hub-2", label: "Physics" },
        ]}
        activeHubTabId="hub-1"
        artifacts={[]}
        tabs={[]}
        dirtyIds={new Set()}
        onActivateHub={onActivateHub}
        onCloseHub={onCloseHub}
        onAddHub={() => undefined}
        onActivateTab={() => undefined}
        onCloseTab={() => undefined}
        persistent
      />,
    );
    const close = screen.getByRole("button", { name: "Close Physics" });
    expect(close.tagName).toBe("BUTTON");
    expect(close.parentElement?.closest("button")).toBeNull();
    expect(document.querySelector("button [role='button'], button button")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Physics" }));
    expect(onActivateHub).toHaveBeenCalledWith("hub-2");
    expect(onCloseHub).not.toHaveBeenCalled();

    fireEvent.click(close);
    expect(onCloseHub).toHaveBeenCalledWith("hub-2");
    expect(onActivateHub).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "All work" }).getAttribute("aria-current"),
    ).toBe("page");
  });
});
