import { describe, expect, it, vi } from "vitest";
import { CaptionScheduler, parseCaptionReply, type CaptionEvent, type CaptionTimers } from "../captions";
import { SUMMARY_MARKER, compactionCut, createCompactor, estimateTokens } from "../compaction";
import type { ModelCaller } from "../loop";
import { MemoryBackend } from "../memory-backend";
import { DEFAULT_PERMISSION_PREFS } from "../permissions";
import { SPECTRA_SYSTEM_PROMPT, buildSystemPrompt, environmentBlock } from "../prompt";
import { runHarness, type HarnessEvent, type RunCheckpoint } from "../run";
import type { HarnessMessage, ModelTurn } from "../types";

function fakeTimers(): CaptionTimers & { advance: (ms: number) => Promise<void> } {
  let time = 0;
  let timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let next = 1;
  return {
    now: () => time,
    setTimeout: (fn, ms) => {
      const id = next++;
      timers.push({ at: time + ms, fn, id });
      return id;
    },
    clearTimeout: (handle) => {
      timers = timers.filter((timer) => timer.id !== handle);
    },
    advance: async (ms) => {
      time += ms;
      const due = timers.filter((timer) => timer.at <= time);
      timers = timers.filter((timer) => timer.at > time);
      for (const timer of due) timer.fn();
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    },
  };
}

describe("captions", () => {
  it("writes nothing for a run under two seconds, but still names the thread", async () => {
    const timers = fakeTimers();
    const captions: CaptionEvent[] = [];
    const titles: string[] = [];
    const write = vi.fn(async () => ({ caption: "Saying hello", title: "Greeting" }));
    const scheduler = new CaptionScheduler({ prompt: "hello", write, wantTitle: true, timers, onCaption: (c) => captions.push(c), onTitle: (t) => titles.push(t) });
    await timers.advance(800);
    await scheduler.finish();
    expect(captions).toEqual([]);
    expect(titles).toEqual(["Greeting"]);
  });

  it("captions steps after two seconds, at most every 2.5 s, and ends in the past tense", async () => {
    const timers = fakeTimers();
    const captions: CaptionEvent[] = [];
    const write = vi.fn(async (request: { final: boolean; steps: unknown[] }) => ({
      caption: request.final ? "Made a deck" : `Working on ${request.steps.length}`,
    }));
    const scheduler = new CaptionScheduler({ prompt: "deck", write, timers, onCaption: (c) => captions.push(c) });
    scheduler.stepStarted({ id: "a", label: "Reading *Notes*" });
    await timers.advance(1_000);
    expect(write).not.toHaveBeenCalled();
    await timers.advance(1_000);
    expect(captions.map((c) => c.text)).toEqual(["Working on 1"]);
    scheduler.stepStarted({ id: "b", label: "Creating *Deck*" });
    await timers.advance(1_000);
    expect(captions).toHaveLength(1);
    await timers.advance(1_500);
    expect(captions.map((c) => c.text)).toEqual(["Working on 1", "Working on 2"]);
    expect(captions[1]!.stepIds).toEqual(["b"]);
    await scheduler.finish();
    expect(captions.at(-1)).toMatchObject({ text: "Made a deck", final: true });
  });

  it("falls back to the step label when the caption call fails", async () => {
    const timers = fakeTimers();
    const captions: CaptionEvent[] = [];
    const scheduler = new CaptionScheduler({
      prompt: "x",
      write: async () => {
        throw new Error("down");
      },
      timers,
      onCaption: (c) => captions.push(c),
    });
    scheduler.stepStarted({ id: "a", label: "Reading *Notes*" });
    await timers.advance(2_000);
    await Promise.resolve();
    expect(captions).toEqual([{ text: "Reading Notes", final: false, stepIds: ["a"], fallback: true }]);
  });

  it("parses the caption reply and strips ids", () => {
    expect(parseCaptionReply('{"caption":"Editing wx123456789 notes.","detail":"Line","thread_title":"Notes"}')).toEqual({
      caption: "Editing notes",
      detail: "Line",
      title: "Notes",
    });
    expect(parseCaptionReply("Reading your notes")).toEqual({ caption: "Reading your notes" });
  });
});

describe("compaction", () => {
  const big = (n: number): HarnessMessage[] =>
    Array.from({ length: n }, (_, i) =>
      i % 3 === 0
        ? ({ role: "user", content: `request ${i} ${"x".repeat(700)}` } as HarnessMessage)
        : i % 3 === 1
          ? ({ role: "assistant", content: "", tool_calls: [{ id: `c${i}`, type: "function", function: { name: "read_artifact", arguments: "{}" } }] } as HarnessMessage)
          : ({ role: "tool", tool_call_id: `c${i - 1}`, content: "y".repeat(700) } as HarnessMessage),
    );

  it("never starts the verbatim tail on a tool result and keeps the last request", () => {
    const messages = big(30);
    for (const keep of [50, 300, 900, 2_000]) {
      const cut = compactionCut(messages, keep);
      expect(messages[cut]?.role).not.toBe("tool");
      expect(cut).toBeLessThanOrEqual(27);
    }
  });

  it("summarises older turns past 80% of the window and keeps recent turns verbatim", async () => {
    const messages = big(30);
    const tokens = estimateTokens(messages);
    const summarise = vi.fn(async (_input: { transcript: string; signal: AbortSignal }) => "## What the user wants\nStuff");
    const compact = createCompactor({ contextWindow: Math.floor(tokens / 0.85), summarise });
    const result = await compact({ system: { role: "system", content: "s" }, messages, signal: new AbortController().signal });
    expect(result).not.toBeNull();
    expect(result!.messages[0]).toEqual({ role: "user", content: `${SUMMARY_MARKER}\n## What the user wants\nStuff` });
    expect(result!.messages.at(-1)).toBe(messages.at(-1));
    expect(result!.messages.length).toBeLessThan(messages.length);
    expect(summarise.mock.calls[0]![0].transcript).toMatch(/USER: request 0/);
    const quiet = createCompactor({ contextWindow: tokens * 4, summarise });
    expect(await quiet({ system: { role: "system", content: "s" }, messages, signal: new AbortController().signal })).toBeNull();
  });
});

describe("system prompt", () => {
  it("is under 1,500 words and carries the skill index and environment", () => {
    expect(SPECTRA_SYSTEM_PROMPT.split(/\s+/).length).toBeLessThan(1_500);
    const prompt = buildSystemPrompt({
      now: Date.UTC(2026, 9, 3, 10),
      timeZone: "Europe/Madrid",
      user: { name: "Ana", role: "student", subjects: ["Biology HL"] },
      page: "Editing document \"Cells\"",
      open: [{ id: "wx1", type: "document", title: "Cells" }],
      selection: { text: "mitochondria", in: { id: "wx1", type: "document", title: "Cells" } },
      references: [{ id: "th1", type: "thread", title: "Exam plan" }],
      bridge: "online (Ana's laptop)",
      permissions: "Changes that cannot be undone and settings changes ask the user first.",
    });
    expect(prompt).toMatch(/- presentation: Slide decks/);
    expect(prompt).toMatch(/Saturday, 3 October 2026/);
    expect(prompt).not.toMatch(/propose_operation|submit_plan/);
  });

  it("names what is open and pointed at with ids, types and titles only", () => {
    const block = environmentBlock({
      now: Date.UTC(2026, 9, 3, 10),
      timeZone: "Europe/Madrid",
      page: "Editing document \"Cells\"",
      open: [
        { id: "wx1", type: "document", title: "Cells" },
        { id: "wx2", type: "presentation", title: "Mitosis" },
      ],
      selection: { text: "the inner membrane", in: { id: "wx1", type: "document", title: "Cells" } },
      references: [{ id: "th1", type: "thread", title: "Exam plan" }],
      bridge: "online (Ana's laptop)",
      permissions: "Ask first.",
    });
    expect(block).toContain('Open: document "Cells" (id wx1); presentation "Mitosis" (id wx2)');
    expect(block).toContain('Selection in document "Cells" (id wx1): "the inner membrane"');
    expect(block).toContain('Referenced with @: thread "Exam plan" (id th1)');
    expect(block).toContain("Spectra Bridge: online (Ana's laptop)");
    expect(block).not.toMatch(/Outline|Focused/);
  });

  it("tells the model to search and read instead of expecting content", () => {
    expect(SPECTRA_SYSTEM_PROMPT).toMatch(/never its content/);
    expect(SPECTRA_SYSTEM_PROMPT).toMatch(/search for what a request is about and read it/);
    expect(SPECTRA_SYSTEM_PROMPT).not.toMatch(/focused artifact with its outline/);
  });
});

describe("runHarness", () => {
  function model(turns: ModelTurn[]): ModelCaller {
    let index = 0;
    return async ({ onText }) => {
      const turn = turns[Math.min(index++, turns.length - 1)]!;
      if (turn.text) onText(turn.text);
      return turn;
    };
  }

  it("streams, records the artifact, checkpoints per tool and survives bookkeeping failures", async () => {
    const backend = new MemoryBackend();
    const events: HarnessEvent[] = [];
    const checkpoints: RunCheckpoint["status"][] = [];
    let failNext = true;
    const result = await runHarness({
      runId: "r1",
      backend,
      signal: new AbortController().signal,
      prompt: "Make notes on mitosis",
      environment: { now: 0 },
      permissions: DEFAULT_PERMISSION_PREFS,
      captionWriter: null,
      compactor: null,
      callModel: model([
        {
          text: "",
          toolCalls: [{ id: "t1", name: "create_artifact", arguments: JSON.stringify({ type: "document", title: "Mitosis", content: { markdown: "# Mitosis\n\nCells divide in four phases." } }) }],
        },
        { text: "Made your notes on mitosis.", toolCalls: [] },
      ]),
      sink: {
        emit: (event) => events.push(event),
        checkpoint: async ({ status }) => {
          checkpoints.push(status);
          if (failNext) {
            failNext = false;
            throw new Error("Convex is down");
          }
        },
      },
    });
    expect(result.status).toBe("completed");
    expect(result.state.text).toBe("Made your notes on mitosis.");
    expect(events.map((event) => event.type)).toEqual(["step_start", "step_end", "artifact", "text"]);
    expect(events[2]).toMatchObject({ type: "artifact", artifact: { title: "Mitosis", action: "created" } });
    expect(checkpoints.at(-1)).toBe("completed");
    expect([...backend.artifacts.values()]).toHaveLength(1);
  });

  it("binds history to this thread and puts the new message last", async () => {
    let seen: HarnessMessage[] = [];
    await runHarness({
      runId: "r2",
      backend: new MemoryBackend(),
      signal: new AbortController().signal,
      prompt: "And now?",
      history: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
      ],
      environment: { now: 0 },
      permissions: DEFAULT_PERMISSION_PREFS,
      captionWriter: null,
      compactor: null,
      callModel: async ({ messages }) => {
        seen = messages;
        return { text: "ok", toolCalls: [] };
      },
      sink: { emit: () => undefined, checkpoint: async () => undefined },
    });
    expect(seen.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(seen.at(-1)).toEqual({ role: "user", content: "And now?" });
  });
});
