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

export function studioValuesEqual(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

/**
 * Rebase an unsaved local draft over a newer collaborative snapshot.
 * Yjs normally makes both views converge before this boundary, but persisted
 * artifact refreshes can race a keystroke. Preserve the local side only where
 * it actually diverged from its baseline, accept remote-only edits, and report
 * the rare same-leaf collision instead of treating every refresh as a conflict.
 */
export function rebaseCollaborativeValue(
  baseline: unknown,
  local: unknown,
  incoming: unknown,
  path = "",
): { value: unknown; conflicts: string[] } {
  if (studioValuesEqual(local, baseline)) return { value: incoming, conflicts: [] };
  if (studioValuesEqual(incoming, baseline) || studioValuesEqual(local, incoming))
    return { value: local, conflicts: [] };

  const localRecord =
    local && typeof local === "object" && !Array.isArray(local)
      ? (local as Record<string, unknown>)
      : null;
  const incomingRecord =
    incoming && typeof incoming === "object" && !Array.isArray(incoming)
      ? (incoming as Record<string, unknown>)
      : null;
  const baselineRecord =
    baseline && typeof baseline === "object" && !Array.isArray(baseline)
      ? (baseline as Record<string, unknown>)
      : null;

  if (localRecord && incomingRecord && baselineRecord) {
    const value: Record<string, unknown> = {};
    const conflicts: string[] = [];
    const keys = new Set([
      ...Object.keys(baselineRecord),
      ...Object.keys(localRecord),
      ...Object.keys(incomingRecord),
    ]);
    for (const key of keys) {
      const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
      const merged = rebaseCollaborativeValue(
        baselineRecord[key],
        localRecord[key],
        incomingRecord[key],
        `${path}/${escaped}`,
      );
      if (merged.value !== undefined) value[key] = merged.value;
      conflicts.push(...merged.conflicts);
    }
    return { value, conflicts };
  }

  if (
    Array.isArray(local) &&
    Array.isArray(incoming) &&
    Array.isArray(baseline) &&
    local.length === incoming.length &&
    local.length === baseline.length
  ) {
    const value: unknown[] = [];
    const conflicts: string[] = [];
    for (let index = 0; index < local.length; index += 1) {
      const merged = rebaseCollaborativeValue(
        baseline[index],
        local[index],
        incoming[index],
        `${path}/${index}`,
      );
      value.push(merged.value);
      conflicts.push(...merged.conflicts);
    }
    return { value, conflicts };
  }

  // Arrays are indivisible only when their shape changed
  // (insert/reorder/delete). Region claims prevent normal same-list
  // contention; retaining local here is safer than duplicating entries.
  return { value: local, conflicts: [path || "/"] };
}

export function rebaseCollaborativeSnapshot<T extends Record<string, unknown>>(
  baseline: T,
  local: T,
  incoming: T,
) {
  const merged = rebaseCollaborativeValue(baseline, local, incoming);
  return {
    snapshot: merged.value as T,
    conflicts: merged.conflicts,
  };
}
