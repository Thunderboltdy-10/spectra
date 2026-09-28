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

  it("does not certify missing, invalid, partial, or empty usage as zero cost", () => {
    const missing = parseCompletionLine(JSON.stringify({ kind: "Completion", identifier: "test:query", usageStats: { databaseReadBytes: -1 } }));
    expect(missing.usage.databaseIoReadBytes).toBeNull();
    expect(missing.usage.databaseIoWriteBytes).toBeNull();
    expect(missing.returnBytes).toBeNull();
    expect(evaluateBudget(aggregateCompletions([missing], { seconds: 60, profile: "action" })))
      .toMatchObject({ passed: false, status: "unobserved" });
    expect(evaluateBudget(aggregateCompletions([], { seconds: 60, profile: "idle" })))
      .toMatchObject({ passed: false, status: "unobserved" });
    const measured = parseCompletionLine(JSON.stringify({ kind: "Completion", identifier: "test:query", caller: "WebSocket", returnBytes: 4,
      usageStats: { databaseReadBytes: 200, databaseIoWriteBytes: 0, networkEgressBytes: 4 } }));
    const mixed = aggregateCompletions([measured, missing], { seconds: 60, profile: "action" });
    expect(mixed.totals.nonCronDatabaseIoBytes).toBeNull();
    expect(mixed.coverage.databaseIoReadBytes).toEqual({ observedEvents: 1, totalEvents: 2 });
    expect(evaluateBudget(aggregateCompletions([measured], { seconds: 60, profile: "action", capture: { complete: false } })))
      .toMatchObject({ passed: false, status: "unobserved" });
    expect(evaluateBudget(aggregateCompletions([measured], { seconds: 60, profile: "action" })))
      .toMatchObject({ passed: true, status: "passed" });
    expect(evaluateBudget(aggregateCompletions([measured], { seconds: 60, profile: "scheduled" })))
      .toMatchObject({ passed: false, status: "unobserved" });
  });

  it("counts socket/query lifecycle across windows and observes ready transitions without retaining args", async () => {
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM("<main></main>", { runScripts: "outside-only", pretendToBeVisual: true });
    const observers = [];
    const NativeObserver = dom.window.MutationObserver;
    dom.window.MutationObserver = class extends NativeObserver {
      constructor(callback) { super(callback); observers.push(this); }
    };
    try {
      dom.window.TextEncoder = TextEncoder;
      dom.window.performance.clearResourceTimings = () => {};
      dom.window.eval(`window.WebSocket = class extends EventTarget {
        send() {} open() { this.dispatchEvent(new Event('open')); }
        close() { this.dispatchEvent(new Event('close')); }
      };`);
      const install = Function(`return (${await readFile(resolve(root, "install-observers.mjs"), "utf8")});`)();
      let initArgument;
      const page = { on() {}, async addInitScript(_fn, arg) { initArgument = arg; },
        async evaluate(fn, arg) { return dom.window.eval(`(${fn})(${JSON.stringify(arg)})`); }, url: () => "about:blank" };
      await install(page);
      dom.window.eval(`window.socket = new WebSocket(); socket.open(); socket.send(JSON.stringify({ type: 'ModifyQuerySet', modifications: [{ type: 'Add', queryId: 1, udfPath: 'orgTree:listChildren', args: { private: 'NEVER_RETAIN' } }] }));`);
      const state = dom.window.__spectraP8;
      expect(initArgument).toBe(true);
      expect(state.installedBeforeApp).toBe(false);
      expect(state.socketLifecycle.active).toBe(1);
      expect(state.convexQueries.active).toBe(1);
      expect(state.convexQueries.byFunction["orgTree:listChildren"]).toEqual({ added: 1, removed: 0, active: 1, peak: 1 });
      state.reset();
      expect(state.convexQueries).toMatchObject({ added: 0, active: 1, peak: 1 });
      expect(state.convexQueries.byFunction["orgTree:listChildren"]).toEqual({ added: 0, removed: 0, active: 1, peak: 1 });
      dom.window.eval(`socket.send(JSON.stringify({ type: 'ModifyQuerySet', modifications: [{ type: 'Remove', queryId: 1 }] })); socket.close();`);
      expect(state.convexQueries).toMatchObject({ removed: 1, active: 0 });
      expect(state.convexQueries.byFunction["orgTree:listChildren"]).toEqual({ added: 0, removed: 1, active: 0, peak: 1 });
      expect(state.socketLifecycle.active).toBe(0);
      const node = dom.window.document.querySelector("main");
      node.setAttribute("data-spectra-studio", "fixture-a");
      node.setAttribute("data-spectra-editor-ready", "true");
      await new Promise((done) => setTimeout(done, 0));
      node.setAttribute("data-spectra-studio", "fixture-b");
      await new Promise((done) => setTimeout(done, 0));
      expect(state.editorReadiness.map((event) => event.artifactId)).toEqual(["fixture-a", "fixture-b"]);
      expect(JSON.stringify(state)).not.toContain("NEVER_RETAIN");
    } finally { for (const observer of observers) observer.disconnect(); dom.window.close(); }
  });
});
