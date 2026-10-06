import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const seams = vi.hoisted(() => ({ mutate: vi.fn(), query: vi.fn(), authority: vi.fn(), calendar: vi.fn(), reference: vi.fn() }));
vi.mock("@/app/api/spectra/run/harness/io", () => ({ mutate: seams.mutate, query: seams.query, readQuery: vi.fn(), act: vi.fn(), safeJson: JSON.parse }));
vi.mock("@/app/api/spectra/run/harness/authority", () => ({ evaluateCommandAuthority: seams.authority, recordAuthorityDecision: vi.fn() }));
vi.mock("@/app/api/spectra/run/harness/calendar-command", () => ({ executeRegisteredCalendarMutation: seams.calendar }));
vi.mock("@/app/api/spectra/run/harness/reference-command", () => ({ executeReferenceInsertion: seams.reference }));

import { executeApplicationCommand } from "@/app/api/spectra/run/harness/effects";
import { APPLICATION_COMMAND_NAMES, parseApplicationCommand } from "@/app/api/spectra/run/harness/application-commands";
import { CALENDAR_COMMAND_ALIASES } from "../calendar/domain/command";
import { readFileSync } from "node:fs";
import { aiRefreshRequest, aiSyncPurpose } from "../../../../shared/school-sync";

const cases: Array<{ command: string; args: Record<string, unknown>; mutation?: string; event?: string; status?: string }> = [
  { command: "navigate_spectra", args: { destination: "calendar" }, event: "navigate_spectra" },
  { command: "add_comment", args: { artifactId: "artifact", body: "Review this paragraph.", anchor: { regionId: "document:body/0" } }, mutation: "artifactComments:create", event: "comment_added" },
  { command: "read_devices", args: {} },
  { command: "pair_device", args: {}, event: "devices_action", status: "requested" },
  { command: "control_device", args: { action: "retry_folder", grantId: "grant" }, event: "devices_action", status: "requested" },
  { command: "remove_device", args: { deviceId: "device" }, mutation: "bridge:revokeDevice", event: "devices_changed" },
  { command: "organize_library", args: { action: "rename", targetIds: ["node"], name: "Sources" }, mutation: "orgTree:rename" },
  { command: "delete_library_items", args: { targetIds: ["node"] }, mutation: "orgTree:trash" },
  { command: "change_spectra_settings", args: { patch: { appearance: { density: "compact" } } }, mutation: "accountPreferences:writeLayer" },
  { command: "change_sync_policy", args: { targetIds: ["node"], patch: {} }, mutation: "syncPolicy:patchItems" },
  { command: "write_memory", args: { action: "create", content: "Prefers short examples" }, mutation: "memory:remember" },
  { command: "change_sharing", args: { resourceType: "artifact", resourceId: "work", action: "revoke", grantId: "grant" }, mutation: "authority:revoke" },
  { command: "trigger_managebac_sync", args: { purpose: "classes", force: true }, mutation: "managebac:requestAiRefresh" },
  { command: "select_managebac_classes", args: { recordIds: ["class"], expectedRevision: 1 }, mutation: "managebac:setSelectedClasses" },
  { command: "insert_reference", args: { hostWorkId: "host", targetWorkId: "source" }, event: "reference_insert", status: "canonical_write" },
  { command: "organize_library", args: { action: "create_workspace", name: "Physics" }, mutation: "spectraWorkspaces:create", event: "organize_library" },
  { command: "restore_library_items", args: { targetIds: ["node"] }, mutation: "orgTree:restore", event: "organize_library" },
  { command: "manage_comment", args: { artifactId: "work", commentId: "comment", action: "resolve" }, mutation: "artifactComments:setResolved", event: "comment_changed" },
  { command: "pin_library_item", args: { targetId: "node", pinned: true }, mutation: "orgTree:setPinned", event: "organize_library" },
  { command: "manage_conversation", args: { threadId: "thread", title: "Biology revision" }, mutation: "spectraThreads:update" },
  { command: "save_version", args: { artifactId: "work", name: "Before the rewrite" }, mutation: "changeGroups:createNamedCheckpoint", event: "version_saved" },
  { command: "set_school_sync_mode", args: { kind: "grades", mode: "manual" }, mutation: "school:setMode", event: "managebac_sync_preferences" },
  { command: "manage_class_workspaces", args: { action: "create", recordIds: ["class"] }, mutation: "managebac:materializeClassWorkspaces", event: "managebac_class_workspaces" },
  { command: "complete_calendar_block", args: { itemId: "block", expectedRevision: 2 }, mutation: "calendar:completeWorkBlock", event: "calendar_changed" },
  { command: "remove_calendar_event", args: { itemId: "event" }, mutation: "calendar:removePersonalItem", event: "calendar_changed" },
];
const calendarArgs: Record<string, Record<string, unknown>> = {
  schedule_calendar_task: { planArtifactId: "plan", planTaskId: "task", startAt: 1000, endAt: 2000, timezone: "UTC" },
  create_calendar_personal_event: { title: "Study", startAt: 1000, endAt: 2000, timezone: "UTC" },
  move_calendar_block: { itemId: "block", startAt: 1000, endAt: 2000, expectedRevision: 1 },
  resize_calendar_block: { itemId: "block", endAt: 2000, expectedRevision: 1 },
};

describe("application action contract matrix (stubbed persistence)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seams.mutate.mockResolvedValue({ saved: true });
    seams.authority.mockResolvedValue({ decision: "allow", target: "content" });
    seams.calendar.mockResolvedValue({ ok: true, status: "canonical_write" });
    seams.reference.mockResolvedValue({ ok: true, status: "canonical_write", receipt: { phase: "canonical_write", versionId: "version" } });
  });

  it("accounts for every application command with a dispatch case", () => {
    expect([...new Set([...cases.map((entry) => entry.command), ...Object.keys(calendarArgs)])].sort()).toEqual([...APPLICATION_COMMAND_NAMES].sort());
  });

  it("knows every command the harness tools send, and no other", () => {
    const sent = ["tools/app.ts", "tools/commands.ts"].flatMap((file) =>
      [...readFileSync(`src/features/spectra/ai/harness/${file}`, "utf8").matchAll(/command: "([a-z_]+)"/g)].map((match) => match[1]!));
    expect([...new Set(sent)].sort()).toEqual([...APPLICATION_COMMAND_NAMES].sort());
  });

  it.each(cases)("stages and dispatches $command through its registered path", async ({ command, args, mutation, event, status }) => {
    const parsed = parseApplicationCommand(command, args);
    expect(parsed.command).toBe(command);
    const events: string[] = [];
    const result = await executeApplicationCommand("actor", "run", "attempt", command, args, undefined,
      (emitted) => events.push(emitted.key), undefined, "operation") as Record<string, unknown>;
    expect(seams.authority).toHaveBeenCalledWith(expect.objectContaining({ command, authorityTarget: parsed.authority }));
    if (mutation) expect(seams.mutate).toHaveBeenCalledWith("spectraApplicationWrites:execute", expect.objectContaining({ runId: "run", executionId: "attempt", operationId: "operation", expectedCommand: command, expectedArgs: parsed.args }));
    else expect(seams.mutate).not.toHaveBeenCalled();
    if (event) expect(events).toContain(event);
    if (status) expect(result.status).toBe(status);
  });

  it.each([["upcoming_deadlines", ["current_tasks"]], ["past_tasks", ["past_tasks", "dropbox_files"]], ["cas", ["cas"]], ["nonsense", ["current_tasks"]]] as const)(
    "asks ManageBac only for the kinds the %s refresh needs", (purpose, kinds) => {
      expect(aiRefreshRequest(purpose, undefined)).toEqual({ reason: `ai_${aiSyncPurpose(purpose)}`, force: true, kinds });
      expect(aiRefreshRequest(purpose, false).force).toBe(false);
      expect(readFileSync("convex/spectraApplicationWrites.ts", "utf8")).toContain("aiRefreshRequest(args.purpose, args.force)");
    });

  it.each(Object.entries(CALENDAR_COMMAND_ALIASES))("dispatches Calendar alias %s with its operation identity", async (alias, canonical) => {
    expect(parseApplicationCommand(alias, calendarArgs[canonical]!).command).toBe(canonical);
    await executeApplicationCommand("actor", "run", "attempt", alias, calendarArgs[canonical]!, undefined, undefined, undefined, "operation");
    expect(seams.calendar).toHaveBeenCalledWith(expect.objectContaining({ command: canonical, runId: "run", executionId: "attempt", operationId: "operation" }));
  });

  it.each(["change_credentials", "delete_account", "change_ai_authority_mode", "change_managebac_mapping", "import_managebac_resource"])(
    "never runs %s, which is not an application command", async (command) => {
      expect(() => parseApplicationCommand(command, {})).toThrow(`APP_COMMAND_NOT_REGISTERED:${command}`);
      await expect(executeApplicationCommand("actor", "run", "attempt", command, {}, undefined, undefined, undefined, "operation")).rejects.toThrow("APP_COMMAND_NOT_REGISTERED");
      expect(seams.mutate).not.toHaveBeenCalled();
    });

  it("rejects arguments outside a command's contract before any write", async () => {
    await expect(executeApplicationCommand("actor", "run", "attempt", "organize_library", { action: "move", targetIds: ["node"] }, undefined, undefined, undefined, "operation")).rejects.toThrow(/destination/i);
    expect(seams.authority).not.toHaveBeenCalled();
    expect(seams.mutate).not.toHaveBeenCalled();
  });
});
