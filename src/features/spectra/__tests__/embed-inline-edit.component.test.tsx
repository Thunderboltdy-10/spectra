// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpectraArtifactEmbed } from "../data/api";

const harness = vi.hoisted(() => ({
  embed: null as unknown,
  update: vi.fn(),
  getArtifact: vi.fn(),
  getVersions: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("convex/react", () => ({
  useQuery: () => harness.embed,
  useMutation: () => harness.update,
}));
vi.mock("../data/api", async (original) => ({
  ...(await original<typeof import("../data/api")>()),
  getSpectraArtifact: harness.getArtifact,
  getSpectraArtifactVersions: harness.getVersions,
}));
// The work's own studio is covered by its own tests; here it only has to open and close.
vi.mock("../components/artifact-studio", () => ({
  ArtifactStudio: ({
    artifact,
    onClose,
    onDirtyChange,
    instanceKey,
  }: {
    artifact: { _id: string; title: string };
    onClose: () => void;
    onDirtyChange: (id: string, dirty: boolean) => void;
    instanceKey?: string;
  }) => (
    <section aria-label="Embedded studio" data-instance={instanceKey}>
      <p>{artifact.title} studio</p>
      <button type="button" onClick={onClose}>
        Close studio
      </button>
      <button type="button" onClick={() => onDirtyChange(artifact._id, true)}>
        Make a change
      </button>
    </section>
  ),
}));

import { ArtifactEmbedById, editableInPlace } from "../components/artifact-embed-host";
import { spectraBus } from "../events";

function embed(overrides: Partial<SpectraArtifactEmbed> = {}): SpectraArtifactEmbed {
  return {
    embedId: "embed-1",
    containerType: "artifact",
    containerId: "doc-1",
    containerRegionId: "artifact:structure",
    sourceArtifactId: "deck-1",
    mode: "compact",
    state: "ready",
    interaction: "read",
    effectiveInteraction: "read",
    versionPolicy: "live",
    contextPolicy: "summary",
    canConfigure: true,
    canEditSource: true,
    source: {
      artifactId: "deck-1",
      title: "Cell biology",
      blueprintKey: "presentation",
      snapshot: { content: { slides: [{ id: "s1", title: "The cell", objects: [] }] } },
    },
    ...overrides,
  } as SpectraArtifactEmbed;
}

function preview() {
  return document.querySelector<HTMLElement>("[data-embed-preview]")!;
}

beforeEach(() => {
  harness.embed = embed();
  harness.update.mockResolvedValue(undefined);
  harness.getArtifact.mockResolvedValue({ artifact: { _id: "deck-1", title: "Cell biology", blueprintKey: "presentation" } });
  harness.getVersions.mockResolvedValue({ versions: [{ _id: "version-9", artifactId: "deck-1" }], continueCursor: null, isDone: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("editing an embedded work where it is embedded", () => {
  it("edits on a double-click, with its own studio in the frame, and Escape folds it back", async () => {
    const open = vi.fn();
    render(<ArtifactEmbedById embedId="embed-1" editInPlace onOpenSource={open} />);
    fireEvent.click(preview());
    fireEvent.click(preview());
    fireEvent.doubleClick(preview());
    expect(await screen.findByLabelText("Embedded studio")).toBeTruthy();
    expect(harness.getArtifact).toHaveBeenCalledWith("deck-1", expect.anything());
    const frame = document.querySelector("[data-embed-editor]")!;
    expect(frame).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
    // The double-click edits; it does not also open the Side.
    await new Promise((resolve) => setTimeout(resolve, 320));
    expect(open).not.toHaveBeenCalled();
    fireEvent.keyDown(frame, { key: "Escape" });
    expect(document.querySelector("[data-embed-editor]")).toBeNull();
    expect(preview().getAttribute("data-life-key")).toBe("embed:embed-1");
  });

  it("opens the work in the Side on a single click", async () => {
    const open = vi.fn();
    render(<ArtifactEmbedById embedId="embed-1" editInPlace onOpenSource={open} />);
    fireEvent.click(preview());
    await waitFor(() => expect(open).toHaveBeenCalledWith("deck-1"));
    expect(document.querySelector("[data-embed-editor]")).toBeNull();
  });

  it("enters from Edit here and leaves from Done or the studio's own close", async () => {
    render(<ArtifactEmbedById embedId="embed-1" editInPlace onOpenSource={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Cell biology here" }));
    fireEvent.click(await screen.findByRole("button", { name: "Close studio" }));
    expect(screen.queryByLabelText("Embedded studio")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit Cell biology here" }));
    await screen.findByLabelText("Embedded studio");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("Embedded studio")).toBeNull();
  });

  it("asks only its own copy to close when Done leaves unsynced changes", async () => {
    const requests: Array<{ workId: string; instance?: string }> = [];
    const stop = spectraBus.handle("work.requestClose", (request) => {
      requests.push(request);
    });
    try {
      render(<ArtifactEmbedById embedId="embed-1" editInPlace onOpenSource={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Edit Cell biology here" }));
      const studio = await screen.findByLabelText("Embedded studio");
      expect(studio.getAttribute("data-instance")).toBe("embed-1");
      fireEvent.click(screen.getByRole("button", { name: "Make a change" }));
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      // The studio asks first; the same work open in the Side is not asked at all.
      expect(requests).toEqual([{ workId: "deck-1", instance: "embed-1" }]);
      expect(screen.getByLabelText("Embedded studio")).toBeTruthy();
    } finally {
      stop();
    }
  });

  it("shows a ghost while the work loads and says when it cannot open", async () => {
    let fail!: (error: Error) => void;
    harness.getArtifact.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
    render(<ArtifactEmbedById embedId="embed-1" editInPlace />);
    fireEvent.doubleClick(preview());
    expect(screen.getByRole("status", { name: "Opening the work here" }).hasAttribute("data-life-ghost")).toBe(true);
    await act(async () => fail(new Error("offline")));
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Embedded studio")).toBeTruthy();
  });

  it("keeps a pinned version read-only, with a clear way to follow the live work", async () => {
    harness.embed = embed({ versionPolicy: "pinned", pinnedVersionId: "version-1" });
    render(<ArtifactEmbedById embedId="embed-1" editInPlace />);
    expect(screen.getByText("Pinned, read-only")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /here$/ })).toBeNull();
    fireEvent.doubleClick(preview());
    expect(document.querySelector("[data-embed-editor]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Follow live" }));
    await waitFor(() =>
      expect(harness.update).toHaveBeenCalledWith({ embedId: "embed-1", versionPolicy: "live" }),
    );
  });

  it("pins the latest saved version", async () => {
    render(<ArtifactEmbedById embedId="embed-1" editInPlace />);
    fireEvent.click(screen.getByRole("button", { name: "Pin the latest saved version" }));
    await waitFor(() =>
      expect(harness.update).toHaveBeenCalledWith({
        embedId: "embed-1",
        versionPolicy: "pinned",
        pinnedVersionId: "version-9",
      }),
    );
    expect(harness.getVersions).toHaveBeenCalledWith("deck-1", 1);
  });

  it("is edited here only in an editor, by someone who may change the work, for a type that fits", () => {
    expect(editableInPlace(embed())).toBe(true);
    expect(editableInPlace(embed({ canEditSource: false }))).toBe(false);
    expect(editableInPlace(embed({ versionPolicy: "pinned" }))).toBe(false);
    expect(editableInPlace(embed({ state: "archived" }))).toBe(false);
    expect(
      editableInPlace(
        embed({ source: { artifactId: "code-1", title: "Sim", blueprintKey: "code" } }),
      ),
    ).toBe(false);
    render(<ArtifactEmbedById embedId="embed-1" />);
    expect(screen.queryByRole("button", { name: "Edit Cell biology here" })).toBeNull();
  });
});
