// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACCOUNT_SCOPE_KEY } from "@/lib/account-storage-scope";
import type { SchoolTask } from "../school-model";
import { isKeptRecordId, keepPastTasks, keptTaskKey, keptTasksMissingFrom, readKeptTasks } from "../past-task-shelf";

const day = 24 * 60 * 60_000;
const now = Date.parse("2026-11-15T12:00:00Z");

function task(title: string, past: boolean, dueAt: number, providerClassId = "101"): SchoolTask {
  return {
    recordId: `record-${title}` as SchoolTask["recordId"],
    title, providerClassId, className: "Physics", dueAt, status: "Submitted", taskType: null, term: "Term 1",
    past, sourceState: "available", provenanceUrl: null,
  };
}

beforeEach(() => window.localStorage.setItem(ACCOUNT_SCOPE_KEY, "account-a"));
afterEach(() => window.localStorage.clear());

describe("past task shelf", () => {
  it("keeps the past tasks this device showed, per account, and shows them once the server lets them go", () => {
    const old = task("Lab report", true, now - 30 * day);
    const recent = task("Essay", true, now - 9 * day);
    keepPastTasks([old, recent, task("Due soon", false, now + day)], now);
    expect(readKeptTasks(now).map((row) => row.title).sort()).toEqual(["Essay", "Lab report"]);

    // The server now keeps only the recent one: the older one comes from the shelf.
    const shown = keptTasksMissingFrom(readKeptTasks(now), [recent], { matches: () => true });
    expect(shown.map((row) => row.title)).toEqual(["Lab report"]);
    expect(isKeptRecordId(shown[0]!.recordId)).toBe(true);
    expect(keptTasksMissingFrom(readKeptTasks(now), [recent], { providerClassId: "202", matches: () => true })).toEqual([]);

    // Another account on this device sees none of it.
    window.localStorage.setItem(ACCOUNT_SCOPE_KEY, "account-b");
    expect(readKeptTasks(now)).toEqual([]);
  });

  it("does not rewrite storage for an unchanged task, and drops copies after a year", () => {
    const old = task("Lab report", true, now - 30 * day);
    expect(keepPastTasks([old], now)).not.toBeNull();
    expect(keepPastTasks([old], now + 60_000)).toBeNull();
    expect(readKeptTasks(now + 366 * day)).toEqual([]);
    expect(keptTaskKey(old)).toBe(`101|${now - 30 * day}|Lab report`);
  });
});
