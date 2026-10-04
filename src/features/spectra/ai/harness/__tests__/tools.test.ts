import { describe, expect, it } from "vitest";
import { authorNew } from "../authoring";
import { emptyLoopState, runHarnessLoop, type ModelCaller } from "../loop";
import { MemoryBackend } from "../memory-backend";
import { permissionDecision, readPermissionPrefs } from "../permissions";
import { buildHarnessTools, createSession } from "../tools";
import type { HarnessMessage, ModelTurn } from "../types";

function scripted(turns: Array<ModelTurn | ((messages: HarnessMessage[]) => ModelTurn)>) {
  let index = 0;
  const seen: HarnessMessage[][] = [];
  const caller: ModelCaller = async ({ messages, onText }) => {
    seen.push(messages);
    const step = turns[Math.min(index, turns.length - 1)]!;
    index += 1;
    const turn = typeof step === "function" ? step(messages) : step;
    if (turn.text) onText(turn.text);
    return turn;
  };
  return { caller, seen };
}

const call = (id: string, name: string, args: Record<string, unknown>) => ({ id, name, arguments: JSON.stringify(args) });

function lastTool(messages: HarnessMessage[]) {
  const found = [...messages].reverse().find((message) => message.role === "tool");
  return found && found.role === "tool" ? found.content : "";
}

function setup(backend = new MemoryBackend(), ai: unknown = {}) {
  const session = createSession({ backend, prompt: "test" });
  const tools = buildHarnessTools(session);
  const prefs = readPermissionPrefs(ai);
  return {
    backend,
    session,
    tools,
    run: (model: ModelCaller, signal = new AbortController().signal) =>
      runHarnessLoop(emptyLoopState([{ role: "user", content: "go" }]), {
        systemPrompt: "test",
        tools,
        callModel: model,
        policy: (effect, category) => permissionDecision(effect, category, prefs),
        runId: "run",
        signal,
      }),
  };
}

describe("harness tools", () => {
  it("every tool has an effect, a prose description and a label without ids", () => {
    const { tools } = setup();
    const names = tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const banned of ["propose_operation", "submit_plan", "revise_staged_operation", "read_artifact_skill", "find_commands", "run_command"])
      expect(names).not.toContain(banned);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.effect).toBeTruthy();
      expect(tool.label({ id: "wx000000000000000000000001", targetIds: ["wx1"], title: "T", action: "add_event", destination: "artifact", targetId: "wx1", resourceId: "wx1", artifactId: "wx1", query: "q", patch: {}, purpose: "cas" })).not.toMatch(/wx\d/);
    }
  });

  it("creates a deck, edits it and reads it back through the loop", async () => {
    const { backend, run } = setup();
    let createdId = "";
    const model = scripted([
      {
        text: "",
        toolCalls: [
          call("c1", "create_artifact", {
            type: "flashcard_deck",
            title: "Cell biology",
            content: { items: Array.from({ length: 8 }, (_, i) => ({ front: `Organelle ${i + 1}?`, back: `Function ${i + 1}` })) },
          }),
        ],
      },
      (messages) => {
        createdId = /id (wx\d+)/.exec(lastTool(messages))![1]!;
        return { text: "", toolCalls: [call("c2", "edit_artifact", { id: createdId, operations: [{ op: "update", item: 1, back: "Makes ATP" }] })] };
      },
      { text: "", toolCalls: [call("c3", "read_artifact", { id: "PLACEHOLDER" })] },
      { text: "Done: an 8-card deck.", toolCalls: [] },
    ]);
    const original = model.caller;
    const caller: ModelCaller = async (input) => {
      const turn = await original(input);
      return {
        ...turn,
        toolCalls: turn.toolCalls.map((entry) => ({ ...entry, arguments: entry.arguments.replace("PLACEHOLDER", createdId) })),
      };
    };
    const outcome = await run(caller);
    expect(outcome.status).toBe("completed");
    const stored = backend.artifacts.get(createdId)!;
    expect((stored.content as { cards: Array<{ back: string }> }).cards[0]!.back).toBe("Makes ATP");
    expect(outcome.state.artifacts).toEqual([
      expect.objectContaining({ id: createdId, action: "created", title: "Cell biology", type: "flashcard_deck" }),
    ]);
    expect(lastTool(outcome.state.messages)).toMatch(/1\. Organelle 1\?/);
  });

  it("returns authoring errors to the model and saves nothing", async () => {
    const backend = new MemoryBackend({ artifacts: [{ id: "doc1", type: "document", title: "Essay", content: authorNew("document", { markdown: "Hello" }, { timeZone: "UTC" }).content }] });
    const { run } = setup(backend);
    const before = JSON.stringify(backend.artifacts.get("doc1")!.content);
    const model = scripted([
      { text: "", toolCalls: [call("e1", "edit_artifact", { id: "doc1", operations: [{ op: "replace", find: "Goodbye", replace: "x" }] })] },
      { text: "Could not find it.", toolCalls: [] },
    ]);
    const outcome = await run(model.caller);
    expect(lastTool(outcome.state.messages)).toMatch(/Edit 1 \(replace\): `find` text was not found/);
    expect(JSON.stringify(backend.artifacts.get("doc1")!.content)).toBe(before);
  });

  it("pauses a settings change for approval and refuses permission self-grants", async () => {
    const { backend, run } = setup();
    const model = scripted([
      {
        text: "",
        toolCalls: [
          call("s1", "change_settings", { patch: { ai: { permissionFullControl: true } } }),
          call("s2", "change_settings", { patch: { appearance: { theme: "dark" } } }),
        ],
      },
    ]);
    const outcome = await run(model.caller);
    expect(outcome.status).toBe("paused");
    if (outcome.status !== "paused") return;
    expect(outcome.pending).toMatchObject({ kind: "approval", category: "settings", question: "Change your settings: appearance theme: dark?" });
    expect(outcome.state.messages.find((message) => message.role === "tool")).toMatchObject({
      content: expect.stringMatching(/cannot change its own permissions/),
    });
    expect(backend.commands).toEqual([]);
  });

  it("runs a settings change without asking when the user allowed settings", async () => {
    const backend = new MemoryBackend();
    const { run } = setup(backend, { permissionAllow: ["settings"] });
    const model = scripted([
      { text: "", toolCalls: [call("s1", "change_settings", { patch: { appearance: { density: "compact" } } })] },
      { text: "Switched to compact.", toolCalls: [] },
    ]);
    const outcome = await run(model.caller);
    expect(outcome.status).toBe("completed");
    expect(backend.settings.appearance).toEqual({ density: "compact" });
  });

  it("asks the user and turns the answer into the tool result", async () => {
    const { run, tools } = setup();
    const model = scripted([
      { text: "", toolCalls: [call("q1", "ask_user", { question: "Which unit?", options: [{ label: "Unit 1" }, { label: "Unit 2" }] })] },
      { text: "Great, unit 2.", toolCalls: [] },
    ]);
    const paused = await run(model.caller);
    expect(paused.status).toBe("paused");
    if (paused.status !== "paused") return;
    expect(paused.pending).toMatchObject({ kind: "question", options: [{ key: "option-1", label: "Unit 1" }, { key: "option-2", label: "Unit 2" }] });
    const resumed = await runHarnessLoop(
      paused.state,
      { systemPrompt: "test", tools, callModel: model.caller, policy: () => "ask", runId: "run", signal: new AbortController().signal },
      { kind: "question", choiceKey: "option-2" },
    );
    expect(resumed.status).toBe("completed");
    expect(resumed.state.messages.find((message) => message.role === "tool")).toMatchObject({ content: "The user answered: Unit 2" });
  });

  it("creates a whole deck with its theme and notes in one call and reads every slide back", async () => {
    const { tools, run, backend } = setup();
    const create = tools.find((tool) => tool.name === "create_artifact")!;
    expect(create.description).toMatch(/whole, in this one call/);
    expect(create.description).toMatch(/every slide and the speaker notes/);
    const slides = Array.from({ length: 12 }, (_, index) => ({
      title: `Stage ${index + 1} of the cell cycle`,
      body: `- What happens in stage ${index + 1}\n- Why it matters`,
      notes: `Presenter note ${index + 1}`,
    }));
    const model = scripted([
      { text: "", toolCalls: [call("c1", "create_artifact", { type: "presentation", title: "Cell cycle", content: { theme: { accent: "#2f7d6d" }, slides } })] },
      { text: "Made the deck.", toolCalls: [] },
    ]);
    const outcome = await run(model.caller);
    expect(outcome.status).toBe("completed");
    const readback = lastTool(model.seen[1]!);
    expect(readback).toMatch(/12 slides/);
    expect(readback).toMatch(/12\. \[[a-z-]+\] Stage 12 of the cell cycle/);
    expect(readback).toMatch(/notes: Presenter note 12/);
    expect(readback).not.toMatch(/edit_artifact/);
    expect([...backend.artifacts.values()]).toHaveLength(1);
  });

  it("asks for listed problems to be fixed together, once", async () => {
    const { tools } = setup();
    const create = tools.find((tool) => tool.name === "create_artifact")!;
    const result = await create.execute(
      { type: "presentation", title: "Data", content: { slides: [{ title: "Results", layout: "title-visual-text" }] } },
      { signal: new AbortController().signal, runId: "r", toolCallId: "t" },
    );
    expect(result.content).toMatch(/Problems:/);
    expect(result.content).toMatch(/fix them all together in one edit_artifact call/);
  });

  it("gives the presentation skill in the authoring format's terms, not internal fields", async () => {
    const { tools } = setup();
    const skill = tools.find((tool) => tool.name === "load_skill")!;
    const result = await skill.execute({ name: "presentation" }, { signal: new AbortController().signal, runId: "r", toolCallId: "t" });
    expect(result.content).toMatch(/whole deck in one create_artifact call/);
    expect(result.content).not.toMatch(/readingOrder|sourceRefs|object geometry|server-issued evidence handles/);
  });

  it("loads a skill with the authoring format", async () => {
    const { tools } = setup();
    const skill = tools.find((tool) => tool.name === "load_skill")!;
    const result = await skill.execute({ name: "presentation" }, { signal: new AbortController().signal, runId: "r", toolCallId: "t" });
    expect(result.content).toMatch(/## Authoring format/);
    expect(result.content).toMatch(/add_slide/);
  });
});
