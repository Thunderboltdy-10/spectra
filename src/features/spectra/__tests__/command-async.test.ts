import { describe, expect, it, vi } from "vitest";
import { commandContext, executeCommandAsync } from "../commands";
import type { Command, CommandParam } from "../commands";
import { Circle } from "lucide-react";

describe("awaitable command execution", () => {
  it("waits for an asynchronous command and preserves enabled semantics", async () => {
    let release!: () => void;
    const completed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execute = vi.fn(async () => completed);
    const command: Command<CommandParam> = {
      id: "test.async",
      domain: "artifact:document",
      title: "Async test",
      icon: Circle,
      description: "",
      availability: () => ({ state: "enabled" as const }),
      execute: async (_ctx, _params) => execute(),
      presentation: { kind: "button", compact: {}, medium: {} },
      defaultPlacement: { tab: "General", group: "", order: 0 },
      priority: "essential",
      risk: "safe" as const,
      undo: "none(explain)" as const,
    };

    let settled = false;
    const result = executeCommandAsync(command, commandContext("document", () => true, "edit"))
      .then((value) => {
        settled = true;
        return value;
      });

    await Promise.resolve();
    expect(execute).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    release();
    await expect(result).resolves.toBe(true);
  });

  it("does not invoke a disabled command", async () => {
    const execute = vi.fn();
    const command: Command<CommandParam> = {
      id: "test.disabled",
      domain: "artifact:document",
      title: "Disabled test",
      icon: Circle,
      description: "",
      availability: () => ({ state: "disabled" as const, reason: "No" }),
      execute: (_ctx, _params) => execute(),
      presentation: { kind: "button", compact: {}, medium: {} },
      defaultPlacement: { tab: "General", group: "", order: 0 },
      priority: "essential",
      risk: "safe" as const,
      undo: "none(explain)" as const,
    };

    await expect(
      executeCommandAsync(command, commandContext("document", () => true, "edit")),
    ).resolves.toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});
