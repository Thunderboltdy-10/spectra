import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { nextUnusedInstance } from "./fresh-instance.mjs";
import { createRunState, updateCard, cardIds } from "./run-state.mjs";
import { captureTree, compareTrees } from "./tree-integrity.mjs";
import {
  aggregateCompletions,
  evaluateBudget,
  parseCompletionLine,
} from "./convex-window.mjs";

const root = resolve(import.meta.dirname, "playwright");
const browserScripts = [
  "install-observers.mjs",
  "reset-window.mjs",
  "checkpoint.mjs",
  "perception-audit.mjs",
  "style-fidelity.mjs",
  "follow-disengage.mjs",
  "artifact-close.mjs",
  "onboarding-contract.mjs",
  "copy-audit.mjs",
  "timed-sequence.mjs",
  "network-fault.mjs",
  "clear-network-faults.mjs",
];

describe("P8.V1 final-verification foundation", () => {
  it("keeps every browser helper as one playwright-cli function expression", async () => {
    for (const filename of browserScripts) {
      const source = await readFile(resolve(root, filename), "utf8");
      const value = Function(`"use strict"; return (${source});`)();
      expect(typeof value, filename).toBe("function");
    }
  });

  it("creates one resumable ledger and protects passed cards", () => {
    const state = createRunState({
      instance: 4,
      commit: "abc123",
      now: "2026-09-03T00:00:00.000Z",
    });
    expect(Object.keys(state.cards)).toEqual(cardIds);
    updateCard(state, {
      card: "C4",
      status: "passed",
      evidence: "browser/c4.png",
    });
    expect(() => updateCard(state, { card: "C4", status: "running" })).toThrow(
      /already passed/i,
    );
    updateCard(state, { card: "C4", status: "running", reopen: true });
    expect(state.cards.C4.status).toBe("running");
  });

  it("chooses a new database id without deleting or reusing one", () => {
    expect(nextUnusedInstance([1, 2, 4, 9])).toBe(3);
    expect(nextUnusedInstance([])).toBe(1);
  });

  it("parses only sanitized Convex completion usage and fails real budgets", () => {
    const line = JSON.stringify({
      kind: "Completion",
      identifier: "collaborationGatewayBridge:exchange",
      caller: "WebSocket",
      timestamp: 100,
      cachedResult: false,
      executionTime: 0.1,
      returnBytes: 12,
      usageStats: {
        databaseReadBytes: 20_000,
        databaseIoWriteBytes: 0,
        databaseReadDocuments: 2,
        networkEgressBytes: 10_000,
        memoryUsedMb: 128,
      },
      args: { privateStudentContent: "must never survive" },
    });
    const event = parseCompletionLine(line);
    expect(event).not.toHaveProperty("args");
    expect(event.usage.databaseIoReadBytes).toBe(20_000);
    const report = aggregateCompletions(
      Array.from({ length: 12 }, () => event),
      {
        seconds: 60,
        profile: "collaboration",
      },
    );
    const result = evaluateBudget(report);
    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.label)).toContain(
      "Bridge exchanges/min",
    );
  });

  it("compares a tree without treating unchanged locked files as edits", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "spectra-p8-integrity-"));
    try {
      await writeFile(join(root, "same.txt"), "same", "utf8");
      const before = await captureTree(root);
      const after = await captureTree(root);
      expect(compareTrees(before, after)).toMatchObject({
        pass: true,
        modified: [],
        removed: [],
        added: [],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
