import { beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({ mutate: vi.fn(), query: vi.fn(), authority: vi.fn() }));
vi.mock("@/app/api/spectra/run/loop/io", () => ({
  mutate: seams.mutate, query: seams.query, readQuery: vi.fn(), act: vi.fn(), safeJson: JSON.parse,
}));
vi.mock("@/app/api/spectra/run/loop/authority", () => ({
  evaluateCommandAuthority: seams.authority, recordAuthorityDecision: vi.fn(),
}));

import { executeApplicationCommand } from "@/app/api/spectra/run/loop/act";

describe("S10 independent review: cancellation at application write boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seams.authority.mockResolvedValue({ decision: "allow", target: "content" });
    seams.mutate.mockResolvedValue({ saved: true });
    seams.query.mockResolvedValue({ results: [] });
  });

  it.each([
    { command: "change_spectra_settings", args: { patch: { appearance: { density: "compact" } } } },
    { command: "delete_library_items", args: { targetIds: ["disposable-node"] } },
  ])("does not apply $command when Stop arrives during authority lookup", async ({ command, args }) => {
    const controller = new AbortController();
    seams.authority.mockImplementation(async () => {
      controller.abort(new Error("Stopped by user"));
      return { decision: "allow", target: "content" };
    });
    await expect(executeApplicationCommand(
      "actor", "run", "attempt", command, args,
      undefined, undefined, controller.signal, "operation",
    )).rejects.toThrow();
    expect(seams.mutate).not.toHaveBeenCalled();
  });

  it("does not create a Library folder when Stop arrives during the duplicate lookup", async () => {
    const controller = new AbortController();
    seams.query.mockImplementation(async () => {
      controller.abort(new Error("Stopped by user"));
      return { results: [] };
    });
    await executeApplicationCommand(
      "actor", "run", "attempt", "organize_library", { action: "create_folder", name: "Disposable source notes" },
      undefined, undefined, controller.signal, "operation",
    ).catch(() => undefined);
    expect(seams.mutate).not.toHaveBeenCalled();
  });
});
