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

/**
 * TipTap wraps plain strings as `<p>…</p>` during hydration. Writing that echo
 * back through onChange marks the studio dirty and turns the first Yjs/Convex
 * ack into a false remote-conflict banner (seen on brand-new Quiz create).
 */
export function richTextValuesEquivalent(committed: string, nextHtml: string) {
  const next = nextHtml === "<p></p>" ? "" : nextHtml;
  const left = committed.trim();
  const right = next.trim();
  if (left === right) return true;
  const unwrap = (value: string) =>
    value
      .replace(/^<p>([\s\S]*)<\/p>$/i, "$1")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();
  if (!/^</.test(left) && unwrap(right) === left) return true;
  if (!/^</.test(right) && unwrap(left) === right) return true;
  return false;
}

export function shouldEmitRichTextChange(input: {
  committedValue: string;
  nextHtml: string;
  typedWhileFocused: boolean;
}) {
  if (!input.typedWhileFocused) return false;
  return !richTextValuesEquivalent(input.committedValue, input.nextHtml);
}

export type RemoteStudioIncomingDecision =
  | "ignore"
  | "accept-local-sync"
  | "accept-bootstrap"
  | "rebase"
  | "conflict";

/**
 * Decide how an incoming collaborative snapshot should meet a dirty studio.
 * Bootstrap/normalize echoes can flip the dirty bit without a human edit; those
 * must never raise the yellow remote-conflict banner.
 */
export function decideRemoteStudioIncoming(input: {
  dirty: boolean;
  userHasEdited: boolean;
  incomingKey: string;
  baselineKey: string;
  dismissedRemoteKey: string | null;
  isLocalSyncKey: boolean;
  isCollaborative: boolean;
  nativeOfficeDocument: boolean;
}): RemoteStudioIncomingDecision {
  if (!input.dirty) return "accept-bootstrap";
  if (
    input.incomingKey === input.baselineKey ||
    input.incomingKey === input.dismissedRemoteKey
  ) {
    return "ignore";
  }
  if (input.isLocalSyncKey) return "accept-local-sync";
  if (!input.userHasEdited) return "accept-bootstrap";
  if (input.nativeOfficeDocument) return "ignore";
  if (input.isCollaborative) return "rebase";
  return "conflict";
}
