// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toastError = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("convex/react", () => ({
  useQuery: () => ({ embeds: [deckEmbed()], canConfigure: true }),
  useMutation: () => update,
}));

import { ArtifactEmbed, whiteboardPreviewNodes } from "../components/artifact-embed";
import { ArtifactEmbedList } from "../components/artifact-embed-host";
import type { SpectraArtifactEmbed } from "../data/api";

function deckEmbed(): SpectraArtifactEmbed {
  return {
    embedId: "embed-1",
    mode: "expanded",
    state: "ready",
    interaction: "interact",
    versionPolicy: "live",
    source: {
      artifactId: "deck-1",
      title: "Cell biology",
      blueprintKey: "presentation",
      snapshot: {
        content: {
          slides: [
            { id: "s1", title: "The cell", objects: [] },
            { id: "s2", title: "Organelles", objects: [] },
          ],
        },
      },
    },
  } as unknown as SpectraArtifactEmbed;
}

/** Everything done to the embed itself waits in its one options menu. */
async function chooseOption(title: string, item: string) {
  await act(async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: `Options for ${title}` }), { key: "Enter" });
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(item) }));
}

afterEach(() => {
  cleanup();
  toastError.mockClear();
  update.mockReset();
});

describe("the embed frame", () => {
  it("opens the artifact from its name and from its options menu", async () => {
    const open = vi.fn();
    render(<ArtifactEmbed embed={deckEmbed()} onOpenSource={open} />);
    fireEvent.click(screen.getByRole("button", { name: "Cell biology" }));
    await chooseOption("Cell biology", "Open");
    expect(open).toHaveBeenNthCalledWith(1, "deck-1");
    expect(open).toHaveBeenNthCalledWith(2, "deck-1");
    // The name repeats Open for the pointer; the keyboard has the menu.
    expect(screen.getByRole("button", { name: "Cell biology" }).tabIndex).toBe(-1);
    expect(screen.queryByText("Open source")).toBeNull();
  });

  it("names the slide arrows, which were icon-only buttons without a name", () => {
    render(<ArtifactEmbed embed={deckEmbed()} />);
    expect(screen.getByRole("button", { name: "Previous slide" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(screen.getByText("Slide 2 of 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next slide" })).toHaveProperty("disabled", true);
  });

  it("says when a size change is refused instead of rejecting unhandled", async () => {
    update.mockRejectedValue(new Error("[CONVEX M(artifactEmbeds:update)] Server Error"));
    render(<ArtifactEmbedList containerType="thread" containerId="thread-1" />);
    await chooseOption("Cell biology", "Show less");
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(String(toastError.mock.calls[0]?.[0])).toBe("The reference size could not be changed.");
  });
});

describe("the board preview", () => {
  const node = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
    id,
    type: "note",
    pageId: "p1",
    x,
    y,
    width: 120,
    height: 80,
    content: { text: id },
    ...extra,
  });

  it("keeps the board's arrangement instead of scattering nodes by index", () => {
    const nodes = whiteboardPreviewNodes(
      {
        viewport: { x: 0, y: 0, zoom: 1, pageId: "p1" },
        nodes: [node("left", 0, 100), node("right", 1000, 100), node("below", 0, 600)],
      },
      8,
    );
    const at = Object.fromEntries(nodes.map((entry) => [entry.id, entry]));
    expect(at.left!.left).toBeLessThan(at.right!.left);
    expect(at.left!.top).toBe(at.right!.top);
    expect(at.below!.top).toBeGreaterThan(at.left!.top);
    expect(at.below!.left).toBe(at.left!.left);
  });

  it("shows only the current page and leaves hidden nodes out", () => {
    const nodes = whiteboardPreviewNodes(
      {
        viewport: { x: 0, y: 0, zoom: 1, pageId: "p2" },
        nodes: [node("a", 0, 0), node("b", 10, 10, { pageId: "p2" }), node("c", 20, 20, { pageId: "p2", hidden: true })],
      },
      8,
    );
    expect(nodes.map((entry) => entry.id)).toEqual(["b"]);
  });
});
