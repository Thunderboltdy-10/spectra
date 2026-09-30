// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkAvailability, subscribeShellWorkAvailability } from "../components/use-work-availability";
import { createShellArtifactAccess } from "../components/shell-artifact-access";
import { useShellArtifactContent } from "../components/use-shell-artifact-content";
import { retireShellArtifactLocation } from "../pages/shell-location";
import type { SpectraArtifact } from "../data/api";

afterEach(cleanup);
const work: SpectraArtifact = {
  _id: "work", blueprintKey: "document", title: "Draft", content: "saved body",
  tags: [], status: "active", accessLevel: "modify", createdAt: 1, updatedAt: 1,
};

describe("reactive work availability", () => {
  it("evicts an open cached body through the existing ordered authority coordinator", async () => {
    const read = vi.fn().mockResolvedValue({ artifact: null });
    const access = createShellArtifactAccess(read);
    const { result, rerender } = renderHook(({ metadata }: { metadata: object | null | undefined }) => {
      const content = useShellArtifactContent(["work"]);
      useEffect(() => access.subscribe(content.revokeArtifact), [content.revokeArtifact]);
      useEffect(() => subscribeShellWorkAvailability(access), []);
      useWorkAvailability("work", metadata);
      return content;
    }, { initialProps: { metadata: undefined as object | null | undefined } });
    act(() => result.current.setHydratedArtifacts({ work }));
    expect(result.current.hydratedArtifacts.work?.content).toBe("saved body");
    expect(read).not.toHaveBeenCalled();
    rerender({ metadata: { replicas: [] } });
    expect(read).not.toHaveBeenCalled();
    rerender({ metadata: null });
    await waitFor(() => expect(result.current.hydratedArtifacts).toEqual({}));
    expect(read).not.toHaveBeenCalled();
    // An unchanged unavailable snapshot does not turn into a request loop.
    rerender({ metadata: null });
    expect(read).not.toHaveBeenCalled();
  });

  it("fences an earlier open read so it cannot resurrect the deleted body", async () => {
    let resolve!: (value: { artifact: SpectraArtifact }) => void;
    const read = vi.fn(() => new Promise<{ artifact: SpectraArtifact }>(done => { resolve = done; }));
    const access = createShellArtifactAccess(read);
    const unavailable = vi.fn();
    access.subscribe(unavailable);
    const pending = access.read("work");
    const { rerender } = renderHook(({ metadata }: { metadata: object | null | undefined }) => {
      useEffect(() => subscribeShellWorkAvailability(access), []);
      useWorkAvailability("work", metadata);
    }, { initialProps: { metadata: undefined as object | null | undefined } });
    rerender({ metadata: null });
    expect(unavailable).toHaveBeenCalledExactlyOnceWith("work");
    resolve({ artifact: work });
    expect(await pending).toEqual({ artifact: null });
    expect(unavailable).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["/library", "?artifactId=work&collection=trash", "/library?collection=trash"],
    ["/workspace/class", "?artifactId=work", "/workspace/class"],
    ["/library/work", "?collection=trash", "/library?collection=trash"],
    ["/library", "?artifactId=another", null],
  ])("retires only the unavailable work URL at %s%s", (pathname, search, expected) => {
    expect(retireShellArtifactLocation(pathname!, search!, "work")).toBe(expected);
  });
});
