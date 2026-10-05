// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { SpectraRunTab } from "../../data/api";
import { EMPTY_ARRANGEMENT, forgetThread, placeThread, resetArrangement, type Arrangement } from "../arrange";
import { arrangeTabs, dropTab, previewTabs, stepTab } from "../island-model";

let clock = 1_000;

function tab(runId: string, { status = "completed", threadId = `thread-${runId}`, inputRequest }: { status?: string; threadId?: string; inputRequest?: SpectraRunTab["inputRequest"] } = {}): SpectraRunTab {
  const updatedAt = (clock += 10);
  return {
    _id: `tab-${runId}`,
    runId,
    threadId,
    surface: "chat",
    createdAt: updatedAt,
    updatedAt,
    run: { _id: runId, status, updatedAt, userPrompt: runId } as unknown as SpectraRunTab["run"],
    thread: { _id: threadId, title: runId } as unknown as SpectraRunTab["thread"],
    card: null,
    inputRequest,
  };
}

const ids = (tabs: Array<{ runId: string }>) => tabs.map((entry) => entry.runId);

function stored(): Arrangement {
  return JSON.parse(window.localStorage.getItem("spectra.island.arrange.v1") ?? "null") as Arrangement;
}

beforeEach(() => {
  window.localStorage.clear();
  resetArrangement();
});

describe("arranging the island by hand", () => {
  it("keeps the user's order on a side, with new threads nearest the +", () => {
    const seen = new Set(["a", "b", "c", "d"]);
    const tabs = [tab("a"), tab("b"), tab("c")];
    // Done reads away from the +, newest first: c, b, a.
    expect(ids(arrangeTabs(tabs, { seen }).done)).toEqual(["c", "b", "a"]);
    const arrangement: Arrangement = { sides: {}, order: { play: [], done: ["thread-a", "thread-c", "thread-b"] } };
    expect(ids(arrangeTabs(tabs, { seen, arrangement }).done)).toEqual(["a", "c", "b"]);
    // A thread the user never placed arrives beside the +.
    expect(ids(arrangeTabs([...tabs, tab("d")], { seen, arrangement }).done)).toEqual(["d", "a", "c", "b"]);
  });

  it("keeps play's order reading toward the +", () => {
    const tabs = [tab("a", { status: "running" }), tab("b", { status: "running" }), tab("c", { status: "running" })];
    const arrangement: Arrangement = { sides: {}, order: { play: ["thread-a", "thread-b", "thread-c"], done: [] } };
    // a nearest the +, so rightmost.
    expect(ids(arrangeTabs(tabs, { seen: new Set(), arrangement }).play)).toEqual(["c", "b", "a"]);
  });

  it("pins a done thread in play, and puts one away, for that run only", () => {
    const seen = new Set(["a", "b2"]);
    const arrangement: Arrangement = {
      sides: { "thread-a": { side: "play", runId: "a" }, "thread-b": { side: "done", runId: "b" } },
      order: { play: [], done: [] },
    };
    const first = arrangeTabs([tab("a"), tab("b", { status: "running", threadId: "thread-b" })], { seen, arrangement });
    expect(ids(first.play)).toEqual(["a"]);
    expect(ids(first.done)).toEqual(["b"]);
    expect(first.done[0].automaticSide).toBe("play");
    // The thread's next run starts fresh.
    const next = arrangeTabs([tab("b2", { status: "running", threadId: "thread-b" })], { seen, arrangement });
    expect(ids(next.play)).toEqual(["b2"]);
  });

  it("brings a put-away thread forward when it needs the user", () => {
    const arrangement: Arrangement = { sides: { "thread-q": { side: "done", runId: "q" } }, order: { play: [], done: [] } };
    const question = { kind: "approval" } as unknown as SpectraRunTab["inputRequest"];
    const { play } = arrangeTabs([tab("q", { status: "awaiting_confirmation", inputRequest: question })], { seen: new Set(), arrangement });
    expect(ids(play)).toEqual(["q"]);
  });

  it("previews and drops a tab across the +", () => {
    const { play, done } = arrangeTabs([tab("p1", { status: "running" }), tab("p2", { status: "running" }), tab("d1"), tab("d2")], {
      seen: new Set(["d1", "d2"]),
    });
    expect(ids(play)).toEqual(["p1", "p2"]);
    expect(ids(done)).toEqual(["d2", "d1"]);
    const preview = previewTabs(play, done, "d1", "play", 1);
    expect(ids(preview.play)).toEqual(["p1", "d1", "p2"]);
    expect(preview.play[1].side).toBe("play");
    expect(ids(preview.done)).toEqual(["d2"]);
    // Stored nearest the + first.
    expect(dropTab(play, done, "d1", "play", 1)).toEqual({ side: "play", order: ["thread-p2", "thread-d1", "thread-p1"] });
  });

  it("steps a tab with the keyboard, across the + as well", () => {
    const { play, done } = arrangeTabs([tab("p1", { status: "running" }), tab("p2", { status: "running" }), tab("d1"), tab("d2")], {
      seen: new Set(["d1", "d2"]),
    });
    expect(stepTab(play, done, "p1", -1)).toBeNull();
    expect(stepTab(play, done, "p1", 1)).toEqual({ side: "play", index: 1 });
    expect(stepTab(play, done, "p2", 1)).toEqual({ side: "done", index: 0 });
    expect(stepTab(play, done, "d2", -1)).toEqual({ side: "play", index: 2 });
    expect(stepTab(play, done, "d1", 1)).toBeNull();
  });
});

describe("the arrangement store", () => {
  it("keeps a side only when it differs from the island's own choice", () => {
    placeThread("thread-a", "a", "play", ["thread-a"], "done");
    expect(stored().sides).toEqual({ "thread-a": { side: "play", runId: "a" } });
    expect(stored().order.play).toEqual(["thread-a"]);
    placeThread("thread-a", "a", "done", ["thread-a", "thread-b"], "done");
    expect(stored().sides).toEqual({});
    expect(stored().order).toEqual({ play: [], done: ["thread-a", "thread-b"] });
  });

  it("forgets a dismissed thread", () => {
    placeThread("thread-a", "a", "play", ["thread-a", "thread-x"], "done");
    forgetThread("thread-a");
    expect(stored()).toEqual({ ...EMPTY_ARRANGEMENT, order: { play: ["thread-x"], done: [] } });
  });
});
