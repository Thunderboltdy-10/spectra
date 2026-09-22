import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { compactOperationsRemappingCreated, parseModelOperation, parseSpectraPlan } from "../operations/schema";
import { mapOperationArtifactReferences, mergeStagedOperations, validateOperationDependencies } from "../operations/dependencies";
import { validatePlanAgainstIntent } from "../operations/validate-plan";
import { resolveCreatedArtifactDependencies } from "@/app/api/spectra/run/loop/act";

const create = (title: string) => parseModelOperation({
  type: "artifact.create", input: {
    blueprintKey: "document", title, summary: null, tags: [], workspaceId: null,
    placement: "inbox", content: { blocks: [{ id: "p", type: "paragraph", text: title }], outline: [] },
  },
});
const command = (name: string, args: Record<string, unknown> = {}) => parseModelOperation({ type: "app.command", input: { command: name, args } });
const references = { artifactIds: new Set(["existing"]), workspaceIds: new Set(["source-a", "destination-b"]), placementNodes: new Map() };
const planWith = (operations: unknown[], intent = {}) => parseSpectraPlan({
  decision: "operate", finalResponse: "Ready", operations,
  intent: { mode: "mixed", requestedArtifactTypes: ["document"], requestedVisibleArtifactCount: 1,
    targetArtifactId: null, targetWorkspaceId: null, ...intent },
});

describe("operation graph identities", () => {
  it("remaps and executes every reference host, target, array and placement after compaction", () => {
    const operations = [
      create("Host"), command("trigger_managebac_sync"), create("Source"),
      command("insert_reference", { hostWorkId: "@created:0", targetWorkId: "@created:2", label: "@created:2" }),
      command("create_calendar_personal_event", { linkedArtifactIds: ["@created:0", "@created:2"] }),
      parseModelOperation({ type: "workspaceItem.add", input: { artifactId: "@created:2", workspaceId: "workspace" } }),
    ];
    const compacted = compactOperationsRemappingCreated(operations, (_, index) => index !== 1);
    validateOperationDependencies(compacted);
    const ids = new Map([[0, "saved-host"], [1, "saved-source"]]);
    expect(resolveCreatedArtifactDependencies(compacted[2]!, ids)).toMatchObject({ input: { args: {
      hostWorkId: "saved-host", targetWorkId: "saved-source", label: "@created:2",
    } } });
    expect(resolveCreatedArtifactDependencies(compacted[3]!, ids)).toMatchObject({ input: { args: { linkedArtifactIds: ["saved-host", "saved-source"] } } });
    expect(resolveCreatedArtifactDependencies(compacted[4]!, ids)).toMatchObject({ input: { artifactId: "saved-source" } });
  });

  it("does not remap authored text, including literal dependency syntax", () => {
    const original = create("@created:9");
    expect(mapOperationArtifactReferences(original, () => "wrong")).toEqual(original);
  });

  it("rejects forward, non-create and removed producer dependencies", () => {
    expect(() => validateOperationDependencies([command("insert_reference", { hostWorkId: "@created:1" }), create("Later")])).toThrow("prior artifact.create");
    expect(() => validateOperationDependencies([command("trigger_managebac_sync"), command("insert_reference", { targetWorkId: "@created:0" })])).toThrow("prior artifact.create");
    expect(() => compactOperationsRemappingCreated([create("Gone"), command("insert_reference", { targetWorkId: "@created:0" })], (_, index) => index !== 0)).toThrow("dropped operation");
  });

  it("deduplicates only identical adjacent refreshes, preserving changed scope and intervening actions", () => {
    const plan = parseSpectraPlan({ decision: "operate", intent: { mode: "mixed", requestedArtifactTypes: ["document"], requestedVisibleArtifactCount: 1, targetArtifactId: null, targetWorkspaceId: null }, choices: null, finalResponse: "Ready", operations: [
      command("trigger_managebac_sync", { purpose: "classes" }),
      command("trigger_managebac_sync", { purpose: "classes" }),
      command("trigger_managebac_sync", { purpose: "deadlines" }),
      create("Guide"),
      command("trigger_managebac_sync", { purpose: "deadlines" }),
      command("insert_reference", { hostWorkId: "@created:3", targetWorkId: "existing" }),
    ] });
    expect(plan.operations).toHaveLength(5);
    expect(plan.operations[4]).toMatchObject({ input: { args: { hostWorkId: "@created:2" } } });
  });

  it("keeps staged indexes when the terminal plan repeats its prefix or appends remaining work", () => {
    const staged = [create("Host"), create("Source")];
    const remaining = command("insert_reference", { hostWorkId: "@created:0", targetWorkId: "@created:1" });
    expect(mergeStagedOperations(staged, [remaining])).toEqual([...staged, remaining]);
    expect(mergeStagedOperations(staged, [...staged, remaining])).toEqual([...staged, remaining]);
    expect(() => mergeStagedOperations(staged, [staged[1]!, remaining])).toThrow("only part");
  });

  it("remaps obligation coverage with dropped refreshes and rejects missing or uncovered work", () => {
    const plan = planWith([command("trigger_managebac_sync"), command("trigger_managebac_sync"), create("Guide")], {
      obligations: [
        { id: "refresh", description: "Refresh school data", operationIndexes: [0, 1] },
        { id: "guide", description: "Create guide", operationIndexes: [2] },
      ],
    });
    expect(plan.intent.obligations?.map((entry) => entry.operationIndexes)).toEqual([[0], [1]]);
    expect(() => validatePlanAgainstIntent(plan, references)).not.toThrow();
    expect(() => validatePlanAgainstIntent({ ...plan, intent: { ...plan.intent, obligations: plan.intent.obligations!.slice(0, 1) } }, references)).toThrow("Every operation");
    expect(() => planWith([create("Guide")], { obligations: [{ id: "missing", description: "Create the separate cards", operationIndexes: [1] }] })).toThrow("missing operation");
    expect(() => validatePlanAgainstIntent(planWith([command("navigate_spectra", { destination: "library" })]), references)).toThrow("every artifact");
  });

  it("preserves a destination distinct from the source and validates created blueprint identities", () => {
    const operation = create("Guía de química");
    if (operation.type !== "artifact.create") throw new Error("fixture");
    const plan = planWith([{ ...operation, input: { ...operation.input, workspaceId: "destination-b", placement: "context" } }], { targetWorkspaceId: "destination-b" });
    expect(validatePlanAgainstIntent(plan, references).operations[0]).toMatchObject({ input: { workspaceId: "destination-b" } });
    expect(() => validatePlanAgainstIntent({ ...plan, intent: { ...plan.intent, targetWorkspaceId: "source-a" } }, references)).toThrow("destination");
    expect(() => validatePlanAgainstIntent(planWith([create("Guide"), { type: "artifact.update", input: {
      artifactId: "@created:0", blueprintKey: "planner_task", title: "Mistargeted", summary: null, content: null, tags: null,
    } }]), references)).toThrow("blueprint");
  });

  it("resolves planner links and typed navigation without rewriting unrelated ids or text", () => {
    const task = parseModelOperation({ type: "artifact.create", input: {
      blueprintKey: "planner_task", title: "Study guide", summary: null, tags: [], workspaceId: null, placement: "inbox",
      content: { status: "todo", timezone: "Europe/Madrid", recurrence: { frequency: "none", interval: 1, weekdays: [], exceptions: [] }, linkedArtifactIds: ["@created:0"] },
    } });
    expect(() => validatePlanAgainstIntent(planWith([create("Guide"), task], { requestedVisibleArtifactCount: 2, requestedArtifactTypes: ["document", "planner_task"] }), references)).not.toThrow();
    const update = parseModelOperation({ type: "artifact.update", input: {
      artifactId: "existing", blueprintKey: "planner_task", title: null, summary: null, content: null, tags: null,
      contentPatch: { changes: [{ path: "/linkedArtifactIds", value: ["@created:0"] }, { path: "/description", value: "@created:0" }] },
    } });
    expect(resolveCreatedArtifactDependencies(update, new Map([[0, "saved-guide"]]))).toMatchObject({ input: { contentPatch: { changes: [
      { path: "/linkedArtifactIds", value: ["saved-guide"] }, { path: "/description", value: "@created:0" },
    ] } } });
    const navigate = command("navigate_spectra", { destination: "artifact", targetId: "@created:0" });
    expect(resolveCreatedArtifactDependencies(navigate, new Map([[0, "saved-guide"]]))).toMatchObject({ input: { args: { targetId: "saved-guide" } } });
    expect(() => validatePlanAgainstIntent(planWith([create("Guide"), command("insert_reference", { hostWorkId: "not-owned", targetWorkId: "@created:0" })]), references)).toThrow("owned id");
  });
});
