import { describe, expect, it } from "vitest";
import { COMMAND_CATALOG } from "../../../commands/ai-reach";
import { emptyLoopState, runHarnessLoop, type ModelCaller } from "../loop";
import { MemoryBackend } from "../memory-backend";
import { permissionDecision, readPermissionPrefs } from "../permissions";
import { buildHarnessTools, createSession } from "../tools";
import { rankCommands, runOnlyTools } from "../tools/commands";
import type { HarnessMessage, ModelTurn } from "../types";

function scripted(turns: ModelTurn[]) {
  let index = 0;
  const caller: ModelCaller = async ({ onText }) => {
    const turn = turns[Math.min(index, turns.length - 1)]!;
    index += 1;
    if (turn.text) onText(turn.text);
    return turn;
  };
  return caller;
}

const call = (id: string, name: string, args: Record<string, unknown>) => ({ id, name, arguments: JSON.stringify(args) });

function toolResults(messages: HarnessMessage[]) {
  return messages.flatMap((message) => (message.role === "tool" ? [message.content] : []));
}

function setup(ai: unknown = {}) {
  const backend = new MemoryBackend();
  const session = createSession({ backend, prompt: "test" });
  const tools = buildHarnessTools(session);
  const prefs = readPermissionPrefs(ai);
  const run = (turns: ModelTurn[]) =>
    runHarnessLoop(emptyLoopState([{ role: "user", content: "go" }]), {
      systemPrompt: "test",
      tools,
      callModel: scripted(turns),
      policy: (effect, category) => permissionDecision(effect, category, prefs),
      runId: "run",
      signal: new AbortController().signal,
    });
  return { backend, session, tools, run };
}

const top = (query: string) => rankCommands(query)[0]?.id;

describe("find_commands", () => {
  it("finds actions by meaning, not only by their words", () => {
    expect(top("make it dark mode")).toBe("settings.change");
    expect(top("get rid of this folder")).toBe("library.trash");
    expect(top("book a dentist appointment")).toBe("calendar.add_event");
    expect(top("invite my friend to edit")).toBe("sharing.change");
    expect(top("refresh my school deadlines")).toBe("managebac.sync");
    expect(top("copy the worksheet from my class shelf into my library")).toBe("managebac.import_resource");
    expect(top("connect my computer files")).toBe("devices.pair");
    expect(top("bring my essay back to an earlier version")).toBe("work.restore_version");
    expect(top("who changed this and when")).toBe("work.history");
    expect(top("make a public link anyone can open")).toBe("sharing.public_link");
    expect(top("who has access to my essay")).toBe("sharing.read");
    expect(top("cancel the invite I sent")).toBe("sharing.withdraw_invitation");
    expect(top("resize the embedded spreadsheet")).toBe("work.manage_embed");
    expect(top("release my agent so the class can use it")).toBe("agents.release");
    expect(top("roll my agent back to its previous release")).toBe("agents.release");
    expect(top("forget that I like short answers")).toBe("memory.forget");
    expect(top("run the checks on my agent")).toBe("agents.checks");
    expect(top("accept the invitation Ana sent me")).toBe("sharing.respond");
    expect(top("what have people invited me to")).toBe("sharing.invitations");
    expect(top("remember that I like short answers")).toBe("memory.remember");
    expect(rankCommands("zzzz qqqq")).toEqual([]);
  });

  it("says how to run a command, or why only the user can", async () => {
    const { run } = setup();
    const outcome = await run([
      { text: "", toolCalls: [call("f1", "find_commands", { query: "add an event to my calendar" }), call("f2", "find_commands", { query: "give spectra full control" })] },
      { text: "Done.", toolCalls: [] },
    ]);
    const [calendar, permissions] = toolResults(outcome.state.messages);
    expect(calendar).toMatch(/run_command \{id: "calendar\.add_event", args: \{title\?: string, start\?: string/);
    expect(calendar).not.toMatch(/action\?/);
    expect(permissions).toMatch(/permissions\.ai[^\n]*\n  Only the user can do this: It changes what Spectra AI may do/);
  });
});

describe("run_command", () => {
  it("runs a command through its tool and the same server command", async () => {
    const { backend, run } = setup();
    const outcome = await run([
      { text: "", toolCalls: [call("r1", "run_command", { id: "calendar.add_event", args: { title: "Dentist", start: "2026-10-06T09:00" } })] },
      { text: "Added.", toolCalls: [] },
    ]);
    expect(outcome.status).toBe("completed");
    expect(backend.commands).toEqual([
      expect.objectContaining({ command: "create_calendar_personal_event", args: expect.objectContaining({ title: "Dentist", startLocal: "2026-10-06T09:00" }) }),
    ]);
  });

  it("asks first when the command's effect asks, exactly like its tool", async () => {
    const { backend, run } = setup();
    const outcome = await run([
      { text: "", toolCalls: [call("r1", "run_command", { id: "sharing.change", args: { action: "invite", resourceType: "artifact", resourceId: "wx1", subjectId: "acct2", level: "read" } })] },
    ]);
    expect(outcome.status).toBe("paused");
    if (outcome.status !== "paused") return;
    expect(outcome.pending).toMatchObject({ kind: "approval", toolName: "run_command", category: "sharing" });
    expect(outcome.pending.question).toMatch(/Share .* so they can view it\?/);
    expect(backend.commands).toEqual([]);
  });

  it("refuses commands only the user may run, and every self-grant", async () => {
    const { backend, run } = setup({ permissionFullControl: true });
    const outcome = await run([
      {
        text: "",
        toolCalls: [
          call("r1", "run_command", { id: "permissions.ai", args: { permissionFullControl: true } }),
          call("r2", "run_command", { id: "settings.change", args: { patch: { ai: { permissionAllow: ["sharing"] } } } }),
          call("r3", "run_command", { id: "settings.change", args: { patch: { ai: { permissionDeny: [] } } } }),
          call("r4", "run_command", { id: "devices.native_writes", args: {} }),
          call("r5", "run_command", { id: "nope.missing", args: {} }),
        ],
      },
      { text: "I cannot do those.", toolCalls: [] },
    ]);
    const results = toolResults(outcome.state.messages);
    expect(results[0]).toMatch(/Only the user can do "Change Spectra AI permissions"/);
    expect(results[1]).toMatch(/cannot change its own permissions/);
    expect(results[2]).toMatch(/cannot change its own permissions/);
    expect(results[3]).toMatch(/Only the user can do "Change native writes"/);
    expect(results[4]).toMatch(/There is no command "nope.missing"/);
    expect(backend.commands).toEqual([]);
  });

  it("does not let fixed arguments be overridden", async () => {
    const { backend, run } = setup();
    await run([
      { text: "", toolCalls: [call("r1", "run_command", { id: "navigation.open_calendar", args: { destination: "settings" } })] },
      { text: "Opened.", toolCalls: [] },
    ]);
    expect(backend.commands[0]).toMatchObject({ command: "navigate_spectra", args: { destination: "calendar" } });
  });

  it("changes sync policy only with approval, and never picks a folder on the computer", async () => {
    const asks = setup();
    const paused = await asks.run([{ text: "", toolCalls: [call("r1", "run_command", { id: "library.sync_policy", args: { targetIds: ["n1"], patch: { timing: "manual" } } })] }]);
    expect(paused.status).toBe("paused");
    if (paused.status === "paused") expect(paused.pending.category).toBe("bridge_files");

    const allowed = setup({ permissionAllow: ["bridge_files"] });
    const outcome = await allowed.run([
      {
        text: "",
        toolCalls: [
          call("r1", "run_command", { id: "library.sync_policy", args: { targetIds: ["n1"], patch: { timing: "manual" } } }),
          call("r2", "run_command", { id: "library.sync_policy", args: { targetIds: ["n1"], patch: { localMirrorGrantId: "g1" } } }),
          call("r3", "run_command", { id: "library.sync_policy", args: { targetIds: ["n1"], patch: { timing: "sometimes" } } }),
        ],
      },
      { text: "Done.", toolCalls: [] },
    ]);
    const results = toolResults(outcome.state.messages);
    expect(results[1]).toMatch(/Only the user picks a folder/);
    expect(results[2]).toMatch(/patch\.timing must be one of/);
    expect(allowed.backend.commands).toEqual([expect.objectContaining({ command: "change_sync_policy", args: { targetIds: ["n1"], patch: { timing: "manual" } }, toolCallId: "r1" })]);
  });

  it("reaches every runnable catalog command, sending the server command it names", async () => {
    const { session, tools } = setup();
    const runnable = new Set([...tools, ...runOnlyTools(session)].map((tool) => tool.name));
    const withExamples = COMMAND_CATALOG.flatMap((entry) => (entry.reach.kind === "tool" ? [{ entry, reach: entry.reach }] : []));
    for (const { entry, reach } of withExamples) {
      // use_agent is offered only when the user has agents.
      if (reach.tool !== "use_agent") expect(runnable.has(reach.tool), entry.id).toBe(true);
    }
    for (const { entry, reach } of withExamples.filter(({ reach }) => reach.appCommand)) {
      expect(reach.example, entry.id).toBeDefined();
      const run = setup({ permissionFullControl: true });
      const outcome = await run.run([
        { text: "", toolCalls: [call("r1", "run_command", { id: entry.id, args: reach.example })] },
        { text: "Done.", toolCalls: [] },
      ]);
      expect(outcome.status, entry.id).toBe("completed");
      expect(run.backend.commands.map((sent) => sent.command), entry.id).toEqual([reach.appCommand]);
    }
  });
});

describe("devices tool", () => {
  it("reads and controls a computer straight away, through the shared commands", async () => {
    const { backend, run } = setup();
    const outcome = await run([
      {
        text: "",
        toolCalls: [
          call("d1", "devices", { action: "status" }),
          call("d2", "devices", { action: "retry_folder", grantId: "grant_a" }),
          call("d3", "devices", { action: "pause_syncing", paused: false }),
        ],
      },
      { text: "Done.", toolCalls: [] },
    ]);
    expect(outcome.status).toBe("completed");
    expect(backend.commands.map((entry) => [entry.command, entry.args])).toEqual([
      ["read_devices", {}],
      ["control_device", { action: "retry_folder", grantId: "grant_a" }],
      ["control_device", { action: "resume_syncing" }],
    ]);
  });

  it("asks first, in the settings category, to connect or remove a computer", async () => {
    for (const [args, question] of [
      [{ action: "pair" }, /Connect this computer to Spectra?/],
      [{ action: "remove_device", deviceId: "device-desk" }, /Remove this device?/],
    ] as const) {
      const { backend, run } = setup();
      const outcome = await run([{ text: "", toolCalls: [call("d1", "devices", args)] }]);
      expect(outcome.status).toBe("paused");
      if (outcome.status !== "paused") return;
      expect(outcome.pending).toMatchObject({ kind: "approval", toolName: "devices", category: "settings" });
      expect(outcome.pending.question).toMatch(question);
      expect(backend.commands).toEqual([]);
    }
  });
});
