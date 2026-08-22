import { describe, expect, it } from "vitest";
import {
  incomingReconciliationKey,
  reconciliationSnapshotKey,
} from "../components/artifact-studio-value-utils";

const snapshot = {
  title: "Pendulum notes",
  summary: "",
  tagDraft: "physics",
  content: { type: "doc", content: [] },
};

describe("artifact reconciliation identity", () => {
  it("treats equivalent incoming projections as one reconciliation", () => {
    const recreated = { ...snapshot, content: { type: "doc", content: [] } };
    expect(reconciliationSnapshotKey(recreated)).toBe(
      reconciliationSnapshotKey(snapshot),
    );
    expect(incomingReconciliationKey("work-1", recreated)).toBe(
      incomingReconciliationKey("work-1", snapshot),
    );
  });

  it("reconciles changed content and the same value on another artifact", () => {
    expect(
      incomingReconciliationKey("work-1", {
        ...snapshot,
        content: { type: "doc", content: [{ type: "paragraph" }] },
      }),
    ).not.toBe(incomingReconciliationKey("work-1", snapshot));
    expect(incomingReconciliationKey("work-2", snapshot)).not.toBe(
      incomingReconciliationKey("work-1", snapshot),
    );
  });
});
