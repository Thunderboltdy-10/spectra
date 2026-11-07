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

// Comments live in the work's pane. A menu opened there floats over it, and
// Escape closes only the menu.

async function renderPanel() {
  render(
    <ArtifactCommentsPanel
      open
      artifactId="artifact-1"
      regions={[{ regionId: "artifact:structure", label: "Whole work" }]}
    />,
  );
  await act(async () => {});
}

describe("comments in the pane", () => {
  it("opens the notifications menu over the panel, and Escape closes only the menu", async () => {
    await renderPanel();
    fireEvent.keyDown(screen.getByRole("button", { name: "Comment notifications" }), { key: "Enter" });
    const menu = await screen.findByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Comment notifications" })).toBeTruthy();
  });
});
