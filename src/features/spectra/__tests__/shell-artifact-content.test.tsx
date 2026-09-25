// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SpectraArtifact, SpectraOverview } from "../data/api";
import { mergeShellArtifactContent, releaseShellArtifactContent } from "../components/shell-artifact-content";
import { useShellArtifactContent } from "../components/use-shell-artifact-content";

afterEach(cleanup);

function artifact(id: string, content: unknown = { blocks: [{ text: "large paragraph".repeat(2_000) }] }): SpectraArtifact {
  return { _id: id, blueprintKey: "document", title: id, tags: [], status: "active", createdAt: 1, updatedAt: 1, content };
}

function overview(artifacts: SpectraArtifact[]): SpectraOverview {
  return {
    artifacts, workspaces: [], runs: [], resultCards: [],
    workspace: {
      workspace: {
        _id: "workspace", title: "Workspace", status: "active", defaultView: "library", createdAt: 1, updatedAt: 1, lastActivityAt: 1,
      },
      items: artifacts.map((item) => ({
        nodeId: `node-${item._id}`, workspaceId: "workspace", parentId: null, kind: "work", sourceId: item._id,
        name: item.title, pinned: false, orderKey: item._id, artifact: item, createdAt: 1, updatedAt: 1,
      })),
    },
  };
}

describe("shell artifact body lifetime", () => {
  it("releases closed bodies from detail, overview and workspace rows while preserving every metadata row", () => {
    const rows = Array.from({ length: 16 }, (_, index) => artifact(`work-${index}`));
    const source = overview(rows);
    const { result, rerender } = renderHook(({ open }) => useShellArtifactContent(open), {
      initialProps: { open: ["work-0", "work-1"] },
    });
    act(() => {
      result.current.setOverview(source);
      result.current.setHydratedArtifacts(Object.fromEntries(rows.map((row) => [row._id, row])));
    });
    expect(Object.keys(result.current.hydratedArtifacts)).toEqual(["work-0", "work-1"]);
    expect(result.current.overview?.artifacts).toHaveLength(16);
    expect(result.current.overview?.workspace?.items).toHaveLength(16);
    expect(result.current.overview?.artifacts[0]).toBe(rows[0]);
    expect(result.current.overview?.artifacts[2]).not.toHaveProperty("content");
    expect(result.current.overview?.workspace?.items[2].artifact).not.toHaveProperty("content");
    // The caller's cached response and still-mounted editor objects are immutable.
    expect(source.artifacts[2].content).toBe(rows[2].content);
    rerender({ open: [] });
    expect(result.current.hydratedArtifacts).toEqual({});
    expect(result.current.overview?.artifacts.every((row) => row.content === undefined)).toBe(true);
    expect(JSON.stringify(result.current.overview).length).toBeLessThan(JSON.stringify(source).length / 20);
    // Reopening cannot revive a released body from the metadata list.
    rerender({ open: ["work-0"] });
    expect(result.current.hydratedArtifacts).toEqual({});
    expect(result.current.overview?.artifacts[0].content).toBeUndefined();
  });

  it("preserves a pending handoff, open tabs and tiles through selection changes without cloning bodies", () => {
    const work = artifact("pending");
    const tile = artifact("tile");
    const { result, rerender } = renderHook(({ open, pending }) => useShellArtifactContent(open, pending), {
      initialProps: { open: ["tile"], pending: "pending" as string | undefined },
    });
    act(() => result.current.setHydratedArtifacts({ pending: work, tile }));
    expect(result.current.hydratedArtifacts.pending).toBe(work);
    rerender({ open: ["tile", "pending"], pending: undefined });
    expect(result.current.hydratedArtifacts.pending).toBe(work);
    expect(result.current.hydratedArtifacts.tile).toBe(tile);
    rerender({ open: ["tile"], pending: undefined });
    expect(result.current.hydratedArtifacts).toEqual({ tile });
  });

  it("keeps exact shorter, empty and null canonical updates instead of an old open snapshot", () => {
    const old = { ...artifact("work", { text: "long old content" }), currentVersionId: "old" };
    for (const content of [{ text: "short" }, { text: "" }, null]) {
      const fresh = { ...old, content, updatedAt: 2, currentVersionId: "fresh" };
      const merged = mergeShellArtifactContent(fresh, old);
      expect(merged.content).toBe(content);
      expect(merged.currentVersionId).toBe("fresh");
    }
    const readOnly = { ...old, updatedAt: 2, accessLevel: "read" as const, capabilities: ["read" as const] };
    expect(mergeShellArtifactContent(readOnly, old)).toBe(readOnly);
    const staleList = { ...releaseShellArtifactContent(old), accessLevel: "modify" as const, capabilities: ["modify" as const, "read" as const] };
    expect(mergeShellArtifactContent(staleList, { ...old, content: "", accessLevel: "read", capabilities: ["read"] })).toMatchObject({
      content: "", accessLevel: "read", capabilities: ["read"],
    });
    const newlyGranted = { ...old, accessLevel: "modify" as const, capabilities: ["modify" as const, "read" as const] };
    expect(mergeShellArtifactContent(releaseShellArtifactContent(readOnly), newlyGranted)).toBe(newlyGranted);
  });

  it("keeps active visible AI previews but releases settled preview bodies", () => {
    const preview = { text: "streamed content" };
    const active = { ...artifact("work"), aiState: "updating" as const, aiPreview: { startedAt: 1, content: preview } };
    const released = releaseShellArtifactContent(active);
    expect(released.content).toBeUndefined();
    expect(released.aiPreview?.content).toBe(preview);
    expect(releaseShellArtifactContent({ ...active, aiState: "edited" }).aiPreview).toEqual({ startedAt: 1 });
    expect(releaseShellArtifactContent({ ...active, accessLevel: null }).aiPreview).toEqual({ startedAt: 1 });
  });

  it("releases explicitly revoked or deleted details even while their old tabs are open", () => {
    const denied = { ...artifact("denied"), accessLevel: null };
    const deleted = { ...artifact("deleted"), status: "deleted" as const };
    const { result } = renderHook(() => useShellArtifactContent(["denied", "deleted"]));
    act(() => {
      result.current.setHydratedArtifacts({ denied, deleted });
      result.current.setOverview(overview([denied, deleted]));
    });
    expect(result.current.hydratedArtifacts).toEqual({});
    expect(result.current.overview?.artifacts.every((row) => row.content === undefined)).toBe(true);
  });
});
