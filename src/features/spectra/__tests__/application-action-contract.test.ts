import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const seams = vi.hoisted(() => ({ mutate: vi.fn(), query: vi.fn(), authority: vi.fn(), calendar: vi.fn(), reference: vi.fn() }));
vi.mock("@/app/api/spectra/run/harness/io", () => ({ mutate: seams.mutate, query: seams.query, readQuery: vi.fn(), act: vi.fn(), safeJson: JSON.parse }));
vi.mock("@/app/api/spectra/run/harness/authority", () => ({ evaluateCommandAuthority: seams.authority, recordAuthorityDecision: vi.fn() }));
vi.mock("@/app/api/spectra/run/harness/calendar-command", () => ({ executeRegisteredCalendarMutation: seams.calendar }));
vi.mock("@/app/api/spectra/run/harness/reference-command", () => ({ executeReferenceInsertion: seams.reference }));

import { executeApplicationCommand } from "@/app/api/spectra/run/harness/effects";
import { prepareApplicationCommand } from "../operations/application-command";
import { spectraToolRegistry } from "../tools/registry";
import { spectraToolExecutor } from "../tools/execution/tool-executor";
import { CALENDAR_COMMAND_ALIASES } from "../calendar/domain/command";

const cases: Array<{ command: string; args: Record<string, unknown>; mutation?: string; event?: string; status?: string }> = [
  { command: "navigate_spectra", args: { destination: "calendar" }, event: "navigate_spectra" },
  { command: "add_comment", args: { artifactId: "artifact", body: "Review this paragraph.", anchor: { regionId: "document:body/0" } }, mutation: "artifactComments:create", event: "comment_added" },
  { command: "setup_bridge", args: { action: "pair" }, event: "bridge_setup", status: "needs-human" },
  { command: "organize_library", args: { action: "rename", targetIds: ["node"], name: "Sources" }, mutation: "orgTree:rename" },
  { command: "delete_library_items", args: { targetIds: ["node"] }, mutation: "orgTree:trash" },
  { command: "change_spectra_settings", args: { patch: { appearance: { density: "compact" } } }, mutation: "accountPreferences:writeLayer" },
  { command: "change_sync_policy", args: { targetIds: ["node"], patch: {} }, mutation: "syncPolicy:patchItems" },
  { command: "write_memory", args: { action: "create", content: "Prefers short examples" }, mutation: "memory:remember" },
  { command: "change_sharing", args: { resourceType: "artifact", resourceId: "work", action: "revoke", grantId: "grant" }, mutation: "authority:revoke" },
  { command: "trigger_managebac_sync", args: { purpose: "classes", force: true }, mutation: "managebac:requestAiRefresh" },
  { command: "select_managebac_classes", args: { recordIds: ["class"], expectedRevision: 1 }, mutation: "managebac:setSelectedClasses" },
  { command: "insert_reference", args: { hostWorkId: "host", targetWorkId: "source" }, event: "reference_insert", status: "canonical_write" },
];
const calendarArgs: Record<string, Record<string, unknown>> = {
  schedule_calendar_task: { planArtifactId: "plan", planTaskId: "task", startAt: 1000, endAt: 2000, timezone: "UTC" },
  create_calendar_personal_event: { title: "Study", startAt: 1000, endAt: 2000, timezone: "UTC" },
  move_calendar_block: { itemId: "block", startAt: 1000, endAt: 2000, expectedRevision: 1 },
  resize_calendar_block: { itemId: "block", endAt: 2000, expectedRevision: 1 },
};

describe("tool titles students see in run steps", () => {
  it("say work, never artifact", () => {
    const titles = spectraToolRegistry.list().map((tool) => tool.title);
    expect(titles.length).toBeGreaterThan(10);
    expect(titles.filter((title) => /artifact/i.test(title))).toEqual([]);
    expect(spectraToolRegistry.require("read_artifact_skill").title).toBe("Read work guidance");
    expect(spectraToolRegistry.require("add_comment").title).toBe("Add comment");
  });
});

describe("application action contract matrix (stubbed persistence)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seams.mutate.mockResolvedValue({ saved: true });
    seams.authority.mockResolvedValue({ decision: "allow", target: "content" });
    seams.calendar.mockResolvedValue({ ok: true, status: "canonical_write" });
    seams.reference.mockResolvedValue({ ok: true, status: "canonical_write", receipt: { phase: "canonical_write", versionId: "version" } });
  });

  it("accounts for every registered application action with execution or an explicit prohibition", () => {
    const supported = spectraToolRegistry.list().filter((tool) => tool.capability === "operate_application" && tool.aiAvailability !== "prohibited").map((tool) => tool.id);
    expect(cases.map((entry) => entry.command).sort()).toEqual(supported.sort());
  });

  it.each(cases)("stages and dispatches $command through its registered path", async ({ command, args, mutation, event, status }) => {
    const operation = prepareApplicationCommand(command, args);
    expect(operation.input.command).toBe(command);
    const events: string[] = [];
    const result = await executeApplicationCommand("actor", "run", "attempt", command, operation.input.args, undefined,
      (emitted) => events.push(emitted.key), undefined, "operation") as Record<string, unknown>;
    expect(seams.authority).toHaveBeenCalledWith(expect.objectContaining({ command }));
    if (mutation) expect(seams.mutate).toHaveBeenCalledWith("spectraApplicationWrites:execute", expect.objectContaining({ runId: "run", executionId: "attempt", operationId: "operation", expectedCommand: command, expectedArgs: operation.input.args }));
    else expect(seams.mutate).not.toHaveBeenCalled();
    if (event) expect(events).toContain(event);
    if (status) expect(result.status).toBe(status);
  });

  it.each(Object.entries(CALENDAR_COMMAND_ALIASES))("dispatches Calendar alias %s with its operation identity", async (alias, canonical) => {
    const operation = prepareApplicationCommand(alias, calendarArgs[canonical]!);
    await executeApplicationCommand("actor", "run", "attempt", alias, operation.input.args, undefined, undefined, undefined, "operation");
    expect(seams.calendar).toHaveBeenCalledWith(expect.objectContaining({ command: canonical, runId: "run", executionId: "attempt", operationId: "operation" }));
  });

  it.each(spectraToolRegistry.list().filter((tool) => tool.capability === "operate_application" && tool.aiAvailability === "prohibited").map((tool) => tool.id))(
    "provides an explicit limitation for %s", (command) => {
      expect(() => prepareApplicationCommand(command, {})).toThrow("AUTHORITY_PROHIBITED");
    });

  it.each(cases.filter(({ command }) => spectraToolRegistry.require(command).approval === "always"))(
    "does not dispatch unapproved $command", async ({ command, args }) => {
      const execute = vi.fn();
      const result = await spectraToolExecutor.execute({ id: "declined", name: command, input: args }, { requireApproval: async () => false, executeRegisteredTool: execute });
      expect(result.ok).toBe(false);
      expect(execute).not.toHaveBeenCalled();
    });
});
