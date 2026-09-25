import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, act, live } = vi.hoisted(() => ({ query: vi.fn(), act: vi.fn(), live: vi.fn() }));
vi.mock("./io", () => ({ query, act, mutate: vi.fn() }));
vi.mock("@/features/spectra/ai/yjs-artifact-operation", () => ({ readLiveArtifactValue: live }));
import { buildContext, gatherResolvedArtifactContext } from "./gather";

const artifactId = "wx76vwa1ttg0p5vccm7m3h8ry98f1718";
const deniedId = "wx71ayyqjky5hqv5sr200mp9s58f1fj7";
const metadata = { _id: artifactId, title: "Chemistry guide", blueprintKey: "document", updatedAt: 10, contentAvailable: false };
const contents = { ...metadata, content: { blocks: [{ id: "a", text: "EDITOR BODY SHOULD BE DEMAND LOADED", type: "paragraph" }] } };

beforeEach(() => {
  vi.clearAllMocks();
  query.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "spectraContext:getArtifact") return args.artifactId === artifactId ? metadata : null;
    if (name === "spectraArtifacts:get") return args.artifactId === artifactId ? contents : null;
    if (name === "spectraContext:getWorkspace" || name === "orgTree:listWorkspaceContents")
      return { workspace: { _id: args.workspaceId, title: "Chemistry" }, items: [] };
    if (name === "spectraThreads:get" || name === "spectraThreads:getSummary") return {
      thread: { _id: args.threadId, title: "Chemistry discussion", summaryShort: "Prepare a useful revision pack" },
      ...(name.endsWith(":get") ? { messages: [{ role: "user", content: "Prepare the guide and practice questions." }] } : {}),
    };
    if (name === "spectraThreads:getChoiceContinuation") return {
      askingRun: { userPrompt: "Revise the guide and preserve the practice questions." },
      clarification: { targetIds: [artifactId] }, selection: { key: artifactId },
      message: { content: "Which guide?", metadata: { choiceSelection: { title: "Chemistry guide" } } },
    };
    return [];
  });
  act.mockResolvedValue(null);
  live.mockResolvedValue(null);
});

describe("initial context orientation", () => {
  it.each(["Hello!", "Why is the sky blue?", "Create a detailed revision guide"])(
    "does not discover workspace state based on the wording of %j", async (prompt) => {
      const context = await buildContext("actor", {}, prompt, { mode: "orientation" });
      expect(query).not.toHaveBeenCalled();
      expect(act).not.toHaveBeenCalled();
      expect(live).not.toHaveBeenCalled();
      expect(context.artifacts).toEqual([]);
      expect(context.packet.contextMode).toBe("orientation");
    },
  );

  it("loads visible target metadata once without editor content, links or broad state", async () => {
    const context = await buildContext("actor", {
      artifactId, workspaceId: "workspace", selectedArtifactIds: [artifactId],
    }, "Explain this idea", { mode: "orientation" });
    expect(context.focusedArtifact).toMatchObject({ id: artifactId, title: "Chemistry guide" });
    expect(context.selectedArtifactIds).toEqual([artifactId]);
    expect(context.currentWorkspace).toMatchObject({ id: "workspace", title: "Chemistry" });
    expect(JSON.stringify(context)).not.toContain("EDITOR BODY");
    expect(query.mock.calls.map(([name]) => name).sort()).toEqual(["spectraContext:getArtifact", "spectraContext:getWorkspace"]);
    expect(act).not.toHaveBeenCalled();
    expect(live).not.toHaveBeenCalled();
  });

  it("preserves exact update target authorization and reports unresolved references", async () => {
    const context = await buildContext("actor", {},
      `Update only the existing guide ${artifactId} and ${deniedId} in place.`, { mode: "orientation" });
    expect(context.explicitMutationTargetIds).toEqual([artifactId]);
    expect(context.unresolvedExplicitMutationTargetIds).toEqual([deniedId]);
    expect(context.selectedArtifactIds).toEqual([artifactId]);
  });

  it("reads permitted target contents only when execution asks for them", async () => {
    await buildContext("actor", { artifactId }, "Revise this guide", { mode: "orientation" });
    expect(live).not.toHaveBeenCalled();
    query.mockClear();
    const resolved = await gatherResolvedArtifactContext("actor", [artifactId, deniedId, artifactId]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.artifact).toMatchObject({ _id: artifactId, content: contents.content });
    expect(query.mock.calls).toEqual([
      ["spectraArtifacts:get", { actorClerkId: "actor", artifactId }],
      ["spectraArtifacts:get", { actorClerkId: "actor", artifactId: deniedId }],
    ]);
    expect(live).toHaveBeenCalledTimes(1);
    expect(live).toHaveBeenCalledWith({ artifactId, timeoutMs: 4_000 });
  });

  it("retains the current conversation and a durable clarification's original goal", async () => {
    const context = await buildContext("actor", {
      threadId: "current-thread", clarificationId: "question", choiceMessageId: "message",
      choiceKey: artifactId, clarificationExecutionId: "attempt",
    }, "That one", { mode: "orientation" });
    expect(context.conversation).toEqual([{ role: "user", content: "Prepare the guide and practice questions." }]);
    expect(context.packet.activeGoal).toMatchObject({ request: "Revise the guide and preserve the practice questions." });
    expect(context.focusedArtifact).toMatchObject({ id: artifactId });
    expect(context.currentThreadId).toBe("current-thread");
    expect(act).not.toHaveBeenCalled();
  });

  it("keeps explicitly attached workspace and thread identities without loading their contents", async () => {
    const context = await buildContext("actor", {
      explicitContextObjects: [
        { type: "workspace", id: "attached-workspace" },
        { type: "thread", id: "attached-thread" },
      ],
    }, "Use these sources", { mode: "orientation" });
    expect(context.workspaces).toEqual([expect.objectContaining({ id: "attached-workspace", explicit: true })]);
    expect(context.threads).toEqual([expect.objectContaining({ id: "attached-thread", explicit: true })]);
    expect(query.mock.calls.map(([name]) => name).sort()).toEqual(["spectraContext:getWorkspace", "spectraThreads:getSummary"]);
  });

  it("retains expanded context as the default for existing resume callers", async () => {
    const context = await buildContext("actor", { artifactId }, "Continue the current edit");
    expect(context.focusedArtifact).toMatchObject({ id: artifactId, content: contents.content });
    expect(query.mock.calls.some(([name]) => name === "spectraArtifacts:list")).toBe(true);
    expect(act).toHaveBeenCalled();
    expect(live).toHaveBeenCalled();
    expect(context.packet.contextMode).toBe("expanded");
  });
});
