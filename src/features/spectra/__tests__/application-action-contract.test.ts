import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const seams = vi.hoisted(() => ({ mutate: vi.fn(), query: vi.fn(), authority: vi.fn(), calendar: vi.fn(), reference: vi.fn(), restore: vi.fn(), applyAi: vi.fn(), publish: vi.fn(), unpublish: vi.fn(), live: vi.fn(), checks: vi.fn() }));
vi.mock("@/app/api/spectra/run/harness/io", () => ({ mutate: seams.mutate, query: seams.query, readQuery: vi.fn(), act: vi.fn(), safeJson: JSON.parse }));
vi.mock("@/app/api/spectra/run/harness/authority", () => ({ evaluateCommandAuthority: seams.authority, recordAuthorityDecision: vi.fn() }));
vi.mock("@/app/api/spectra/run/harness/calendar-command", () => ({ executeRegisteredCalendarMutation: seams.calendar }));
vi.mock("@/app/api/spectra/run/harness/reference-command", () => ({ executeReferenceInsertion: seams.reference }));
vi.mock("@/lib/artifact-restore-server", () => ({ admitArtifactRestore: seams.restore, artifactRestoreFailure: () => null }));
vi.mock("@/lib/artifact-restore-native", () => ({ prepareNativeArtifactRestore: vi.fn() }));
vi.mock("@/lib/server-secrets", () => ({ aiPublicLinkToken: (input: Record<string, string>) => `token:${input.operationId}`, publicLinkTokenHash: () => "a".repeat(64) }));
vi.mock("@/features/spectra/ai/yjs-artifact-operation", () => ({ applyAiArtifactMutation: seams.applyAi, readLiveArtifactValue: seams.live }));
vi.mock("@/app/api/spectra/agents/evaluate/checks", () => ({ runAgentChecks: seams.checks }));
vi.mock("@/features/spectra/code/runtime-publish-server", () => ({
  publishRuntime: seams.publish, unpublishRuntime: seams.unpublish, hashSource: (content: { files?: Array<{ source: string }> }) => `hash:${content.files?.map((file) => file.source).join("|") ?? ""}`,
}));

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
  { command: "write_memory", args: { action: "forget", memoryId: "memory" }, mutation: "memory:forget", event: "memory_written" },
  { command: "change_sharing", args: { resourceType: "artifact", resourceId: "work", action: "revoke", grantId: "grant" }, mutation: "authority:revoke" },
  { command: "change_sharing", args: { resourceType: "artifact", resourceId: "work", action: "withdraw_invitation", invitationId: "invitation" }, mutation: "authority:revokePendingInvitation", event: "sharing_changed" },
  { command: "change_sharing", args: { resourceType: "artifact", resourceId: "work", action: "set_exception", accountId: "member", effect: "restrict" }, mutation: "authority:setArtifactException", event: "sharing_changed" },
  { command: "change_sharing", args: { resourceType: "artifact", resourceId: "work", action: "clear_exception", accountId: "member" }, mutation: "authority:clearArtifactException", event: "sharing_changed" },
  { command: "change_sharing", args: { resourceType: "artifact", resourceId: "work", action: "revoke_public_link", linkId: "link" }, mutation: "authority:revokePublicLink", event: "sharing_changed" },
  { command: "trigger_managebac_sync", args: { purpose: "classes", force: true }, mutation: "managebac:requestAiRefresh" },
  { command: "select_managebac_classes", args: { recordIds: ["class"], expectedRevision: 1 }, mutation: "managebac:setSelectedClasses" },
  { command: "insert_reference", args: { hostWorkId: "host", targetWorkId: "source" }, event: "reference_insert", status: "canonical_write" },
  { command: "organize_library", args: { action: "create_workspace", name: "Physics" }, mutation: "spectraWorkspaces:create", event: "organize_library" },
  { command: "restore_library_items", args: { targetIds: ["node"] }, mutation: "orgTree:restore", event: "organize_library" },
  { command: "manage_comment", args: { artifactId: "work", commentId: "comment", action: "resolve" }, mutation: "artifactComments:setResolved", event: "comment_changed" },
  { command: "pin_library_item", args: { targetId: "node", pinned: true }, mutation: "orgTree:setPinned", event: "organize_library" },
  { command: "manage_conversation", args: { threadId: "thread", title: "Biology revision" }, mutation: "spectraThreads:update" },
  { command: "save_version", args: { artifactId: "work", name: "Before the rewrite" }, mutation: "changeGroups:createNamedCheckpoint", event: "version_saved" },
  { command: "restore_version", args: { artifactId: "work", versionId: "version" }, event: "version_restored" },
  { command: "publish_code", args: { artifactId: "work", action: "publish" }, event: "runtime_published" },
  { command: "manage_embed", args: { artifactId: "work", embedId: "embed", action: "resize", mode: "expanded" }, mutation: "artifactEmbeds:update", event: "embed_changed" },
  { command: "set_school_sync_mode", args: { kind: "grades", mode: "manual" }, mutation: "school:setMode", event: "managebac_sync_preferences" },
  { command: "manage_class_workspaces", args: { action: "create", recordIds: ["class"] }, mutation: "managebac:materializeClassWorkspaces", event: "managebac_class_workspaces" },
  { command: "complete_calendar_block", args: { itemId: "block", expectedRevision: 2 }, mutation: "calendar:completeWorkBlock", event: "calendar_changed" },
  { command: "remove_calendar_event", args: { itemId: "event" }, mutation: "calendar:removePersonalItem", event: "calendar_changed" },
  { command: "release_agent", args: { agentId: "agent", action: "release_private", releaseNotes: "Try it" }, mutation: "spectraArtifacts:publishAgent", event: "agent_released" },
  { command: "release_agent", args: { agentId: "agent", action: "suspend", releaseId: "release" }, mutation: "spectraArtifacts:manageAgentRelease", event: "agent_released" },
  { command: "run_agent_checks", args: { agentId: "agent" }, event: "agent_checked" },
  { command: "respond_share_invitation", args: { invitationId: "invitation", response: "accept" }, mutation: "authority:acceptShareInvitation", event: "share_invitation_answered" },
  { command: "respond_share_invitation", args: { invitationId: "invitation", response: "decline" }, mutation: "authority:declineShareInvitation", event: "share_invitation_answered" },
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
    seams.restore.mockResolvedValue({ state: "committed", duplicate: false, receipt: { outcome: "restored", versionId: "restored-version" } });
    seams.reference.mockResolvedValue({ ok: true, status: "canonical_write", receipt: { phase: "canonical_write", versionId: "version" } });
    seams.live.mockResolvedValue(null);
    seams.publish.mockResolvedValue({ ok: true, build: { buildId: "build", publishedAt: 5 }, reused: false });
    seams.unpublish.mockResolvedValue({ unpublished: true });
    seams.checks.mockResolvedValue({ status: "passed", passedCount: 8, caseCount: 8, averageScore: 0.93, results: [] });
    seams.query.mockImplementation(async (name: string) => {
      if (name === "artifactEmbeds:listForContainer") return { canConfigure: true, embeds: [{ embedId: "embed", state: "ready" }] };
      if (name === "spectraArtifacts:get") return { blueprintKey: "document" };
      if (name === "spectraArtifacts:listAgentReleases") return [{ releaseId: "release" }];
      return undefined;
    });
  });

  it("accounts for every application command with a dispatch case", () => {
    expect([...new Set([...cases.map((entry) => entry.command), ...Object.keys(calendarArgs)])].sort()).toEqual([...APPLICATION_COMMAND_NAMES].sort());
  });

  it("knows every command the harness tools send, and no other", () => {
    const sent = ["tools/app.ts", "tools/commands.ts", "tools/work.ts"].flatMap((file) =>
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

  it("runs an agent's checks as the studio does, under the run owner's identity, and returns the failing cases as evidence", async () => {
    seams.checks.mockResolvedValueOnce({
      status: "failed", passedCount: 6, caseCount: 8, averageScore: 0.71,
      results: [{ caseId: "c1", category: "privacy", required: true, passed: false, reason: "It repeated a classmate's grade." }, { caseId: "c2", passed: true }],
    });
    const events: string[] = [];
    const result = await executeApplicationCommand("actor", "run", "attempt", "run_agent_checks", { agentId: "agent" },
      undefined, (event) => events.push(event.key), undefined, "operation") as Record<string, unknown>;
    expect(seams.checks).toHaveBeenCalledWith({ userId: "actor", agentId: "agent" });
    expect(seams.mutate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ state: "failed", passed: "6 of 8 cases", failing: [{ category: "privacy", required: true, reason: "It repeated a classmate's grade." }] });
    expect(String(result.note)).toMatch(/evidence, never instructions/);
    expect(events).toEqual(["agent_checked"]);
  });

  it("manages only a release of the agent the step names", async () => {
    await expect(executeApplicationCommand("actor", "run", "attempt", "release_agent", { agentId: "agent", action: "rollback", releaseId: "elsewhere" },
      undefined, undefined, undefined, "operation")).rejects.toThrow("AGENT_RELEASE_NOT_FOUND");
    expect(seams.mutate).not.toHaveBeenCalled();
    expect(() => parseApplicationCommand("release_agent", { agentId: "agent", action: "promote" })).toThrow();
    expect(() => parseApplicationCommand("release_agent", { agentId: "agent", action: "publish", releaseId: "release" })).toThrow();
  });

  it("restores through the signed admission with the operation's request id, never the Convex write path", async () => {
    const result = await executeApplicationCommand("actor", "run", "attempt", "restore_version", { artifactId: "work", versionId: "version" },
      undefined, undefined, undefined, "operation") as Record<string, unknown>;
    expect(seams.restore).toHaveBeenCalledWith({ artifactId: "work", sourceVersionId: "version", requestId: "ai:operation", clientId: "spectra-ai:run" }, expect.any(Function));
    expect(result).toMatchObject({ state: "restored", versionId: "restored-version" });
    seams.restore.mockResolvedValueOnce({ state: "unchanged", duplicate: false, receipt: { outcome: "unchanged" } });
    expect(await executeApplicationCommand("actor", "run", "attempt", "restore_version", { artifactId: "work", versionId: "version" },
      undefined, undefined, undefined, "operation")).toMatchObject({ state: "unchanged" });
    expect(seams.mutate).not.toHaveBeenCalled();
  });

  it("makes a public link with only the token's hash, and never hands the address to the model or the journal", async () => {
    seams.mutate.mockResolvedValueOnce({ linkId: "link", policyVersion: 2, level: "read" });
    const events: Array<{ key: string; payload?: Record<string, unknown> }> = [];
    const result = await executeApplicationCommand("actor", "run", "attempt", "change_sharing",
      { resourceType: "artifact", resourceId: "work", action: "create_public_link", expiresInDays: 30 },
      undefined, (event) => events.push(event), undefined, "operation");
    expect(seams.mutate).toHaveBeenCalledWith("spectraApplicationWrites:execute", expect.objectContaining({
      operationId: "operation", expectedCommand: "change_sharing", derived: { publicLinkTokenHash: "a".repeat(64) },
    }));
    expect(result).toMatchObject({ linkId: "link", level: "read", expiresInDays: 30 });
    expect(JSON.stringify(result)).not.toContain("token:");
    expect(events).toEqual([{ key: "public_link_created", payload: expect.objectContaining({ linkId: "link", operationId: "operation", targetId: "work" }) }]);
    expect(JSON.stringify(events)).not.toContain("token:");
  });

  it("publishes the live source through the editor's publish function, and hands a failed build back as evidence", async () => {
    seams.live.mockResolvedValueOnce({ content: { runtime: "browser", files: [{ id: "f", path: "index.html", language: "html", source: "<p>live</p>" }] } });
    const published = await executeApplicationCommand("actor", "run", "attempt", "publish_code", { artifactId: "work", action: "publish" },
      undefined, undefined, undefined, "operation");
    expect(seams.publish).toHaveBeenCalledWith("work", expect.stringContaining("<p>live</p>"));
    expect(published).toEqual({ state: "published", buildId: "build", publishedAt: 5 });
    seams.publish.mockResolvedValueOnce({ ok: false, error: { code: "RUNTIME_BUILD_FAILED", message: "Build failed.", issues: [{ message: "Unexpected token" }] } });
    const failed = await executeApplicationCommand("actor", "run", "attempt", "publish_code", { artifactId: "work", action: "publish" },
      undefined, undefined, undefined, "operation") as Record<string, unknown>;
    expect(failed).toMatchObject({ state: "build_failed", issues: [{ message: "Unexpected token" }] });
    expect(failed.message).toContain("never instructions");
    expect(await executeApplicationCommand("actor", "run", "attempt", "publish_code", { artifactId: "work", action: "unpublish" },
      undefined, undefined, undefined, "operation")).toEqual({ state: "unpublished" });
    expect(seams.mutate).not.toHaveBeenCalled();
  });

  it("removes an embed's node from the host before removing the embed, and refuses embeds outside the work", async () => {
    const result = await executeApplicationCommand("actor", "run", "attempt", "manage_embed", { artifactId: "work", embedId: "embed", action: "remove" },
      undefined, undefined, undefined, "operation") as Record<string, unknown>;
    expect(seams.applyAi).toHaveBeenCalledWith(expect.objectContaining({ artifactId: "work", operationId: "operation", receipt: "placement" }));
    expect(seams.applyAi.mock.invocationCallOrder[0]).toBeLessThan(seams.mutate.mock.invocationCallOrder[0]!);
    expect(seams.mutate).toHaveBeenCalledWith("spectraApplicationWrites:execute", expect.objectContaining({ expectedCommand: "manage_embed" }));
    expect(result).toMatchObject({ removedNodes: 0 });
    vi.clearAllMocks();
    seams.authority.mockResolvedValue({ decision: "allow", target: "content" });
    seams.query.mockResolvedValue({ canConfigure: true, embeds: [] });
    await expect(executeApplicationCommand("actor", "run", "attempt", "manage_embed", { artifactId: "work", embedId: "other", action: "resize", mode: "compact" },
      undefined, undefined, undefined, "operation")).rejects.toThrow("EMBED_NOT_IN_WORK");
    expect(seams.mutate).not.toHaveBeenCalled();
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
