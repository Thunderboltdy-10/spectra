// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpectraArtifactComment } from "../data/api";

const api = vi.hoisted(() => ({
  comments: [] as SpectraArtifactComment[],
}));

vi.mock("../data/api", () => ({
  getSpectraArtifactComments: vi.fn(async () => ({ comments: api.comments })),
  getSpectraArtifactCommentPreference: vi.fn(async () => ({ mode: "mentions_replies" })),
  postSpectra: vi.fn(async () => ({})),
  searchSpectraSchoolMembers: vi.fn(async () => ({ members: [] })),
}));
vi.mock("../compute/autocomplete", () => ({ LocalAutocompleteTextarea: () => null }));

const life = vi.hoisted(() => ({
  arrivals: [] as Array<{ key: string | undefined; kind: string | undefined }>,
  unformed: [] as Element[],
}));
vi.mock("../life/use-life", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../life/use-life")>()),
  useLifeArrival: (_ref: unknown, key: string | undefined, kind: string | undefined) => {
    life.arrivals.push({ key, kind });
  },
  unformElement: (element: Element) => {
    life.unformed.push(element);
    return Promise.resolve();
  },
}));

import { ArtifactCommentsPanel } from "../components/artifact-comments-panel";
import { noteAiLocation } from "../collaboration/follow-ai";

function comment(id: string, overrides: Partial<SpectraArtifactComment> = {}): SpectraArtifactComment {
  return {
    _id: id,
    artifactId: "artifact-1",
    authorAccountId: "me",
    author: { accountId: "me", name: "Ana", kind: "human" },
    body: `Body of ${id}`,
    anchor: { regionId: "artifact:structure" },
    mentionedAccountIds: [],
    mentions: [],
    status: "open",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

async function renderPanel() {
  render(
    <ArtifactCommentsPanel
      open
      artifactId="artifact-1"
      currentAccountId="me"
      regions={[{ regionId: "artifact:structure", label: "Whole artifact" }]}
    />,
  );
  await act(async () => {});
}

beforeEach(() => {
  life.arrivals = [];
  life.unformed = [];
});
afterEach(cleanup);

describe("comments panel life", () => {
  it("shows what was there when it opened as plain content", async () => {
    api.comments = [comment("c1")];
    await renderPanel();
    expect(life.arrivals.filter((entry) => entry.key === "c1").every((entry) => entry.kind === undefined)).toBe(true);
  });

  it("forms Spectra's comment from the prism when Spectra comments while the panel is open", async () => {
    api.comments = [comment("c1")];
    await renderPanel();
    api.comments = [comment("c1"), comment("c2", { author: { accountId: "ai", name: "Spectra", kind: "ai" } })];
    await act(async () => {
      noteAiLocation({ artifactId: "artifact-1", path: "/comments/artifact:structure", note: "Added an AI comment" });
    });
    expect(life.arrivals).toContainEqual({ key: "c2", kind: "ai" });
    expect(life.arrivals.filter((entry) => entry.key === "c1").every((entry) => entry.kind === undefined)).toBe(true);
  });

  it("parts a removed comment's words where they were", async () => {
    api.comments = [comment("c1")];
    await renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove comment" }));
    });
    expect(life.unformed).toHaveLength(1);
    expect(life.unformed[0].textContent).toContain("Body of c1");
  });

  it("ticks off on resolve, and reopening stays quiet", async () => {
    api.comments = [comment("c1"), comment("c2", { status: "resolved" })];
    await renderPanel();
    expect(screen.getByRole("button", { name: "Resolve" }).hasAttribute("data-life-done")).toBe(true);
    expect(screen.getByRole("button", { name: "Reopen" }).hasAttribute("data-life-done")).toBe(false);
  });
});
