import { describe, expect, it, vi } from "vitest";
import { APP_COMMANDS, buildKBarEntries, rankKBarCommand, searchAuthorizedKBar, type KBarContext } from "../commands";
import * as spectraApi from "../data/api";

const context = (overrides: Partial<KBarContext> = {}): KBarContext => ({
  pathname: "/workspace",
  activeRunIds: [],
  followingAi: false,
  continueCurrentConversation: false,
  ...overrides,
});

describe("contextual K-bar registry", () => {
  it("keeps internal authority controls out of the human palette", () => {
    const entries = buildKBarEntries(APP_COMMANDS, context(), "");
    expect(entries.some((entry) => entry.command.visibility === "internal")).toBe(false);
    expect(entries.some((entry) => entry.command.id === "app.security.credentials")).toBe(false);
  });

  it("ranks actions from the mounted surface and active run first", () => {
    const entries = buildKBarEntries(APP_COMMANDS, context({
      pathname: "/settings",
      activeRunIds: ["run-1"],
    }), "");
    const settings = entries.findIndex((entry) => entry.command.id === "app.settings.toggle-continuation");
    const newChat = entries.findIndex((entry) => entry.command.id === "app.chat.new");
    const stopRun = entries.findIndex((entry) => entry.command.id === "app.run.stop");
    expect(settings).toBeGreaterThanOrEqual(0);
    expect(stopRun).toBeGreaterThanOrEqual(0);
    expect(settings).toBeLessThan(newChat);
    expect(rankKBarCommand(APP_COMMANDS.find((command) => command.id === "app.run.stop")!, context({ activeRunIds: [] }))).toBe(Number.NEGATIVE_INFINITY);
  });

  it("converges authorized work, workspace, and thread results onto registered commands", () => {
    const entries = buildKBarEntries(APP_COMMANDS, context(), "biology", [
      { id: "work-1", kind: "artifact", title: "Biology notes", params: { workId: "work-1", surface: "panel" } },
      { id: "workspace-1", kind: "workspace", title: "Biology", params: { destination: "workspace", targetId: "workspace-1" } },
      { id: "thread-1", kind: "thread", title: "Biology review", params: { threadId: "thread-1" } },
    ]);
    expect(entries.find((entry) => entry.id === "artifact:work-1")?.command.id).toBe("app.work.open");
    expect(entries.find((entry) => entry.id === "workspace:workspace-1")?.command.id).toBe("app.navigate");
    expect(entries.find((entry) => entry.id === "thread:thread-1")?.command.id).toBe("app.thread.open");
  });

  it("pages the conversation index instead of treating the first page as global search", async () => {
    const search = vi.spyOn(spectraApi, "searchSpectra").mockResolvedValue({ artifacts: [], workspaces: [] });
    const threads = vi.spyOn(spectraApi, "getSpectraThreads").mockImplementation(async (params) =>
      params?.cursor
        ? { threads: [{ _id: "thread-2", title: "Older biology review", origin: "chat", status: "active", createdAt: 1, updatedAt: 2 }], hasMore: false, nextCursor: undefined }
        : { threads: [], hasMore: true, nextCursor: "cursor-2" },
    );
    const signal = new AbortController().signal;
    await expect(searchAuthorizedKBar("biology", signal)).resolves.toEqual([
      expect.objectContaining({ id: "thread-2", kind: "thread" }),
    ]);
    expect(search).toHaveBeenCalledWith("biology", { signal });
    expect(threads).toHaveBeenCalledWith(expect.objectContaining({ cursor: "cursor-2", force: true }));
    search.mockRestore();
    threads.mockRestore();
  });
});
