// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerArtifactDock } from "../components/composer-artifact-dock";
import type { SpectraArtifact } from "../data/api";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  error: vi.fn(),
  memberships: new Map<string, string[]>(),
}));
vi.mock("convex/react", () => ({ useMutation: () => mocks.create }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
vi.mock("../components/artifact-embed-host", () => ({
  useArtifactEmbedContainer: (_type: string, id: string) => ({
    canConfigure: true,
    embeds: (mocks.memberships.get(id) ?? []).map((sourceArtifactId) => ({
      sourceArtifactId,
    })),
  }),
}));
vi.mock("../components/artifact-card", () => ({ workTypeMeta: {} }));
vi.mock("../artifacts/registry", () => ({
  isArtifactTypeKey: (value: string) => value === "document",
}));
vi.mock("../capabilities", () => ({ suggestedEmbedInteraction: () => "read" }));

const source: SpectraArtifact = {
  _id: "source",
  blueprintKey: "document",
  title: "Research notes",
  tags: [],
  status: "active",
  createdAt: 1,
  updatedAt: 1,
};
const second: SpectraArtifact = {
  ...source,
  _id: "second",
  title: "Field notes",
};

function dock(threadId = "a", artifacts = [source]) {
  return (
    <ComposerArtifactDock
      threadId={threadId}
      artifacts={artifacts}
      explicitIds={artifacts.map((item) => item._id)}
    />
  );
}
function keep(artifact = source) {
  return screen.getByRole("button", {
    name: `Keep ${artifact.title} in this conversation`,
  });
}
function deferred() {
  let resolve!: (value: { embedId: string }) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<{ embedId: string }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve: () => resolve({ embedId: "embed" }), reject };
}

beforeEach(() => {
  mocks.create.mockReset();
  mocks.error.mockReset();
  mocks.memberships.clear();
});
afterEach(cleanup);

describe("composer artifact membership and pending requests", () => {
  it("uses subscription membership after a successful keep and subsequent removal", async () => {
    const request = deferred();
    mocks.create.mockReturnValue(request.promise);
    const host = render(dock());
    fireEvent.click(keep());
    mocks.memberships.set("a", [source._id]);
    host.rerender(dock());
    await act(async () => request.resolve());
    expect(
      screen.getByLabelText("Research notes is in this conversation"),
    ).toBeInTheDocument();
    mocks.memberships.set("a", []);
    host.rerender(dock());
    expect(keep()).toBeEnabled();
  });

  it("does not carry a completed keep into another conversation", async () => {
    mocks.create.mockResolvedValue({ embedId: "embed-a" });
    const host = render(dock());
    await act(async () => {
      fireEvent.click(keep());
    });
    mocks.memberships.set("a", [source._id]);
    host.rerender(dock("b"));
    expect(keep()).toBeEnabled();
    expect(
      screen.queryByLabelText("Research notes is in this conversation"),
    ).toBeNull();
  });

  it("keeps requests independent across conversations, including revisiting a pending source", async () => {
    const first = deferred();
    const next = deferred();
    mocks.create
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(next.promise);
    const host = render(dock());
    fireEvent.click(keep());
    host.rerender(dock("b"));
    expect(keep()).toBeEnabled();
    fireEvent.click(keep());
    expect(mocks.create.mock.calls.map(([args]) => args.containerId)).toEqual([
      "a",
      "b",
    ]);
    host.rerender(dock("a"));
    expect(keep()).toBeDisabled();
    fireEvent.click(keep());
    expect(mocks.create).toHaveBeenCalledTimes(2);
    host.rerender(dock("b"));
    await act(async () => first.resolve());
    expect(keep()).toBeDisabled();
    mocks.memberships.set("b", [source._id]);
    host.rerender(dock("b"));
    await act(async () => next.resolve());
    expect(
      screen.getByLabelText("Research notes is in this conversation"),
    ).toBeInTheDocument();
  });

  it("lets independent sources finish without clearing each other's pending state", async () => {
    const first = deferred();
    const next = deferred();
    mocks.create
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(next.promise);
    render(dock("a", [source, second]));
    fireEvent.click(keep());
    expect(keep(second)).toBeEnabled();
    fireEvent.click(keep(second));
    await act(async () => first.resolve());
    expect(keep()).toBeEnabled();
    expect(keep(second)).toBeDisabled();
    await act(async () => next.resolve());
    expect(keep(second)).toBeEnabled();
  });

  it("does not resurrect a removed source when its pending mutation finishes", async () => {
    const request = deferred();
    mocks.create.mockReturnValue(request.promise);
    const host = render(dock());
    fireEvent.click(keep());
    host.rerender(dock("a", []));
    await act(async () => request.resolve());
    host.rerender(dock());
    expect(keep()).toBeEnabled();
  });

  it("prevents duplicate clicks and reports an active request failure before allowing retry", async () => {
    const request = deferred();
    mocks.create.mockReturnValue(request.promise);
    render(dock());
    const button = keep();
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    await act(async () => request.reject(new Error("Access denied")));
    expect(mocks.error).toHaveBeenCalledWith("Access denied");
    expect(keep()).toBeEnabled();
  });

  it("does not show an old request's error in a different conversation or after unmount", async () => {
    const first = deferred();
    const next = deferred();
    mocks.create
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(next.promise);
    const host = render(dock());
    fireEvent.click(keep());
    host.rerender(dock("b"));
    await act(async () => first.reject(new Error("Old conversation denied")));
    expect(mocks.error).not.toHaveBeenCalled();
    fireEvent.click(keep());
    host.unmount();
    await act(async () => next.reject(new Error("Unmounted request denied")));
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
