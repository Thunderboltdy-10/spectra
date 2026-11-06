import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const seams = vi.hoisted(() => ({ mutate: vi.fn(), query: vi.fn(), authority: vi.fn(), calendar: vi.fn(), reference: vi.fn(), restore: vi.fn(), applyAi: vi.fn(), publish: vi.fn(), unpublish: vi.fn(), live: vi.fn(), checks: vi.fn(), importResource: vi.fn(), prepareBench: vi.fn(), answerBench: vi.fn(), compile: vi.fn() }));
vi.mock("@/app/api/spectra/run/harness/io", () => ({ mutate: seams.mutate, query: seams.query, readQuery: vi.fn(), act: vi.fn(), safeJson: JSON.parse }));
vi.mock("@/app/api/spectra/run/harness/authority", () => ({ evaluateCommandAuthority: seams.authority, recordAuthorityDecision: vi.fn() }));
vi.mock("@/app/api/spectra/run/harness/calendar-command", () => ({ executeRegisteredCalendarMutation: seams.calendar }));
vi.mock("@/app/api/spectra/run/harness/reference-command", () => ({ executeReferenceInsertion: seams.reference }));
vi.mock("@/lib/artifact-restore-server", () => ({ admitArtifactRestore: seams.restore, artifactRestoreFailure: () => null }));
vi.mock("@/lib/artifact-restore-native", () => ({ prepareNativeArtifactRestore: vi.fn() }));
vi.mock("@/lib/server-secrets", () => ({ aiPublicLinkToken: (input: Record<string, string>) => `token:${input.operationId}`, publicLinkTokenHash: () => "a".repeat(64) }));
vi.mock("@/features/spectra/ai/yjs-artifact-operation", () => ({ applyAiArtifactMutation: seams.applyAi, readLiveArtifactValue: seams.live }));
vi.mock("@/app/api/spectra/agents/evaluate/checks", () => ({ runAgentChecks: seams.checks }));
vi.mock("@/app/api/spectra/managebac/resource-import", () => ({ importManageBacResourceAs: seams.importResource }));
vi.mock("@/app/api/spectra/agents/bench/answer", () => ({ prepareBenchAnswer: seams.prepareBench, answerOnBench: seams.answerBench }));
vi.mock("@/app/api/spectra/agents/foundry/compile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/api/spectra/agents/foundry/compile")>()),
  compileAgentDraft: seams.compile,
}));
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
  { command: "show_work", args: { artifactId: "work" }, mutation: "artifactEmbeds:create" },
  { command: "set_school_sync_mode", args: { kind: "grades", mode: "manual" }, mutation: "school:setMode", event: "managebac_sync_preferences" },
  { command: "manage_class_workspaces", args: { action: "create", recordIds: ["class"] }, mutation: "managebac:materializeClassWorkspaces", event: "managebac_class_workspaces" },
  { command: "complete_calendar_block", args: { itemId: "block", expectedRevision: 2 }, mutation: "calendar:completeWorkBlock", event: "calendar_changed" },
  { command: "remove_calendar_event", args: { itemId: "event" }, mutation: "calendar:removePersonalItem", event: "calendar_changed" },
  { command: "release_agent", args: { agentId: "agent", action: "release_private", releaseNotes: "Try it" }, mutation: "spectraArtifacts:publishAgent", event: "agent_released" },
  { command: "release_agent", args: { agentId: "agent", action: "suspend", releaseId: "release" }, mutation: "spectraArtifacts:manageAgentRelease", event: "agent_released" },
  { command: "run_agent_checks", args: { agentId: "agent" }, event: "agent_checked" },
  { command: "import_managebac_resource", args: { sourceRecordId: "resource" }, event: "managebac_resource_imported" },
  { command: "run_agent_bench", args: { agentId: "agent", prompt: "Mark my essay" }, event: "agent_bench_changed" },
  { command: "save_agent_bench_case", args: { agentId: "agent", prompt: "Mark my essay", mustInclude: ["next step"], mustNotInclude: [] }, mutation: "spectraApplicationWrites:execute", event: "agent_bench_changed" },
  { command: "remove_agent_bench_case", args: { agentId: "agent", caseId: "case" }, mutation: "spectraApplicationWrites:execute" },
  { command: "compile_agent", args: { agentId: "agent" }, event: "agent_compiled" },
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
    seams.importResource.mockResolvedValue({ status: "imported", importId: "import", artifactId: "copy" });
    seams.prepareBench.mockImplementation(async (userId: string, question: Record<string, unknown>) => ({ userId, ...question, messages: [] }));
    seams.answerBench.mockImplementation(async (prepared: Record<string, unknown>) => ({
      id: "run", prompt: prepared.prompt, target: prepared.target, output: "Your thesis is clear. One next step: cite a source.", createdAt: 1,
    }));
    seams.compile.mockResolvedValue({
      jobId: "job", runId: "compile-run", diagnostics: [], releaseNotes: "First skills.",
      routing: { description: "Marks essays", examples: ["Mark my essay"], negativeExamples: [] },
      skills: [{ id: "skill-mark", name: "Mark an essay", purpose: "Grades against the rubric.", triggers: [{ kind: "keyword", terms: ["mark"] }], procedure: [], evaluationCases: [] }],
    });
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

  it("asks the user's view to open a work at the region Spectra named, and only a work", async () => {
    const events: Array<{ key: string; payload?: Record<string, unknown> }> = [];
    await executeApplicationCommand("actor", "run", "attempt", "navigate_spectra", { destination: "artifact", targetId: "work", region: "slide-3" },
      undefined, (event) => events.push(event), undefined, "operation");
    await executeApplicationCommand("actor", "run", "attempt", "navigate_spectra", { destination: "calendar", region: "slide-3" },
      undefined, (event) => events.push(event), undefined, "operation");
    expect(events.map((event) => event.payload)).toEqual([
      { destination: "artifact", targetId: "work", region: "slide-3", note: "Opening artifact", requestedAt: expect.any(Number) },
      { destination: "calendar", note: "Opening calendar", requestedAt: expect.any(Number) },
    ]);
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

  it("imports a class resource through the class shelf's own server module, as the run owner", async () => {
    const events: Array<{ key: string; payload?: Record<string, unknown> }> = [];
    const imported = await executeApplicationCommand("actor", "run", "attempt", "import_managebac_resource", { sourceRecordId: "resource" },
      undefined, (event) => events.push(event), undefined, "operation");
    expect(seams.importResource).toHaveBeenCalledWith({ clerkId: "actor", sourceRecordId: "resource", refresh: false });
    expect(seams.mutate).not.toHaveBeenCalled();
    expect(imported).toEqual({ state: "imported", artifactId: "copy" });
    expect(events).toEqual([{ key: "managebac_resource_imported", payload: { targetId: "copy", note: "Copied a school resource into your Library" } }]);

    seams.importResource.mockResolvedValueOnce({ status: "imported", importId: "import", artifactId: "copy", replayed: true });
    expect(await executeApplicationCommand("actor", "run", "attempt", "import_managebac_resource", { sourceRecordId: "resource" },
      undefined, undefined, undefined, "operation")).toEqual({ state: "already_imported", artifactId: "copy" });

    seams.importResource.mockResolvedValueOnce({ status: "update_available", sourceHash: "h2", priorArtifactId: "copy" });
    const changed = await executeApplicationCommand("actor", "run", "attempt", "import_managebac_resource", { sourceRecordId: "resource" },
      undefined, undefined, undefined, "operation") as Record<string, unknown>;
    expect(changed).toMatchObject({ state: "update_available", artifactId: "copy" });
    expect(String(changed.note)).toMatch(/refresh true/);

    await executeApplicationCommand("actor", "run", "attempt", "import_managebac_resource", { sourceRecordId: "resource", refresh: true },
      undefined, undefined, undefined, "operation");
    expect(seams.importResource).toHaveBeenLastCalledWith({ clerkId: "actor", sourceRecordId: "resource", refresh: true });
    expect(seams.authority).toHaveBeenCalledWith(expect.objectContaining({ command: "import_managebac_resource", authorityTarget: "managebac_resource_import" }));
  });

  it("asks an agent on its bench through the bench's own module, as the run owner, with the open draft, and grades it by its kept test", async () => {
    seams.live.mockResolvedValueOnce({ content: { instructions: { text: "Unsaved edit" } } });
    seams.query.mockImplementation(async (name: string) =>
      name === "agents:benchCases" ? [{ prompt: "mark my  essay", checks: { mustInclude: ["next step", "grade"], mustNotInclude: [] } }] : undefined);
    const events: Array<{ key: string; payload?: Record<string, unknown> }> = [];
    const result = await executeApplicationCommand("actor", "run", "attempt", "run_agent_bench", { agentId: "agent", prompt: " Mark my essay " },
      undefined, (event) => events.push(event), undefined, "operation") as Record<string, unknown>;
    expect(seams.prepareBench).toHaveBeenCalledWith("actor", { agentId: "agent", prompt: "Mark my essay", target: "draft", content: { instructions: { text: "Unsaved edit" } } });
    expect(seams.mutate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      state: "answered",
      target: "draft",
      answer: "Your thesis is clear. One next step: cite a source.",
      test: { passed: "1 of 2 checks hold", failing: ['Includes "grade"'] },
    });
    expect(String(result.note)).toMatch(/never instructions/);
    expect(events).toEqual([{ key: "agent_bench_changed", payload: { targetId: "agent", note: "The draft answered on the bench" } }]);
    expect(seams.authority).toHaveBeenCalledWith(expect.objectContaining({ command: "run_agent_bench", authorityTarget: "content" }));

    // A release answers as itself, never with the open draft; a stopped answer is not graded.
    seams.answerBench.mockResolvedValueOnce({ id: "run", prompt: "Mark my essay", target: "release", releaseNumber: 2, output: "Your", createdAt: 1, stopped: true });
    const stopped = await executeApplicationCommand("actor", "run", "attempt", "run_agent_bench", { agentId: "agent", prompt: "Mark my essay", target: "release", releaseNumber: 2 },
      undefined, undefined, undefined, "operation") as Record<string, unknown>;
    expect(seams.prepareBench).toHaveBeenLastCalledWith("actor", { agentId: "agent", prompt: "Mark my essay", target: "release", releaseNumber: 2 });
    expect(seams.live).toHaveBeenCalledTimes(1);
    expect(stopped).toMatchObject({ state: "stopped", releaseNumber: 2, answer: "Your" });
    expect(stopped).not.toHaveProperty("test");
    expect(() => parseApplicationCommand("run_agent_bench", { agentId: "agent", prompt: "Hi", releaseNumber: 2 })).toThrow();
  });

  it("compiles an agent through the Foundry's own module, as the run owner, telling an open studio and changing no draft", async () => {
    const events: Array<{ key: string; payload?: Record<string, unknown> }> = [];
    const result = await executeApplicationCommand("actor", "run", "attempt", "compile_agent", { agentId: "agent" },
      undefined, (event) => events.push(event), undefined, "operation") as Record<string, unknown>;
    expect(seams.compile).toHaveBeenCalledWith(expect.objectContaining({ userId: "actor", agentId: "agent" }));
    expect(seams.mutate).not.toHaveBeenCalled();
    expect(seams.applyAi).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      state: "compiled",
      jobId: "job",
      skills: [{ id: "skill-mark", name: "Mark an essay", triggers: ["words: mark"], steps: 0, checks: 0 }],
      routing: { description: "Marks essays", examples: ["Mark my essay"] },
      releaseNotes: "First skills.",
    });
    expect(String(result.note)).toMatch(/approve_agent_skills/);
    expect(events).toEqual([{ key: "agent_compiled", payload: { targetId: "agent", note: "Drafted 1 skill in the Foundry" } }]);
    expect(seams.authority).toHaveBeenCalledWith(expect.objectContaining({ command: "compile_agent", authorityTarget: "content" }));
  });

  it("keeps and removes bench tests through the Convex write path, telling an open studio", async () => {
    seams.mutate.mockResolvedValueOnce({ caseId: "case", created: false });
    const events: Array<{ key: string; payload?: Record<string, unknown> }> = [];
    await executeApplicationCommand("actor", "run", "attempt", "save_agent_bench_case",
      { agentId: "agent", prompt: "Mark my essay", mustInclude: ["next step"], mustNotInclude: [] }, undefined, (event) => events.push(event), undefined, "operation");
    seams.mutate.mockResolvedValueOnce({ removed: false });
    await executeApplicationCommand("actor", "run", "attempt", "remove_agent_bench_case", { agentId: "agent", caseId: "gone" },
      undefined, (event) => events.push(event), undefined, "operation");
    seams.mutate.mockResolvedValueOnce({ removed: true });
    await executeApplicationCommand("actor", "run", "attempt", "remove_agent_bench_case", { agentId: "agent", caseId: "case" },
      undefined, (event) => events.push(event), undefined, "operation");
    expect(events.map((event) => event.payload?.note)).toEqual(["Updated a bench test", "Removed a bench test"]);
    expect(() => parseApplicationCommand("save_agent_bench_case", { agentId: "agent", prompt: "Hi", mustInclude: [], mustNotInclude: [] })).toThrow();
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

  it.each(["change_credentials", "delete_account", "change_ai_authority_mode", "change_managebac_mapping"])(
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
