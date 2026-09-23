import { describe, expect, it, vi } from "vitest";
import { APP_COMMANDS, buildKBarEntries, commandContextForKBar, rankKBarCommand, searchAuthorizedKBar, type KBarContext } from "../commands";
import { spectraBus } from "../events";
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

  it("seeds the active artifact and asks only for comment text", () => {
    const entries = buildKBarEntries(APP_COMMANDS, context({
      pathname: "/library/work-1",
      activeArtifactId: "work-1",
    }), "comment");
    const entry = entries.find((item) => item.command.id === "app.comments.add");
    expect(entry?.params).toEqual({ artifactId: "work-1" });
    expect(entry?.command.parameters).toEqual([
      expect.objectContaining({ name: "body", kind: "textarea", required: true }),
    ]);
  });

  it("offers registered academic document actions only for a mounted document", () => {
    const documentContext = context({
      pathname: "/library/doc-1",
      activeArtifactId: "doc-1",
      activeArtifactType: "document",
    });
    const documentEntries = buildKBarEntries(APP_COMMANDS, documentContext, "footnote");
    expect(documentEntries.find((entry) => entry.command.id === "document.insert.footnote")).toMatchObject({
      label: "Footnote",
      description: "A numbered note at the foot of the page",
    });
    expect(buildKBarEntries(APP_COMMANDS, context({
      pathname: "/workspace",
      activeArtifactId: "work-1",
      activeArtifactType: "whiteboard",
    }), "footnote").some((entry) => entry.command.id === "document.insert.footnote")).toBe(false);
  });

  it("routes a K-bar academic action to the registered editor command for its active artifact", async () => {
    const documentContext = context({
      pathname: "/library/doc-1",
      activeArtifactId: "doc-1",
      activeArtifactType: "document",
    });
    const entry = buildKBarEntries(APP_COMMANDS, documentContext, "footnote")
      .find((item) => item.command.id === "document.insert.footnote");
    expect(entry).toBeDefined();
    const received: unknown[] = [];
    const remove = spectraBus.handle("document.executeCommand", async (payload) => {
      received.push(payload);
      return {
        commandId: payload.commandId,
        status: "completed",
        effect: "mutate",
        message: "Footnote inserted.",
      };
    });
    try {
      await expect(entry!.command.execute(commandContextForKBar(documentContext, undefined), undefined)).resolves.toMatchObject({
        commandId: "document.insert.footnote",
        status: "completed",
        message: "Footnote inserted.",
      });
      expect(received).toEqual([{
        artifactId: "doc-1",
        commandId: "document.insert.footnote",
      }]);
    } finally {
      remove();
    }
  });
});
