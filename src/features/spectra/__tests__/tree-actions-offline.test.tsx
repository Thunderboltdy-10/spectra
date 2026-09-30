// @vitest-environment jsdom

import { cleanup, renderHook, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { useTreeActions } from "../organization/tree-client";
import { ProductOfflineBanner } from "../bridge/product-offline-banner";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) =>
    (args: unknown) => invoke(getFunctionName(reference), args),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  invoke.mockReset();
});

const operations: Array<[
  string,
  (actions: ReturnType<typeof useTreeActions>) => Promise<unknown>,
]> = [
  ["createFolder", (a) => a.createFolder("Notes", null)],
  ["rename", (a) => a.rename("node", "Notes")],
  ["move", (a) => a.move(["node"], null)],
  ["trash", (a) => a.trash(["node"])],
  ["restore", (a) => a.restore(["node"])],
  ["purge", (a) => a.purge(["node"])],
  ["setPinned", (a) => a.setPinned("node", true)],
  ["createReference", (a) => a.createReference("node", null)],
  ["ensureRoots", (a) => a.ensureRoots()],
  ["createWorkHere", (a) => a.createWorkHere({
    blueprintKey: "document", title: "Notes", parentId: null,
  })],
];

it.each(operations)("rejects %s while offline without an unsent mutation", async (_name, run) => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  invoke.mockImplementation(() => new Promise(() => {}));
  const { result } = renderHook(useTreeActions);
  const outcome = await Promise.race([
    run(result.current).then(() => "resolved", (error) => error),
    new Promise((resolve) => setTimeout(() => resolve("pending"), 50)),
  ]);
  expect(outcome).toBeInstanceOf(Error);
  expect(invoke).not.toHaveBeenCalled();
});

it("preserves an already-submitted restore across a later disconnection", async () => {
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  let finish!: (result: unknown) => void;
  invoke.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const { result } = renderHook(useTreeActions);
  const restore = result.current.restore(["node"]);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("orgTree:restore", { nodeIds: ["node"] });
  online.mockReturnValue(false);
  finish({ restored: 1 });
  await expect(restore).resolves.toEqual({ restored: 1 });
});

it("does not promise to replay every offline action", () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  render(<ProductOfflineBanner />);
  expect(screen.getByRole("status").textContent).toMatch(/actions.*connection/i);
  expect(screen.getByRole("status").textContent).not.toContain("send changes");
});
