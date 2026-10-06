import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A step that asks the user is recorded as needing approval before the run
 * pauses, so the user's Allow binds to it. A step recorded without that flag
 * could never be approved: Convex refused the answer as a changed scope.
 */

const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

vi.mock("./io", async (importOriginal) => {
  const original = await importOriginal<typeof import("./io")>();
  const handle = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "spectraOperations:recordPlan") return { operationIds: ["op-1"] };
    return {};
  };
  return { ...original, act: vi.fn(handle), query: vi.fn(handle), mutate: vi.fn(handle) };
});

const { ConvexHarnessBackend } = await import("./convex-backend");

const backend = () => new ConvexHarnessBackend({ actorClerkId: "user_1", runId: "run-1", executionId: "exec-1", prompt: "", timeZone: "UTC" });

beforeEach(() => {
  calls.length = 0;
});

describe("staging an application command", () => {
  it.each([
    ["publish_code", { artifactId: "wx1", action: "publish" }, true],
    ["manage_comment", { artifactId: "wx1", commentId: "c1", action: "delete" }, true],
    ["manage_comment", { artifactId: "wx1", commentId: "c1", action: "resolve" }, false],
    ["control_device", { action: "remove_folder", grantId: "g1" }, true],
    ["control_device", { action: "pause_folder", grantId: "g1" }, false],
    ["set_school_sync_mode", { kind: "grades", mode: "off" }, true],
    ["pair_device", {}, true],
    ["save_version", { artifactId: "wx1", name: "Draft" }, false],
  ] as const)("records %s %j as needing approval: %s", async (command, args, asks) => {
    await backend().stageCommand({ command, args: { ...args }, toolCallId: "call-1", approved: false });
    const plan = calls.find((call) => call.name === "spectraOperations:recordPlan")!;
    expect((plan.args.operations as Array<{ requiresConfirmation: boolean }>)[0]!.requiresConfirmation).toBe(asks);
  });
});
