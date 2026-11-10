import { describe, expect, it, vi } from "vitest";
import {
  emptyLoopState,
  runHarnessLoop,
  type LoopDeps,
  type ModelCaller,
} from "../loop";
import {
  ProviderUnavailableError,
  type AnyHarnessTool,
  type HarnessMessage,
  type ModelTurn,
} from "../types";

type Script = Array<ModelTurn | ((messages: HarnessMessage[]) => ModelTurn)>;

function scripted(script: Script) {
  const seen: HarnessMessage[][] = [];
  const choices: string[] = [];
  let index = 0;
  const caller: ModelCaller = async ({ messages, onText, toolChoice }) => {
    seen.push(messages);
    choices.push(toolChoice);
    const step = script[Math.min(index, script.length - 1)]!;
    index += 1;
    const turn = typeof step === "function" ? step(messages) : step;
    if (turn.text) onText(turn.text);
    return turn;
  };
  return { caller, seen, choices, count: () => index };
}

function call(id: string, name: string, args: Record<string, unknown> = {}) {
  return { id, name, arguments: JSON.stringify(args) };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function tool(partial: Partial<AnyHarnessTool> & { name: string }): AnyHarnessTool {
  return {
    description: partial.name,
    parameters: { type: "object", properties: {} },
    effect: "read",
    label: () => partial.name,
    execute: async () => ({ ok: true, content: "ok" }),
    ...partial,
  };
}

function deps(overrides: Partial<LoopDeps> & Pick<LoopDeps, "callModel" | "tools">): LoopDeps {
  return {
    systemPrompt: "You are Spectra.",
    policy: () => "ask",
    runId: "run_1",
    signal: new AbortController().signal,
    ...overrides,
  };
}

const user = (content: string): HarnessMessage => ({ role: "user", content });

describe("runHarnessLoop", () => {
  it("returns a rejected argument error without exposing unparsed input to presentation hooks", async () => {
    const command = tool({
      name: "command",
      parse: () => { throw new Error("Unknown command"); },
      shows: (args: { work: { id: string } }) => args.work.id,
    });
    const model = scripted([
      { text: "", toolCalls: [call("invalid", "command", { id: "missing" })] },
      (messages) => {
        expect(messages.at(-1)).toEqual({ role: "tool", tool_call_id: "invalid", content: "command: Unknown command" });
        return { text: "I can try another command.", toolCalls: [] };
      },
    ]);
    const outcome = await runHarnessLoop(emptyLoopState([user("go")]), deps({
      callModel: model.caller,
      tools: [command],
      hooks: { onToolStart: (step) => { if (step.args) step.tool?.shows?.(step.args); } },
    }));
    expect(outcome.status).toBe("completed");
  });

  it("answers in one model call when no tools are needed", async () => {
    const model = scripted([{ text: "Hello! What are you working on?", toolCalls: [] }]);
    const texts: string[] = [];
    const outcome = await runHarnessLoop(
      emptyLoopState([user("hello")]),
      deps({ callModel: model.caller, tools: [], hooks: { onText: (d) => texts.push(d) } }),
    );
    expect(outcome.status).toBe("completed");
    expect(model.count()).toBe(1);
    expect(outcome.state.text).toBe("Hello! What are you working on?");
    expect(texts.join("")).toBe(outcome.state.text);
    expect(model.seen[0]![0]).toEqual({ role: "system", content: "You are Spectra." });
  });

  it("runs independent calls in parallel and keeps results in call order", async () => {
    const gate = deferred();
    const started: string[] = [];
    const slow = tool({
      name: "slow",
      execute: async () => {
        started.push("slow");
        await gate.promise;
        return { ok: true, content: "slow done" };
      },
    });
    const fast = tool({
      name: "fast",
      execute: async () => {
        started.push("fast");
        gate.resolve();
        return { ok: true, content: "fast done" };
      },
    });
    const model = scripted([
      { text: "", toolCalls: [call("a", "slow"), call("b", "fast")] },
      { text: "Both done.", toolCalls: [] },
    ]);
    const outcome = await runHarnessLoop(
      emptyLoopState([user("go")]),
      deps({ callModel: model.caller, tools: [slow, fast] }),
    );
    expect(outcome.status).toBe("completed");
    // fast had to start while slow was waiting, or the gate would never open.
    expect(started).toEqual(["slow", "fast"]);
    const tools = outcome.state.messages.filter((m) => m.role === "tool");
    expect(tools.map((m) => (m as { content: string }).content)).toEqual(["slow done", "fast done"]);
  });

  it("runs writes to the same artifact in order", async () => {
    const order: string[] = [];
    const edit = tool({
      name: "edit",
      effect: "write",
      targets: (args) => [String(args.id)],
      execute: async (args) => {
        order.push(`start ${args.step}`);
        await new Promise((resolve) => setTimeout(resolve, args.step === 1 ? 20 : 1));
        order.push(`end ${args.step}`);
        return { ok: true, content: `step ${args.step}` };
      },
    });
    const model = scripted([
      {
        text: "",
        toolCalls: [call("a", "edit", { id: "doc", step: 1 }), call("b", "edit", { id: "doc", step: 2 })],
      },
      { text: "Done.", toolCalls: [] },
    ]);
    await runHarnessLoop(emptyLoopState([user("edit")]), deps({ callModel: model.caller, tools: [edit] }));
    expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"]);
  });

  it("serializes an exclusive reversal between independent writes", async () => {
    const order: string[] = [];
    const edit = tool({ name: "edit", execute: async (args) => {
      order.push(`start ${args.step}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end ${args.step}`);
      return { ok: true, content: "saved" };
    } });
    const undo = tool({ name: "undo", exclusive: true, execute: async () => {
      order.push("undo");
      return { ok: true, content: "undone" };
    } });
    const model = scripted([{ text: "", toolCalls: [call("a", "edit", { step: 1 }), call("b", "undo"), call("c", "edit", { step: 2 })] }, { text: "Done", toolCalls: [] }]);
    await runHarnessLoop(emptyLoopState([user("undo")]), deps({ callModel: model.caller, tools: [edit, undo] }));
    expect(order).toEqual(["start 1", "end 1", "undo", "start 2", "end 2"]);
  });

  it("holds following writes behind a paused reversal and preserves its approval scope on resume", async () => {
    const edit = vi.fn(async () => ({ ok: true, content: "saved" }));
    const undo = tool({ name: "undo", exclusive: true, execute: async (_args, ctx) => {
      if (!ctx.approved) return { ok: false, content: "", pause: { kind: "approval", category: "bridge_files", question: "Undo desktop changes?", approvalScope: "previous:attempt-1" } };
      expect(ctx.approvalScope).toBe("previous:attempt-1");
      expect(edit).not.toHaveBeenCalled();
      return { ok: true, content: "undone" };
    } });
    const model = scripted([{ text: "", toolCalls: [call("a", "undo"), call("b", "edit")] }, { text: "Done", toolCalls: [] }]);
    const options = deps({ callModel: model.caller, tools: [undo, tool({ name: "edit", execute: edit })] });
    const paused = await runHarnessLoop(emptyLoopState([user("undo")]), options);
    expect(paused.status).toBe("paused");
    expect(edit).not.toHaveBeenCalled();
    const resumed = await runHarnessLoop(JSON.parse(JSON.stringify(paused.state)), options, { kind: "approval", allowed: true });
    expect(resumed.status).toBe("completed");
    expect(edit).toHaveBeenCalledOnce();
  });

  it("does not run a reversal ahead of an earlier deferred write", async () => {
    const order: string[] = [];
    const edit = tool({ name: "edit", effect: "settings", category: () => "settings", execute: async () => { order.push("edit"); return { ok: true, content: "saved" }; } });
    const undo = tool({ name: "undo", exclusive: true, execute: async () => { order.push("undo"); return { ok: true, content: "undone" }; } });
    const model = scripted([{ text: "", toolCalls: [call("a", "edit"), call("b", "undo")] }, { text: "Done", toolCalls: [] }]);
    const options = deps({ callModel: model.caller, tools: [edit, undo] });
    const paused = await runHarnessLoop(emptyLoopState([user("go")]), options);
    expect(order).toEqual([]);
    await runHarnessLoop(paused.state, options, { kind: "approval", allowed: true });
    expect(order).toEqual(["edit", "undo"]);
  });

  it("turns tool errors and bad arguments into results the model reads", async () => {
    const broken = tool({
      name: "broken",
      execute: async () => {
        throw new Error("the sheet range B0 does not exist");
      },
    });
    const model = scripted([
      {
        text: "",
        toolCalls: [
          call("a", "broken"),
          { id: "b", name: "broken", arguments: "{not json" },
          call("c", "missing_tool"),
        ],
      },
      { text: "I hit a problem.", toolCalls: [] },
    ]);
    const outcome = await runHarnessLoop(
      emptyLoopState([user("go")]),
      deps({ callModel: model.caller, tools: [broken] }),
    );
    expect(outcome.status).toBe("completed");
    const results = outcome.state.messages
      .filter((m) => m.role === "tool")
      .map((m) => (m as { content: string }).content);
    expect(results[0]).toContain("the sheet range B0 does not exist");
    expect(results[1]).toContain("not one valid JSON object");
    expect(results[2]).toContain('no tool called "missing_tool"');
  });

  it("adds a note on the third identical call and never rejects it", async () => {
    const look = tool({ name: "look", execute: async () => ({ ok: true, content: "same" }) });
    const model = scripted([
      { text: "", toolCalls: [call("a", "look", { q: 1 })] },
      { text: "", toolCalls: [call("b", "look", { q: 1 })] },
      { text: "", toolCalls: [call("c", "look", { q: 1 })] },
      { text: "Done.", toolCalls: [] },
    ]);
    const outcome = await runHarnessLoop(
      emptyLoopState([user("go")]),
      deps({ callModel: model.caller, tools: [look] }),
    );
    const results = outcome.state.messages
      .filter((m) => m.role === "tool")
      .map((m) => (m as { content: string }).content);
    expect(results[0]).toBe("same");
    expect(results[1]).toBe("same");
    expect(results[2]).toContain("call 3 with exactly the same arguments");
    expect(outcome.status).toBe("completed");
  });

  it("gives the model one final turn without tools when the turn budget runs out", async () => {
    const look = tool({ name: "look", execute: async () => ({ ok: true, content: String(Math.random()) }) });
    const model = scripted([
      (messages) =>
        messages.some((m) => m.role === "user" && String(m.content).includes("budget"))
          ? { text: "Here is what is done.", toolCalls: [call("z", "look")] }
          : { text: "", toolCalls: [call(`c${messages.length}`, "look")] },
    ]);
    const outcome = await runHarnessLoop(
      emptyLoopState([user("go")]),
      deps({ callModel: model.caller, tools: [look], budgets: { maxTurns: 3, wallClockMs: 60_000 } }),
    );
    expect(outcome.status).toBe("completed");
    expect(model.count()).toBe(4);
    expect(model.choices.at(-1)).toBe("none");
    expect(outcome.state.text).toContain("Here is what is done.");
    // The tool call in the final turn is ignored.
    expect(outcome.state.messages.at(-1)).toEqual({ role: "assistant", content: "Here is what is done." });
  });

  it("gives the final turn when the wall clock runs out", async () => {
    let clock = 0;
    const look = tool({
      name: "look",
      execute: async () => {
        clock += 10_000;
        return { ok: true, content: `t${clock}` };
      },
    });
    const model = scripted([
      (messages) => ({ text: "", toolCalls: [call(`c${messages.length}`, "look")] }),
    ]);
    const outcome = await runHarnessLoop(
      emptyLoopState([user("go")]),
      deps({
        callModel: model.caller,
        tools: [look],
        now: () => clock,
        budgets: { maxTurns: 200, wallClockMs: 25_000 },
      }),
    );
    expect(outcome.status).toBe("completed");
    expect(model.choices.at(-1)).toBe("none");
    expect(model.count()).toBe(4);
  });

  it("stops cleanly mid-tool and keeps the work already done", async () => {
    const controller = new AbortController();
    const done = tool({
      name: "done",
      effect: "write",
      execute: async () => ({
        ok: true,
        content: "created",
        artifacts: [{ id: "a1", type: "document", title: "Notes", action: "created" }],
      }),
    });
    const hang = tool({
      name: "hang",
      execute: (_args, ctx) =>
        new Promise((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason));
          setTimeout(() => controller.abort(new DOMException("stop", "AbortError")), 5);
        }),
    });
    const model = scripted([
      { text: "", toolCalls: [call("a", "done")] },
      { text: "", toolCalls: [call("b", "hang")] },
      { text: "never", toolCalls: [] },
    ]);
    const checkpoint = vi.fn();
    const outcome = await runHarnessLoop(
      emptyLoopState([user("go")]),
      deps({ callModel: model.caller, tools: [done, hang], signal: controller.signal, hooks: { checkpoint } }),
    );
    expect(outcome.status).toBe("stopped");
    expect(outcome.state.artifacts).toEqual([
      { id: "a1", type: "document", title: "Notes", action: "created" },
    ]);
    const last = outcome.state.messages.at(-1) as { role: string; content: string };
    expect(last.role).toBe("tool");
    expect(last.content).toContain("Stopped by the user");
    expect(checkpoint).toHaveBeenCalled();
  });

  it("fails only when the provider is unreachable", async () => {
    const caller: ModelCaller = async () => {
      throw new ProviderUnavailableError("down");
    };
    const outcome = await runHarnessLoop(emptyLoopState([user("go")]), deps({ callModel: caller, tools: [] }));
    expect(outcome.status).toBe("failed");
  });

  it("withdraws text a failed provider attempt streamed", async () => {
    const resets: string[] = [];
    const caller: ModelCaller = async ({ onText, onRetry }) => {
      onText("partial ans");
      onRetry();
      onText("Full answer.");
      return { text: "Full answer.", toolCalls: [] };
    };
    const outcome = await runHarnessLoop(
      emptyLoopState([user("go")]),
      deps({ callModel: caller, tools: [], hooks: { onTextReset: (text) => resets.push(text) } }),
    );
    expect(outcome.state.text).toBe("Full answer.");
    expect(resets).toEqual([""]);
  });

  it("joins a message sent mid-run into the next turn", async () => {
    const look = tool({ name: "look" });
    let steered = false;
    const model = scripted([
      { text: "", toolCalls: [call("a", "look")] },
      (messages) => {
        expect(messages.at(-1)).toEqual(user("also add a summary"));
        return { text: "Added.", toolCalls: [] };
      },
    ]);
    const outcome = await runHarnessLoop(
      emptyLoopState([user("go")]),
      deps({
        callModel: model.caller,
        tools: [look],
        hooks: {
          checkpoint: () => {
            if (steered) return;
            steered = true;
            return { steers: [{ text: "also add a summary" }] };
          },
        },
      }),
    );
    expect(outcome.status).toBe("completed");
    expect(model.count()).toBe(2);
  });

  it("joins files sent mid-run with their message, and files alone with a plain lead", async () => {
    const look = tool({ name: "look" });
    let steered = false;
    const image = { type: "image_url" as const, image_url: { url: "data:image/png;base64,AAAA" } };
    const model = scripted([
      { text: "", toolCalls: [call("a", "look")] },
      (messages) => {
        expect(messages.at(-2)).toEqual({ role: "user", content: [{ type: "text", text: "use this photo" }, image] });
        expect(messages.at(-1)).toEqual({ role: "user", content: [{ type: "text", text: "Files I attached:" }, image] });
        return { text: "Used it.", toolCalls: [] };
      },
    ]);
    const outcome = await runHarnessLoop(
      emptyLoopState([user("go")]),
      deps({
        callModel: model.caller,
        tools: [look],
        hooks: {
          checkpoint: () => {
            if (steered) return;
            steered = true;
            return { steers: [{ text: "use this photo", parts: [image] }, { text: "", parts: [image] }] };
          },
        },
      }),
    );
    expect(outcome.status).toBe("completed");
  });

  it("takes a message sent during the final text turn as one more turn", async () => {
    let checks = 0;
    const model = scripted([
      { text: "First.", toolCalls: [] },
      { text: "Second.", toolCalls: [] },
    ]);
    const outcome = await runHarnessLoop(
      emptyLoopState([user("go")]),
      deps({
        callModel: model.caller,
        tools: [],
        hooks: { checkpoint: () => (checks++ === 0 ? { steers: [{ text: "and then?" }] } : undefined) },
      }),
    );
    expect(model.count()).toBe(2);
    expect(outcome.state.text).toBe("First.\n\nSecond.");
  });

  it("survives a failing checkpoint", async () => {
    const model = scripted([
      { text: "", toolCalls: [call("a", "look")] },
      { text: "Done.", toolCalls: [] },
    ]);
    const outcome = await runHarnessLoop(
      emptyLoopState([user("go")]),
      deps({
        callModel: model.caller,
        tools: [tool({ name: "look" })],
        hooks: {
          checkpoint: async () => {
            throw new Error("convex is down");
          },
        },
      }),
    );
    expect(outcome.status).toBe("completed");
  });

  it("pauses for approval, runs the other calls, then resumes from saved state", async () => {
    const executed: string[] = [];
    const remove = tool({
      name: "delete_forever",
      effect: "irreversible",
      category: () => "permanent_delete",
      label: () => "Deleting Old notes",
      question: () => "Delete Old notes permanently?",
      execute: async () => {
        executed.push("delete");
        return { ok: true, content: "deleted" };
      },
    });
    const look = tool({
      name: "look",
      execute: async () => {
        executed.push("look");
        return { ok: true, content: "looked" };
      },
    });
    const model = scripted([
      { text: "", toolCalls: [call("a", "delete_forever"), call("b", "look")] },
      { text: "Deleted.", toolCalls: [] },
    ]);
    const paused = await runHarnessLoop(
      emptyLoopState([user("delete it")]),
      deps({ callModel: model.caller, tools: [remove, look] }),
    );
    expect(paused.status).toBe("paused");
    if (paused.status !== "paused") return;
    expect(paused.pending).toMatchObject({
      kind: "approval",
      toolCallId: "a",
      question: "Delete Old notes permanently?",
      category: "permanent_delete",
    });
    expect(executed).toEqual(["look"]);

    // A server restart: the state goes through JSON and back.
    const saved = JSON.parse(JSON.stringify(paused.state));
    const resumed = await runHarnessLoop(
      saved,
      deps({ callModel: model.caller, tools: [remove, look] }),
      { kind: "approval", allowed: true },
    );
    expect(resumed.status).toBe("completed");
    expect(executed).toEqual(["look", "delete"]);
    const ids = resumed.state.messages
      .filter((m) => m.role === "tool")
      .map((m) => (m as { tool_call_id: string }).tool_call_id);
    expect(ids.sort()).toEqual(["a", "b"]);
  });

  it("does not ask when the policy allows, and tells the model when the user says no", async () => {
    const executed: string[] = [];
    const settings = tool({
      name: "change_settings",
      effect: "settings",
      category: () => "settings",
      execute: async () => {
        executed.push("settings");
        return { ok: true, content: "changed" };
      },
    });
    const allowed = await runHarnessLoop(
      emptyLoopState([user("dark mode")]),
      deps({
        callModel: scripted([
          { text: "", toolCalls: [call("a", "change_settings")] },
          { text: "Done.", toolCalls: [] },
        ]).caller,
        tools: [settings],
        policy: () => "allow",
      }),
    );
    expect(allowed.status).toBe("completed");
    expect(executed).toEqual(["settings"]);

    const model = scripted([
      { text: "", toolCalls: [call("a", "change_settings")] },
      { text: "Left as it was.", toolCalls: [] },
    ]);
    const paused = await runHarnessLoop(
      emptyLoopState([user("dark mode")]),
      deps({ callModel: model.caller, tools: [settings] }),
    );
    expect(paused.status).toBe("paused");
    const denied = await runHarnessLoop(
      paused.state,
      deps({ callModel: model.caller, tools: [settings] }),
      { kind: "approval", allowed: false },
    );
    expect(denied.status).toBe("completed");
    expect(executed).toEqual(["settings"]);
    const result = denied.state.messages.find((m) => m.role === "tool") as { content: string };
    expect(result.content).toContain("did not allow");
  });

  it("round-trips an ask_user question", async () => {
    const ask = tool({
      name: "ask_user",
      execute: async (args) => ({
        ok: true,
        content: "",
        pause: {
          kind: "question",
          question: String(args.question),
          options: [
            { key: "a", label: "Biology" },
            { key: "b", label: "Chemistry" },
          ],
        },
      }),
      answer: (_args, answer) => ({
        ok: true,
        content: `Chosen: ${answer.kind === "question" ? answer.choiceLabel : ""}`,
      }),
    });
    const model = scripted([
      { text: "", toolCalls: [call("q", "ask_user", { question: "Which subject?" })] },
      (messages) => ({ text: `Got ${(messages.at(-1) as { content: string }).content}`, toolCalls: [] }),
    ]);
    const paused = await runHarnessLoop(
      emptyLoopState([user("make notes")]),
      deps({ callModel: model.caller, tools: [ask] }),
    );
    expect(paused.status).toBe("paused");
    if (paused.status !== "paused") return;
    expect(paused.pending).toMatchObject({ kind: "question", question: "Which subject?", toolName: "ask_user" });
    const resumed = await runHarnessLoop(paused.state, deps({ callModel: model.caller, tools: [ask] }), {
      kind: "question",
      choiceKey: "a",
      choiceLabel: "Biology",
    });
    expect(resumed.status).toBe("completed");
    expect(resumed.state.text).toContain("Chosen: Biology");
  });

  it("compacts before a turn when the compactor says so", async () => {
    const onCompacted = vi.fn();
    const model = scripted([{ text: "Sure.", toolCalls: [] }]);
    const outcome = await runHarnessLoop(
      emptyLoopState([user("one"), { role: "assistant", content: "two" }, user("three")]),
      deps({
        callModel: model.caller,
        tools: [],
        hooks: { onCompacted },
        compact: async ({ messages }) => ({
          summary: "summary",
          messages: [user("[Earlier] summary"), messages.at(-1)!],
        }),
      }),
    );
    expect(onCompacted).toHaveBeenCalledWith("summary");
    expect(model.seen[0]).toHaveLength(3);
    expect(outcome.status).toBe("completed");
  });

  it("lets a tool ask for approval mid-call and honours the stored choice", async () => {
    const runs: boolean[] = [];
    const move = tool({
      name: "move_files",
      effect: "write",
      execute: async (_args, ctx) => {
        runs.push(Boolean(ctx.approved));
        if (!ctx.approved)
          return {
            ok: false,
            content: "",
            pause: { kind: "approval", question: "Move 3 desktop files?", category: "bridge_files" },
          };
        return { ok: true, content: "moved" };
      },
    });
    const script = () =>
      scripted([
        { text: "", toolCalls: [call("m", "move_files")] },
        { text: "Moved.", toolCalls: [] },
      ]);
    const shared = script();
    const paused = await runHarnessLoop(
      emptyLoopState([user("tidy")]),
      deps({ callModel: shared.caller, tools: [move] }),
    );
    expect(paused.status).toBe("paused");
    expect(runs).toEqual([false]);
    const resumed = await runHarnessLoop(
      paused.state,
      deps({ callModel: shared.caller, tools: [move] }),
      { kind: "approval", allowed: true },
    );
    expect(resumed.status).toBe("completed");
    expect(runs).toEqual([false, true]);

    runs.length = 0;
    const allowed = await runHarnessLoop(
      emptyLoopState([user("tidy")]),
      deps({
        callModel: script().caller,
        tools: [move],
        policy: (_effect, category) => (category === "bridge_files" ? "allow" : "ask"),
      }),
    );
    expect(allowed.status).toBe("completed");
    expect(runs).toEqual([false, true]);
  });

  it("runs ask_user once before pausing", async () => {
    let executions = 0;
    const ask = tool({
      name: "ask_user",
      execute: async () => {
        executions += 1;
        return { ok: true, content: "", pause: { kind: "question", question: "Which?" } };
      },
    });
    const outcome = await runHarnessLoop(
      emptyLoopState([user("go")]),
      deps({
        callModel: scripted([{ text: "", toolCalls: [call("q", "ask_user")] }]).caller,
        tools: [ask],
      }),
    );
    expect(outcome.status).toBe("paused");
    expect(executions).toBe(1);
  });

  it("keeps the last four widgets in the state, so the saved reply shows them again", async () => {
    const draw = tool({
      name: "show_widget",
      execute: async (args: { title: string }) => ({ ok: true, content: "shown", widget: { title: args.title, html: "<p>" + args.title + "</p>" } }),
    });
    const shown: string[] = [];
    const model = scripted([
      { text: "", toolCalls: ["1", "2", "3", "4", "5"].map((n) => call("w" + n, "show_widget", { title: "W" + n })) },
      { text: "Here they are.", toolCalls: [] },
    ]);
    const outcome = await runHarnessLoop(
      emptyLoopState([user("draw")]),
      deps({ callModel: model.caller, tools: [draw], hooks: { onWidget: (widget) => shown.push(widget.title) } }),
    );
    expect(shown).toEqual(["W1", "W2", "W3", "W4", "W5"]);
    expect(outcome.state.widgets).toEqual(["2", "3", "4", "5"].map((n) => ({ id: "w" + n, title: "W" + n, html: "<p>W" + n + "</p>" })));
  });
});
