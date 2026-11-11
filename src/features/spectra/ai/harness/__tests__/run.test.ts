import { describe, expect, it, vi } from "vitest";
import {
  SUMMARY_MARKER,
  THREAD_FOLD_AT,
  THREAD_KEEP_MESSAGES,
  compactionCut,
  createCompactor,
  estimateTokens,
  threadFold,
  threadFoldTranscript,
} from "../compaction";
import type { ModelCaller } from "../loop";
import { MemoryBackend } from "../memory-backend";
import { DEFAULT_PERMISSION_PREFS } from "../permissions";
import { SPECTRA_SYSTEM_PROMPT, buildSystemPrompt, environmentBlock } from "../prompt";
import { runHarness, type HarnessEvent, type RunCheckpoint } from "../run";
import type { HarnessMessage, ModelTurn } from "../types";

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

describe("thread notes", () => {
  it("fold the oldest messages of a long thread and carry the notes so far forward", () => {
    const messages = Array.from({ length: THREAD_FOLD_AT }, (_, index) => ({
      role: (index % 2 ? "assistant" : "user") as "user" | "assistant",
      content: `turn ${index}`,
      createdAt: 100 + index,
    }));
    expect(threadFold(messages)).toBeNull();
    const longer = [...messages, { role: "user" as const, content: "latest", createdAt: 999 }];
    const fold = threadFold(longer)!;
    expect(fold.older).toHaveLength(longer.length - THREAD_KEEP_MESSAGES);
    expect(fold.through).toBe(fold.older.at(-1)!.createdAt);
    const transcript = threadFoldTranscript("## Done so far\nA deck on cells (id d1).", fold.older);
    expect(transcript.startsWith("NOTES SO FAR:\n## Done so far")).toBe(true);
    expect(transcript).toMatch(/USER: turn 0/);
    expect(transcript).not.toMatch(/latest/);
  });
});

describe("system prompt", () => {
  it("is under 1,900 words and carries the skill index and environment", () => {
    expect(SPECTRA_SYSTEM_PROMPT.split(/\s+/).length).toBeLessThan(1900);
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
    expect(SPECTRA_SYSTEM_PROMPT).toMatch(/Otherwise search: it covers every workspace and class/);
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
      titleWriter: null,
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

  it("never shows loading a skill as a step", async () => {
    const events: HarnessEvent[] = [];
    const result = await runHarness({
      runId: "r-skill",
      backend: new MemoryBackend(),
      signal: new AbortController().signal,
      prompt: "Make a deck on cells",
      environment: { now: 0 },
      permissions: DEFAULT_PERMISSION_PREFS,
      titleWriter: null,
      compactor: null,
      callModel: model([
        { text: "", toolCalls: [{ id: "s1", name: "load_skill", arguments: JSON.stringify({ name: "presentation" }) }] },
        { text: "Here is the plan.", toolCalls: [] },
      ]),
      sink: { emit: (event) => events.push(event), checkpoint: async () => undefined },
    });
    expect(result.status).toBe("completed");
    expect(events.map((event) => event.type)).toEqual(["text"]);
    expect(JSON.stringify(events)).not.toMatch(/Getting ready|skill/i);
  });

  it("names the thread of a run that asks a question in its first turn", async () => {
    const events: HarnessEvent[] = [];
    const runtime = { provider: "codex", model: "gpt-6-luna", accountId: "selected-owner" };
    const titleWriter = vi.fn(async () => ({ title: "Biology unit plan" }));
    const result = await runHarness({
      runId: "r-ask",
      backend: new MemoryBackend(),
      signal: new AbortController().signal,
      prompt: "Plan my biology unit",
      environment: { now: 0 },
      permissions: DEFAULT_PERMISSION_PREFS,
      wantTitle: true,
      titleWriter,
      runtime,
      compactor: null,
      callModel: model([
        { text: "", toolCalls: [{ id: "q1", name: "ask_user", arguments: JSON.stringify({ question: "Which unit?" }) }] },
      ]),
      sink: { emit: (event) => events.push(event), checkpoint: async () => undefined },
    });
    expect(result.status).toBe("paused");
    await result.titling;
    expect(titleWriter).toHaveBeenCalledWith(expect.objectContaining({ runtime }), expect.any(AbortSignal));
    expect(events.filter((event) => event.type === "thread_title")).toEqual([{ type: "thread_title", title: "Biology unit plan" }]);
  });

  it("names a thread from the artifact in focus, apart from the other conversations", async () => {
    const titleWriter = vi.fn(async () => ({ title: "Physics progress summary" }));
    const result = await runHarness({
      runId: "r-focus",
      backend: new MemoryBackend(),
      signal: new AbortController().signal,
      prompt: "Summarise this document",
      environment: { now: 0, open: [{ id: "a1", type: "document", title: "Physics progress" }] },
      permissions: DEFAULT_PERMISSION_PREFS,
      wantTitle: true,
      titleWriter,
      otherThreadTitles: async () => ["Document summary request", "Summarize a document"],
      compactor: null,
      callModel: model([{ text: "Here it is.", toolCalls: [] }]),
      sink: { emit: () => undefined, checkpoint: async () => undefined },
    });
    await result.titling;
    expect(titleWriter).toHaveBeenCalledWith(
      expect.objectContaining({ focus: "Physics progress", others: ["Document summary request", "Summarize a document"] }),
      expect.any(AbortSignal),
    );
  });

  it("still names the thread when the other titles cannot be read", async () => {
    const titleWriter = vi.fn(async () => ({ title: "Cells" }));
    const result = await runHarness({
      runId: "r-noothers",
      backend: new MemoryBackend(),
      signal: new AbortController().signal,
      prompt: "Cells",
      environment: { now: 0 },
      permissions: DEFAULT_PERMISSION_PREFS,
      wantTitle: true,
      titleWriter,
      otherThreadTitles: async () => { throw new Error("offline"); },
      compactor: null,
      callModel: model([{ text: "Sure.", toolCalls: [] }]),
      sink: { emit: () => undefined, checkpoint: async () => undefined },
    });
    await result.titling;
    expect(titleWriter).toHaveBeenCalledWith(expect.not.objectContaining({ others: expect.anything() }), expect.any(AbortSignal));
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
      titleWriter: null,
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
