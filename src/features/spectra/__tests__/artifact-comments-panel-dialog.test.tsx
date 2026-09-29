// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../data/api", () => ({
  getSpectraArtifactComments: vi.fn(async () => ({ comments: [] })),
  getSpectraArtifactCommentPreference: vi.fn(async () => ({ mode: "mentions_replies" })),
  postSpectra: vi.fn(async () => ({})),
  searchSpectraSchoolMembers: vi.fn(async () => ({ members: [] })),
}));
vi.mock("../compute/autocomplete", () => ({ LocalAutocompleteTextarea: () => null }));

import { ArtifactCommentsPanel } from "../components/artifact-comments-panel";

afterEach(cleanup);

// The comments panel sits on the shared Dialog: menus opened inside it float
// over it, and Escape closes only the topmost surface.

async function renderPanel(onClose = vi.fn()) {
  render(
    <ArtifactCommentsPanel
      open
      artifactId="artifact-1"
      artifactTitle="Essay"
      regions={[{ regionId: "artifact:structure", label: "Whole work" }]}
      onClose={onClose}
    />,
  );
  await act(async () => {});
  return onClose;
}

describe("comments panel on the shared Dialog", () => {
  it("is a named modal dialog", async () => {
    await renderPanel();
    expect(screen.getByRole("dialog", { name: "Comments" })).toBeTruthy();
  });

  it("opens the notifications menu over the panel, and Escape closes only the menu", async () => {
    const onClose = await renderPanel();
    fireEvent.keyDown(screen.getByRole("button", { name: "Comment notifications" }), { key: "Enter" });
    const menu = await screen.findByRole("menu");
    // Before: the menu opened at z-dropdown (60), under the panel (z-panel, 80).
    expect(menu.className).not.toContain("z-dropdown");

    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Comments" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
