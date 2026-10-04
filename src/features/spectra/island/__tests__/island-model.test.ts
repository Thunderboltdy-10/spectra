import { describe, expect, it } from "vitest";
import type { SpectraRunTab } from "../../data/api";
import { arrangeTabs, islandStatus, MAX_DONE, sideFor, tabStatus, tabTitle } from "../island-model";
import { pendingQuestions, splitAlwaysAllow } from "../questions";
import type { SpectraRunEngine } from "../engine";

let clock = 1_000;

function tab(
  runId: string,
  {
    status = "completed",
    threadId = `thread-${runId}`,
    title = `Thread ${runId}`,
    updatedAt = (clock += 10),
    hiddenAt,
    inputRequest,
    card,
  }: {
    status?: string;
    threadId?: string;
    title?: string;
    updatedAt?: number;
    hiddenAt?: number;
    inputRequest?: SpectraRunTab["inputRequest"];
    card?: unknown;
  } = {},
): SpectraRunTab {
  return {
    _id: `tab-${runId}`,
    runId,
    threadId,
    surface: "chat",
    createdAt: updatedAt,
    updatedAt,
    hiddenAt,
    run: { _id: runId, status, updatedAt, userPrompt: title } as unknown as SpectraRunTab["run"],
    thread: { _id: threadId, title } as unknown as SpectraRunTab["thread"],
    card: (card ?? null) as SpectraRunTab["card"],
    inputRequest,
  };
}

const none = new Set<string>();

describe("island tabs", () => {
  it("puts moving and unseen finished threads in play, seen ones done", () => {
    expect(sideFor("working", false)).toBe("play");
    expect(sideFor("needs_input", true)).toBe("play");
    expect(sideFor("completed", false)).toBe("play");
    expect(sideFor("completed", true)).toBe("done");
    expect(sideFor("cancelled", false)).toBe("done");
    expect(tabStatus("completed", false)).toBe("done");
    expect(tabStatus("completed", true)).toBeNull();
    expect(tabStatus("failed_terminal", false)).toBe("problem");
    expect(tabStatus("working", true)).toBe("working");
  });

  it("orders in play toward the + and done away from it", () => {
    const tabs = [tab("a", { status: "running" }), tab("b", { status: "running" }), tab("c"), tab("d")];
    const { play, done } = arrangeTabs(tabs, { seen: new Set(["c", "d"]) });
    // Oldest at the far left, newest beside the +.
    expect(play.map((item) => item.runId)).toEqual(["a", "b"]);
    // Newest beside the +.
    expect(done.map((item) => item.runId)).toEqual(["d", "c"]);
  });

  it("shows one tab per thread, its latest run, and leaves hidden tabs out", () => {
    const tabs = [
      tab("old", { threadId: "t", updatedAt: 10 }),
      tab("new", { threadId: "t", updatedAt: 20, status: "running" }),
      tab("gone", { hiddenAt: 5 }),
    ];
    const { play, done } = arrangeTabs(tabs, { seen: none });
    expect([...play, ...done].map((item) => item.runId)).toEqual(["new"]);
  });

  it("never moves a tab while the user is looking", () => {
    const tabs = [tab("a")];
    const held = new Map([["a", "play" as const]]);
    expect(arrangeTabs(tabs, { seen: new Set(["a"]), held }).play.map((item) => item.runId)).toEqual(["a"]);
    expect(arrangeTabs(tabs, { seen: new Set(["a"]) }).done.map((item) => item.runId)).toEqual(["a"]);
  });

  it("keeps the done side short", () => {
    const tabs = Array.from({ length: MAX_DONE + 4 }, (_, index) => tab(`d${index}`));
    const seen = new Set(tabs.map((item) => item.runId));
    expect(arrangeTabs(tabs, { seen }).done).toHaveLength(MAX_DONE);
  });

  it("ranks the prism's one status: needs over problem over working over done", () => {
    const { play } = arrangeTabs([tab("w", { status: "running" }), tab("f", { status: "failed" }), tab("c")], { seen: none });
    expect(islandStatus(play)).toBe("problem");
    expect(islandStatus(play.filter((item) => item.runId !== "f"))).toBe("working");
    expect(islandStatus(play.filter((item) => item.runId === "c"))).toBe("done");
    expect(islandStatus([])).toBeNull();
    expect(islandStatus([], { offline: true })).toBe("offline");
  });

  it("cuts titles at a word boundary", () => {
    expect(tabTitle("Photosynthesis deck")).toBe("Photosynthesis deck");
    expect(tabTitle("Compare the causes of the First World War")).toBe("Compare the causes of the…");
    expect(tabTitle("Supercalifragilisticexpialidocious notes")).toMatch(/…$/);
  });
});

describe("island questions", () => {
  it("splits Always allow into a label and its category", () => {
    expect(splitAlwaysAllow("Always allow deleting files")).toEqual({ label: "Always allow", description: "Deleting files" });
    expect(splitAlwaysAllow("Always allow")).toEqual({ label: "Always allow", description: "This kind of step" });
  });

  it("lists the live harness question first, then saved runs waiting on the user", () => {
    const engine = {
      liveExchange: {
        runId: "live",
        threadId: "thread-live",
        prompt: "Tidy my notes",
        input: {
          kind: "approval",
          toolCallId: "call-1",
          question: "Delete Old notes permanently?",
          options: [],
          alwaysAllowLabel: "Always allow deleting files",
        },
      },
    } as unknown as SpectraRunEngine;
    const tabs = [
      tab("choice", {
        status: "running",
        inputRequest: {
          kind: "choice",
          messageId: "m1",
          prompt: "Which class is this quiz for?",
          options: [{ key: "a", title: "10A" }, { key: "b", title: "10B" }],
        },
      }),
      tab("quiet", { status: "running" }),
    ];
    const questions = pendingQuestions(engine, tabs);
    expect(questions.map((question) => question.key)).toEqual(["live:live:call-1", "tab:choice"]);
    expect(questions[0]).toMatchObject({ kind: "approval", alwaysAllow: { description: "Deleting files" }, allowText: false });
    expect(questions[1]).toMatchObject({ kind: "question", options: [{ key: "a", label: "10A" }, { key: "b", label: "10B" }] });
  });

  it("asks nothing when nothing is waiting", () => {
    expect(pendingQuestions(null, [tab("a", { status: "running" })])).toEqual([]);
  });
});
