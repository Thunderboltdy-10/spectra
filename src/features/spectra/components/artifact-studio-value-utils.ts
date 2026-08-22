export function tagsFromDraft(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export type ReconciliationSnapshot = {
  title: string;
  summary: string;
  tagDraft: string;
  content: unknown;
};

export function reconciliationSnapshotKey(snapshot: ReconciliationSnapshot) {
  return JSON.stringify(snapshot);
}

export function incomingReconciliationKey(
  artifactId: string,
  snapshot: ReconciliationSnapshot,
) {
  return `${artifactId}\u0000${reconciliationSnapshotKey(snapshot)}`;
}
