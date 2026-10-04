import { describe, expect, it, vi } from "vitest";
import { APP_COMMANDS, buildKBarEntries, commandContextForKBar, mergeKBarResults, rankKBarCommand, searchKBarWorkspaces, semanticKBarResults, type KBarContext } from "../commands";
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

  it("never asks a person to type an internal ID", () => {
    // "Delete Library items" asked for "Comma-separated node IDs", and "Change
    // sync policy" for IDs plus JSON. Nobody can answer those; the commands
    // stay available to the AI and to surfaces that already know the target.
    for (const query of ["", "delete", "sync", "sharing", "classes", "resource", "organize"]) {
      const entries = buildKBarEntries(APP_COMMANDS, context(), query);
      const unanswerable = entries
        .filter((entry) =>
          (entry.command.parameters ?? []).some(
            (parameter) => parameter.kind === "item" && entry.params?.[parameter.name] === undefined,
          ),
        )
        .map((entry) => entry.command.id);
      expect(unanswerable).toEqual([]);
    }
    // A search result carries its own ID, so opening it still works.
    const results = buildKBarEntries(APP_COMMANDS, context(), "notes", [
      { id: "work-1", kind: "artifact", title: "Notes", params: { workId: "work-1", surface: "panel" } },
    ]);
    expect(results.find((entry) => entry.id === "artifact:work-1")?.command.id).toBe("app.work.open");
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

  it("opens semantic work and chat results through registered commands, in the layer's order", () => {
    const results = semanticKBarResults([
      { kind: "artifact", itemId: "work-2", title: "Cell respiration", typeLabel: "Slides", subtype: "presentation", snippet: "ATP", location: "Slide 3: Krebs", anchor: { kind: "artifact", artifactId: "work-2" }, score: 0.9, matchedBy: ["meaning"], ownership: "mine" },
      { kind: "thread", itemId: "thread-2", title: "Biology review", typeLabel: "Chat", snippet: "We covered mitosis", anchor: { kind: "thread", threadId: "thread-2", messageId: "m-1" }, score: 0.5, matchedBy: ["words"], ownership: "mine" },
      { kind: "event", itemId: "event-1", title: "Biology test", typeLabel: "Calendar event", snippet: "", anchor: { kind: "event", calendarItemId: "event-1" }, score: 0.4, matchedBy: ["words"], ownership: "mine" },
    ]);
    expect(results).toEqual([
      expect.objectContaining({ id: "work-2", kind: "artifact", subtitle: "Slides · Slide 3: Krebs", params: { workId: "work-2", surface: "panel" }, rank: 0 }),
      expect.objectContaining({ id: "thread-2", kind: "thread", params: { threadId: "thread-2" }, rank: 1 }),
    ]);
    // Neither title contains the query: the semantic order still holds, above the commands.
    const entries = buildKBarEntries(APP_COMMANDS, context(), "energy in cells", results);
    expect(entries.slice(0, 2).map((entry) => entry.id)).toEqual(["artifact:work-2", "thread:thread-2"]);
    expect(entries[0]?.command.id).toBe("app.work.open");
  });

  it("finds workspaces by name and merges them without duplicates", async () => {
    const search = vi.spyOn(spectraApi, "searchSpectra").mockResolvedValue({ artifacts: [], workspaces: [{ _id: "ws-1", title: "Biology" } as never] });
    const signal = new AbortController().signal;
    const workspaces = await searchKBarWorkspaces(" biology ", signal);
    expect(search).toHaveBeenCalledWith("biology", { signal });
    expect(workspaces).toEqual([expect.objectContaining({ id: "ws-1", kind: "workspace", params: { destination: "workspace", targetId: "ws-1" } })]);
    expect(mergeKBarResults(workspaces, workspaces)).toHaveLength(1);
    await expect(searchKBarWorkspaces("  ")).resolves.toEqual([]);
    search.mockRestore();
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
