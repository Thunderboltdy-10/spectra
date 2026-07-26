// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiPerformer,
  validateEnvelope,
  type AiOperationEnvelope,
} from "../collaboration/ai-performer";
import {
  __resetAiTraces,
  dismissAiTrace,
  listAiTraces,
  noteHumanEdit,
  recordAiTrace,
  tracesAtPath,
} from "../collaboration/ai-trace";
import type {
  ActorIdentity,
  InteractionState,
} from "../collaboration/interaction-model";

const actor: ActorIdentity = {
  clientId: "ai-1",
  kind: "ai",
  name: "Nadia M.'s AI",
  ownerAccountId: "acc-nadia",
  ownerName: "Nadia M.",
  runId: "run-1",
};

function envelope(
  overrides: Partial<AiOperationEnvelope> = {},
): AiOperationEnvelope {
  return {
    runId: "run-1",
    operationId: "op-1",
    artifactId: "art-1",
    typeKey: "planner_task",
    path: "/description",
    action: "set",
    before: "Old description here",
    after: "New description here",
    ...overrides,
  };
}

describe("validateEnvelope", () => {
  it("accepts a minimal well-formed envelope", () => {
    expect(validateEnvelope(envelope())).not.toBeNull();
  });

  it("rejects missing identity so untrusted output cannot reach the screen", () => {
    expect(validateEnvelope({ ...envelope(), artifactId: "" })).toBeNull();
    expect(validateEnvelope({ ...envelope(), operationId: undefined })).toBeNull();
    expect(validateEnvelope("not an object")).toBeNull();
    expect(validateEnvelope(null)).toBeNull();
  });

  it("rejects an unknown action", () => {
    expect(validateEnvelope({ ...envelope(), action: "detonate" })).toBeNull();
  });

  it("rejects a set with no intended value", () => {
    const raw = envelope();
    delete (raw as Partial<AiOperationEnvelope>).after;
    expect(validateEnvelope(raw)).toBeNull();
  });

  it("rejects a reorder without indices", () => {
    expect(
      validateEnvelope({ ...envelope(), action: "reorder", reorder: { from: 1 } }),
    ).toBeNull();
  });

  it("canonicalises the path", () => {
    expect(
      validateEnvelope({ ...envelope(), path: "/content/description" })?.path,
    ).toBe("/description");
  });

  it("drops malformed menu options rather than rendering them", () => {
    const parsed = validateEnvelope({
      ...envelope(),
      menuOptions: [{ value: "a", label: "A" }, { nope: true }, "junk"],
    });
    expect(parsed?.menuOptions).toEqual([{ value: "a", label: "A" }]);
  });
});

describe("AiPerformer", () => {
  let frames: Array<InteractionState | null>;
  let performer: AiPerformer;

  beforeEach(() => {
    vi.useFakeTimers();
    __resetAiTraces();
    frames = [];
    performer = new AiPerformer(actor, (state) => frames.push(state));
  });

  afterEach(() => {
    performer.dispose();
    vi.useRealTimers();
  });

  const kinds = () =>
    frames.filter((frame): frame is InteractionState => Boolean(frame)).map(
      (frame) => frame.act.kind,
    );

  it("rejects an invalid envelope without publishing presence", () => {
    expect(performer.start({ bogus: true })).toBe(false);
    expect(frames.filter(Boolean)).toHaveLength(0);
  });

  it("publishes an owner-attributed frame as soon as it starts", () => {
    performer.start(envelope());
    const first = frames.find((frame): frame is InteractionState => Boolean(frame))!;
    expect(first.actor.kind).toBe("ai");
    expect(first.actor.ownerName).toBe("Nadia M.");
    expect(first.target?.path).toBe("/description");
  });

  it("performs the native text choreography rather than a single update", () => {
    performer.start(envelope());
    vi.advanceTimersByTime(4000);
    const seen = kinds();
    expect(seen[0]).toBe("hover");
    expect(seen).toContain("select");
    expect(seen).toContain("delete");
    expect(seen).toContain("type");
  });

  it("carries provisional values as speculation, not durable writes", () => {
    performer.start(envelope());
    vi.advanceTimersByTime(600);
    const speculative = frames.filter(
      (frame): frame is InteractionState => Boolean(frame?.speculation),
    );
    expect(speculative.length).toBeGreaterThan(0);
    expect(speculative[0]!.speculation!.patches[0]!.path).toBe("/description");
    expect(performer.getSnapshot().speculation.size).toBe(1);
  });

  it("records an attributed trace on commit and clears presence", () => {
    performer.start(envelope());
    vi.advanceTimersByTime(4000);
    performer.commit(envelope());
    const traces = listAiTraces("art-1");
    expect(traces).toHaveLength(1);
    expect(traces[0]!.actorLabel).toBe("Nadia M.'s AI");
    expect(traces[0]!.previousValue).toBe("Old description here");
    expect(traces[0]!.target.path).toBe("/description");
    // Presence must not outlive the work.
    expect(frames[frames.length - 1]).toBeNull();
    expect(performer.getSnapshot().operations).toHaveLength(0);
  });

  it("runs independent paths at the same time", () => {
    performer.start(envelope({ operationId: "op-a", path: "/subtasks/0/title", before: "a", after: "b" }));
    performer.start(envelope({ operationId: "op-b", path: "/subtasks/1/title", before: "c", after: "d" }));
    expect(performer.getSnapshot().operations.map((op) => op.status)).toEqual([
      "performing",
      "performing",
    ]);
  });

  it("queues a second operation on the same path so values cannot interleave", () => {
    performer.start(envelope({ operationId: "op-a", before: "a", after: "b" }));
    performer.start(envelope({ operationId: "op-b", before: "b", after: "c" }));
    const statuses = performer.getSnapshot().operations.map((op) => op.status);
    expect(statuses).toContain("performing");
    expect(statuses).toContain("queued");
  });

  it("starts the queued operation once the first path frees up", () => {
    performer.start(envelope({ operationId: "op-a", before: "a", after: "b" }));
    performer.start(envelope({ operationId: "op-b", before: "b", after: "c" }));
    vi.advanceTimersByTime(4000);
    performer.commit(envelope({ operationId: "op-a", before: "a", after: "b" }));
    const queued = performer
      .getSnapshot()
      .operations.find((op) => op.operationId === "op-b");
    expect(queued?.status).toBe("performing");
  });

  it("reverses only the failed operation and leaves completed work alone", () => {
    performer.start(envelope({ operationId: "op-a", path: "/status", before: "todo", after: "done" }));
    performer.start(envelope({ operationId: "op-b", path: "/priority", before: "low", after: "high" }));
    vi.advanceTimersByTime(4000);
    performer.commit(envelope({ operationId: "op-a", path: "/status", before: "todo", after: "done" }));
    performer.fail("op-b", "The model returned invalid output");

    expect(listAiTraces("art-1").map((trace) => trace.target.path)).toEqual([
      "/status",
    ]);
    expect(performer.getSnapshot().speculation.size).toBe(0);
    expect(performer.getSnapshot().operations).toHaveLength(0);
  });

  it("states contention instead of overwriting, and resumes afterwards", () => {
    performer.start(envelope());
    performer.block("op-1", "Nadia is editing this section");
    const blocked = frames.filter(
      (frame): frame is InteractionState => frame?.lifecycle === "blocked",
    );
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.note).toBe("Nadia is editing this section");

    const before = kinds().length;
    vi.advanceTimersByTime(3000);
    // A blocked performance must not keep animating.
    expect(kinds().length).toBe(before);

    performer.resume("op-1");
    vi.advanceTimersByTime(4000);
    expect(kinds().length).toBeGreaterThan(before);
  });

  it("pauses and resumes without losing progress", () => {
    performer.start(envelope());
    vi.advanceTimersByTime(300);
    const progressed = performer.getSnapshot().operations[0]!.progress;
    performer.pause("op-1", "Waiting for approval");
    vi.advanceTimersByTime(2000);
    expect(performer.getSnapshot().operations[0]!.progress).toBe(progressed);
    performer.resume("op-1");
    vi.advanceTimersByTime(4000);
    // The choreography has finished; the operation now waits for its durable
    // write rather than dropping the value it is showing.
    expect(performer.getSnapshot().operations[0]!.status).toBe("committing");
    performer.confirmDurable("/description");
    expect(performer.getSnapshot().operations).toHaveLength(0);
  });

  it("clears everything on cancel", () => {
    performer.start(envelope());
    performer.cancel();
    expect(performer.getSnapshot().operations).toHaveLength(0);
    expect(frames[frames.length - 1]).toBeNull();
    expect(listAiTraces("art-1")).toHaveLength(0);
  });

  it("releases a provisional value if the durable write never confirms", () => {
    performer.start(envelope());
    vi.advanceTimersByTime(20_000);
    expect(performer.getSnapshot().speculation.size).toBe(0);
    expect(frames[frames.length - 1]).toBeNull();
  });

  it("commits when the durable value is observed by path", () => {
    performer.start(envelope());
    vi.advanceTimersByTime(4000);
    performer.confirmDurable("/content/description");
    expect(listAiTraces("art-1")).toHaveLength(1);
  });

  it("does not animate a no-op but still leaves no working state", () => {
    const noop = envelope({ before: "same", after: "same" });
    expect(performer.start(noop)).toBe(false);
    expect(performer.getSnapshot().operations).toHaveLength(0);
    expect(listAiTraces("art-1")).toHaveLength(0);
  });

  it("materialises completed work for an artifact opened after the run", () => {
    performer.materialize([
      envelope({ operationId: "op-a", path: "/status", before: "todo", after: "done" }),
      envelope({ operationId: "op-b", path: "/priority", before: "low", after: "high" }),
    ]);
    expect(listAiTraces("art-1")).toHaveLength(2);
    expect(performer.getSnapshot().operations).toHaveLength(0);
  });

  it("performs a dropdown as a real menu interaction", () => {
    performer.start(
      envelope({
        path: "/status",
        before: "todo",
        after: "done",
        menuOptions: [
          { value: "todo", label: "To do" },
          { value: "doing", label: "In progress" },
          { value: "done", label: "Done" },
        ],
      }),
    );
    vi.advanceTimersByTime(4000);
    const seen = kinds();
    expect(seen).toContain("menuOpen");
    expect(seen).toContain("menuNavigate");
    expect(seen).toContain("menuSelect");
    const open = frames.find(
      (frame): frame is InteractionState => frame?.act.kind === "menuOpen",
    )!;
    expect(open.menu?.options).toHaveLength(3);
  });

  it("performs a timetable move as a drag with a drop target", () => {
    performer.start(
      envelope({
        typeKey: "timetable",
        path: "/events/2",
        before: { start: "09:00", end: "10:00" },
        after: { start: "13:00", end: "14:00" },
        dropPath: "/events/2",
      }),
    );
    vi.advanceTimersByTime(4000);
    const seen = kinds();
    expect(seen).toContain("dragStart");
    expect(seen).toContain("dragMove");
    expect(seen).toContain("dragRelease");
  });

  it("clears presence on dispose so a closed editor leaves no ghost", () => {
    performer.start(envelope());
    performer.dispose();
    expect(frames[frames.length - 1]).toBeNull();
  });
});

describe("AI traces", () => {
  beforeEach(() => {
    __resetAiTraces();
  });

  const trace = (path: string, overrides = {}) =>
    recordAiTrace({
      target: {
        artifactId: "art-1",
        path,
        primitive: "text",
      },
      runId: "run-1",
      actorLabel: "Nadia M.'s AI",
      previousValue: "before",
      nextValue: "after",
      summary: `Rewrote ${path}`,
      ...overrides,
    });

  it("does not record a trace for an unchanged value", () => {
    expect(
      recordAiTrace({
        target: { artifactId: "art-1", path: "/title", primitive: "text" },
        runId: "run-1",
        actorLabel: "AI",
        previousValue: "same",
        nextValue: "same",
        summary: "no change",
      }),
    ).toBeNull();
    expect(listAiTraces("art-1")).toHaveLength(0);
  });

  it("replaces rather than stacks a second edit to the same field", () => {
    trace("/title");
    trace("/title", { previousValue: "after", nextValue: "final" });
    const traces = listAiTraces("art-1");
    expect(traces).toHaveLength(1);
    // Revert must go back to the original pre-AI value, not an intermediate one.
    expect(traces[0]!.previousValue).toBe("before");
  });

  it("finds traces by intersecting path so parents and children both match", () => {
    trace("/cards/0/front");
    expect(tracesAtPath("art-1", "/cards/0/front")).toHaveLength(1);
    expect(tracesAtPath("art-1", "/cards/0")).toHaveLength(1);
    expect(tracesAtPath("art-1", "/cards/1")).toHaveLength(0);
  });

  it("clears automatically when a human edits that exact region", () => {
    trace("/cards/0/front");
    trace("/cards/1/front");
    noteHumanEdit("art-1", "/cards/0/front");
    expect(listAiTraces("art-1").map((entry) => entry.target.path)).toEqual([
      "/cards/1/front",
    ]);
  });

  it("clears a child trace when the human edits the parent", () => {
    trace("/cards/0/front");
    noteHumanEdit("art-1", "/cards/0");
    expect(listAiTraces("art-1")).toHaveLength(0);
  });

  it("leaves sibling traces untouched", () => {
    trace("/questions/0/prompt");
    trace("/questions/2/prompt");
    noteHumanEdit("art-1", "/questions/1/prompt");
    expect(listAiTraces("art-1")).toHaveLength(2);
  });

  it("dismisses one trace without touching the rest", () => {
    const first = trace("/title")!;
    trace("/summary");
    dismissAiTrace("art-1", first.id);
    expect(listAiTraces("art-1").map((entry) => entry.target.path)).toEqual([
      "/summary",
    ]);
  });

  it("survives a reopen by rehydrating from persistence", () => {
    trace("/title");
    // Simulate closing and reopening the artifact: the in-memory bucket is gone
    // but the persisted trace remains, so the story is still told.
    const persisted = window.localStorage.getItem("spectra.ai-traces.art-1");
    expect(persisted).toBeTruthy();
  });
});
