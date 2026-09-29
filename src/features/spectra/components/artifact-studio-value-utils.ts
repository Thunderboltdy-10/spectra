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

function jsonPointerSegments(path: string) {
  return path === "/"
    ? []
    : path
        .split("/")
        .slice(1)
        .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * `target` with each JSON pointer set to (a clone of) its value, applied in
 * order. Only the containers on a patched path are copied, once each; every
 * other subtree is shared with `target`, which is never modified.
 *
 * This runs on every AI streaming frame and every peer speculation frame.
 * Deep-cloning the whole artifact once per patch cost ~80 ms a frame on a
 * 1,000-object whiteboard. It also threw DataCloneError on a sheet holding a
 * cell overlay (a Proxy), and it gave every unchanged item a new identity.
 */
export function setAtPointers(
  target: unknown,
  patches: Iterable<readonly [path: string, value: unknown]>,
): unknown {
  const owned = new WeakSet<object>();
  const own = (value: object) => {
    const copy: object = Array.isArray(value)
      ? [...(value as unknown[])]
      : { ...value };
    owned.add(copy);
    return copy;
  };
  let root = target;
  for (const [path, value] of patches) {
    const segments = jsonPointerSegments(path);
    const replacement = structuredClone(value);
    if (segments.length === 0) {
      root = replacement;
      if (replacement && typeof replacement === "object") owned.add(replacement);
      continue;
    }
    if (!root || typeof root !== "object") {
      root = {};
      owned.add(root as object);
    } else if (!owned.has(root)) root = own(root);
    let current = root as Record<string, unknown>;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index]!;
      const existing = current[segment];
      let child: object;
      if (existing && typeof existing === "object")
        child = owned.has(existing) ? existing : own(existing);
      else {
        child = /^\d+$/.test(segments[index + 1]!) ? [] : {};
        owned.add(child);
      }
      current[segment] = child;
      current = child as Record<string, unknown>;
    }
    current[segments.at(-1)!] = replacement;
  }
  return root;
}

/**
 * A studio remembers the serialized values of its own recent writes so their
 * live echo is accepted as local. A save whose echo never arrives verbatim
 * (the room normalized the draft: trimmed summary, re-spaced tags, reordered
 * cells) left its key behind forever. Each key is the whole artifact as JSON,
 * so a long session on a large sheet retained megabytes per save. Only one
 * save is in flight at a time, so a few recent keys cover every echo.
 */
export const LOCAL_SYNC_KEY_LIMIT = 8;

export function rememberLocalSyncKey(
  keys: Set<string>,
  key: string,
  limit = LOCAL_SYNC_KEY_LIMIT,
) {
  keys.delete(key);
  keys.add(key);
  for (const oldest of keys) {
    if (keys.size <= limit) break;
    keys.delete(oldest);
  }
}

/** Scoped to one editor; only immutable React snapshots may be used as keys. */
export function createReconciliationSnapshotKey() {
  const keys = new WeakMap<ReconciliationSnapshot, string>();
  return (snapshot: ReconciliationSnapshot) => {
    let key = keys.get(snapshot);
    if (key === undefined) {
      key = reconciliationSnapshotKey(snapshot);
      keys.set(snapshot, key);
    }
    return key;
  };
}

export function incomingReconciliationKey(
  artifactId: string,
  snapshot: ReconciliationSnapshot,
  provenance?: { source: StudioIncomingSource; revision: number; localSync: boolean },
  serializedSnapshot = reconciliationSnapshotKey(snapshot),
) {
  return `${artifactId}\u0000${serializedSnapshot}${
    provenance ? `\u0000${JSON.stringify(provenance)}` : ""
  }`;
}

export type StudioIncomingSource = "provisional" | "live" | "persisted" | "stale";

/** A content projection is not proof of a new write; the room or saved revision is. */
export function studioIncomingSource(input: {
  liveValueSource: "provisional" | "live" | "persisted";
  revision: number;
  initialRevision: number;
  latestRevision: number;
  hasAcceptedLiveValue: boolean;
}): StudioIncomingSource {
  if (input.liveValueSource !== "persisted") return input.liveValueSource;
  if (
    input.revision < input.latestRevision ||
    (input.hasAcceptedLiveValue && input.revision <= input.latestRevision)
  ) return "stale";
  return input.revision > input.initialRevision ? "persisted" : "provisional";
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


/**
 * Heuristic for provisional bootstrap content only. This is not a validity
 * check: short text, nontext slides and deliberate clears are valid edits.
 * Shape is sniffed from the payload (call sites do not always have typeKey).
 */
function asStudioRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function studioContentLooksHollow(content: unknown) {
  if (!content || typeof content !== "object" || Array.isArray(content))
    return true;
  const record = content as Record<string, unknown>;

  const blocks = Array.isArray(record.blocks) ? record.blocks : null;
  if (blocks) {
    return !blocks.some((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block))
        return false;
      const row = block as Record<string, unknown>;
      return (
        (typeof row.text === "string" && row.text.trim().length >= 8) ||
        (typeof row.latex === "string" && row.latex.trim().length >= 4)
      );
    });
  }

  const questions = Array.isArray(record.questions) ? record.questions : null;
  if (questions) {
    return !questions.some((question) => {
      if (!question || typeof question !== "object" || Array.isArray(question))
        return false;
      const row = question as Record<string, unknown>;
      return (
        (typeof row.prompt === "string" && row.prompt.trim().length > 0) ||
        (typeof row.stem === "string" && row.stem.trim().length > 0)
      );
    });
  }

  const cards = Array.isArray(record.cards) ? record.cards : null;
  if (cards) {
    return !cards.some((card) => {
      if (!card || typeof card !== "object" || Array.isArray(card)) return false;
      const row = card as Record<string, unknown>;
      return (
        typeof row.front === "string" &&
        row.front.trim().length > 0 &&
        typeof row.back === "string" &&
        row.back.trim().length > 0
      );
    });
  }

  const slides = Array.isArray(record.slides) ? record.slides : null;
  if (slides) {
    const placeholder =
      /^(?:add a clear idea|click to edit|title|subtitle|new slide)\s*$/i;
    return !slides.some((slide) => {
      if (!slide || typeof slide !== "object" || Array.isArray(slide))
        return false;
      const objects = Array.isArray((slide as Record<string, unknown>).objects)
        ? ((slide as Record<string, unknown>).objects as unknown[])
        : [];
      return objects.some((object) => {
        if (!object || typeof object !== "object" || Array.isArray(object))
          return false;
        const text = (object as Record<string, unknown>).text;
        const contentText = asStudioRecord(
          (object as Record<string, unknown>).content,
        ).text;
        const value =
          typeof text === "string"
            ? text.trim()
            : typeof contentText === "string"
              ? contentText.trim()
              : "";
        return value.length >= 8 && !placeholder.test(value);
      });
    });
  }

  const sheets = Array.isArray(record.sheets) ? record.sheets : null;
  if (sheets) {
    if (sheets.length === 0) return true;
    return !sheets.some((sheet) => {
      if (!sheet || typeof sheet !== "object" || Array.isArray(sheet))
        return false;
      const cells = asStudioRecord((sheet as Record<string, unknown>).cells);
      return Object.values(cells).some((cell) => {
        if (cell == null) return false;
        if (typeof cell === "string" || typeof cell === "number")
          return String(cell).trim().length > 0;
        if (typeof cell !== "object" || Array.isArray(cell)) return false;
        const row = cell as Record<string, unknown>;
        const value = row.value ?? row.input ?? row.text ?? row.formula;
        return value != null && String(value).trim().length > 0;
      });
    });
  }

  const nodes = Array.isArray(record.nodes) ? record.nodes : null;
  if (nodes) return nodes.length === 0;

  const events = Array.isArray(record.events) ? record.events : null;
  if (events) return events.length === 0;

  const files = Array.isArray(record.files) ? record.files : null;
  if (files) {
    if (files.length === 0) return true;
    return !files.some((file) => {
      if (!file || typeof file !== "object" || Array.isArray(file)) return false;
      const source =
        typeof (file as { source?: unknown }).source === "string"
          ? String((file as { source: string }).source).trim()
          : "";
      return (
        Boolean(source) &&
        !/^<main>\s*<\/main>$/i.test(source) &&
        !/^<(?:html|body|main|div)[^>]*>\s*<\/(?:html|body|main|div)>$/i.test(
          source,
        )
      );
    });
  }

  if ("description" in record || Array.isArray(record.subtasks)) {
    const description =
      typeof record.description === "string" ? record.description.trim() : "";
    const subtasks = Array.isArray(record.subtasks) ? record.subtasks : [];
    const titled = subtasks.filter(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as { title?: unknown }).title === "string" &&
        String((item as { title: string }).title).trim(),
    );
    return description.length < 8 && titled.length === 0;
  }

  if (record.instructions && typeof record.instructions === "object") {
    const text = asStudioRecord(record.instructions).text;
    return typeof text !== "string" || text.trim().length < 40;
  }

  // Unrecognized shapes without a studio discriminant: only an empty object is
  // treated as hollow. Non-empty unknown payloads stay non-hollow so custom /
  // transitional content is not silently classified as wipe-safe bootstrap.
  return Object.keys(record).length === 0;
}

export function shouldRejectHollowStudioIncoming(input: {
  currentContent: unknown;
  incomingContent: unknown;
  incomingSource: StudioIncomingSource;
}) {
  return (
    input.incomingSource === "provisional" &&
    !studioContentLooksHollow(input.currentContent) &&
    studioContentLooksHollow(input.incomingContent)
  );
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
  incomingSource: StudioIncomingSource;
  currentContent?: unknown;
  incomingContent?: unknown;
}): RemoteStudioIncomingDecision {
  if (input.incomingSource === "stale") return "ignore";
  // A local acknowledgement can intentionally contain a clear. It must meet
  // the pending write before any bootstrap/quality heuristic.
  if (input.isLocalSyncKey) return "accept-local-sync";
  if (
    input.currentContent !== undefined &&
    input.incomingContent !== undefined &&
    shouldRejectHollowStudioIncoming({
      currentContent: input.currentContent,
      incomingContent: input.incomingContent,
      incomingSource: input.incomingSource,
    })
  ) {
    return "ignore";
  }
  if (!input.dirty) return "accept-bootstrap";
  if (
    input.incomingKey === input.baselineKey ||
    input.incomingKey === input.dismissedRemoteKey
  ) {
    return "ignore";
  }
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
function studioItemId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function arrayItemsHaveStableIds(values: unknown[]) {
  if (values.length === 0) return true;
  const seen = new Set<string>();
  for (const item of values) {
    const id = studioItemId(item);
    if (!id || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/**
 * Identity-aware three-way merge for studio lists (blocks, questions, slides,
 * cards, nodes). Index-aligned merge falsely conflicts whenever a peer inserts
 * or deletes, dropping the remote change; keyed merge keeps disjoint edits.
 */
function rebaseKeyedCollaborativeArray(
  baseline: unknown[],
  local: unknown[],
  incoming: unknown[],
  path: string,
): { value: unknown[]; conflicts: string[] } {
  const baseById = new Map(
    baseline.map((item) => [studioItemId(item)!, item] as const),
  );
  const localById = new Map(
    local.map((item) => [studioItemId(item)!, item] as const),
  );
  const incomingById = new Map(
    incoming.map((item) => [studioItemId(item)!, item] as const),
  );
  const ids = new Set([
    ...baseById.keys(),
    ...localById.keys(),
    ...incomingById.keys(),
  ]);
  const selected = new Map<string, unknown>();
  const conflicts: string[] = [];

  for (const id of ids) {
    const ancestor = baseById.get(id);
    const ours = localById.get(id);
    const theirs = incomingById.get(id);
    const oursChanged = !studioValuesEqual(ours, ancestor);
    const theirsChanged = !studioValuesEqual(theirs, ancestor);

    if (oursChanged && theirsChanged && !studioValuesEqual(ours, theirs)) {
      if (
        ours !== undefined &&
        theirs !== undefined &&
        ancestor !== undefined
      ) {
        const nested = rebaseCollaborativeValue(
          ancestor,
          ours,
          theirs,
          `${path}/${id.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        );
        selected.set(id, nested.value);
        conflicts.push(...nested.conflicts);
        continue;
      }
      // delete-vs-edit: keep the local side and surface the collision.
      if (ours !== undefined) selected.set(id, ours);
      conflicts.push(
        `${path}/${id.replaceAll("~", "~0").replaceAll("/", "~1")}`,
      );
      continue;
    }

    const winner = oursChanged ? ours : theirsChanged ? theirs : ancestor;
    if (winner !== undefined) selected.set(id, winner);
  }

  const orderOf = (values: unknown[]) =>
    values
      .map((item) => studioItemId(item))
      .filter((id): id is string => Boolean(id));
  const baseOrder = orderOf(baseline);
  const localOrder = orderOf(local).filter((id) => selected.has(id));
  const incomingOrder = orderOf(incoming).filter((id) => selected.has(id));
  const baseSurvivors = baseOrder.filter((id) => selected.has(id));
  const baseSet = new Set(baseOrder);
  const localBackbone = localOrder.filter((id) => baseSet.has(id));
  const incomingBackbone = incomingOrder.filter((id) => baseSet.has(id));
  const localOrderChanged =
    JSON.stringify(localBackbone) !== JSON.stringify(baseSurvivors);
  const incomingOrderChanged =
    JSON.stringify(incomingBackbone) !== JSON.stringify(baseSurvivors);

  let order = baseSurvivors;
  if (
    localOrderChanged &&
    incomingOrderChanged &&
    JSON.stringify(localBackbone) !== JSON.stringify(incomingBackbone)
  ) {
    conflicts.push(`${path}/order`);
    order = localBackbone;
  } else if (localOrderChanged) {
    order = localBackbone;
  } else if (incomingOrderChanged) {
    order = incomingBackbone;
  }

  const weave = (source: readonly string[]) => {
    for (const id of source) {
      if (order.includes(id) || !selected.has(id)) continue;
      const sourceIndex = source.indexOf(id);
      const nextAnchor = source
        .slice(sourceIndex + 1)
        .find((candidate) => order.includes(candidate));
      if (nextAnchor) {
        order.splice(order.indexOf(nextAnchor), 0, id);
        continue;
      }
      const previousAnchor = source
        .slice(0, sourceIndex)
        .reverse()
        .find((candidate) => order.includes(candidate));
      if (previousAnchor) order.splice(order.indexOf(previousAnchor) + 1, 0, id);
      else order.push(id);
    }
  };
  weave(localOrder);
  weave(incomingOrder);
  weave([...selected.keys()]);

  return {
    value: order.flatMap((id) => {
      const value = selected.get(id);
      return value === undefined ? [] : [value];
    }),
    conflicts,
  };
}

function textSplice(before: string, after: string) {
  let start = 0;
  const limit = Math.min(before.length, after.length);
  while (start < limit && before[start] === after[start]) start += 1;
  let suffix = 0;
  while (
    suffix < before.length - start &&
    suffix < after.length - start &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix += 1;
  return {
    start,
    end: before.length - suffix,
    insert: after.slice(start, after.length - suffix),
  };
}

/**
 * Two people typing in different places of the same text field is ordinary
 * collaboration, not a conflict. Each side is one contiguous splice of the
 * shared ancestor; when the splices do not touch, both apply.
 */
export function mergeConcurrentText(
  baseline: string,
  local: string,
  incoming: string,
): string | null {
  const ours = textSplice(baseline, local);
  const theirs = textSplice(baseline, incoming);
  const [first, second] =
    ours.start <= theirs.start ? [ours, theirs] : [theirs, ours];
  if (first.end > second.start || (first.end === second.start && first.start === second.start))
    return null;
  return (
    baseline.slice(0, first.start) +
    first.insert +
    baseline.slice(first.end, second.start) +
    second.insert +
    baseline.slice(second.end)
  );
}

export function rebaseCollaborativeValue(
  baseline: unknown,
  local: unknown,
  incoming: unknown,
  path = "",
): { value: unknown; conflicts: string[] } {
  if (studioValuesEqual(local, baseline)) return { value: incoming, conflicts: [] };
  if (studioValuesEqual(incoming, baseline) || studioValuesEqual(local, incoming))
    return { value: local, conflicts: [] };

  if (
    typeof baseline === "string" &&
    typeof local === "string" &&
    typeof incoming === "string"
  ) {
    const merged = mergeConcurrentText(baseline, local, incoming);
    if (merged !== null) return { value: merged, conflicts: [] };
  }

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

  if (Array.isArray(local) && Array.isArray(incoming) && Array.isArray(baseline)) {
    if (
      arrayItemsHaveStableIds(local) &&
      arrayItemsHaveStableIds(incoming) &&
      arrayItemsHaveStableIds(baseline)
    ) {
      return rebaseKeyedCollaborativeArray(baseline, local, incoming, path || "/");
    }
    if (
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
  }

  // Unkeyed arrays with a shape change stay indivisible. Prefer local over
  // duplicating entries; surface the collision for explicit review.
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

/**
 * The body a structured studio writes into the live room. React holds the
 * draft; the room may already hold a collaborator's newer edit that React has
 * not absorbed yet (projection is coalesced and reconciliation runs a render
 * later). Writing the draft as-is would silently revert that edit, so the
 * draft's own changes since `baseline` are replayed onto the live value.
 */
export function draftContentForLiveWrite(input: {
  baseline: unknown;
  draft: unknown;
  live: unknown;
}) {
  if (input.live === undefined) return input.draft;
  return rebaseCollaborativeValue(input.baseline, input.draft, input.live).value;
}

/** One local edit a studio can undo: the value before and after it. */
export type StudioHistoryEntry<T> = { before: T; after: T };

/**
 * Undo or redo one local edit against the studio's *current* value. A studio
 * that restored its stored snapshot also restored every field a collaborator
 * (or the AI) changed since, silently reverting their work. Replaying only the
 * difference between the entry's two sides keeps everyone else's edits.
 */
export function applyStudioHistory<T>(
  entry: StudioHistoryEntry<T>,
  direction: "undo" | "redo",
  current: T,
): T {
  const [from, to] =
    direction === "undo" ? [entry.after, entry.before] : [entry.before, entry.after];
  return rebaseCollaborativeValue(from, to, current).value as T;
}

/**
 * A pointer gesture (drag, resize) previews on a local copy taken when it
 * began. Committing that copy would carry the whole stale value; commit the
 * gesture's own change onto the value that is current when it ends.
 */
export function commitStudioGesture<T>(origin: T, gesture: T, current: T): T {
  return rebaseCollaborativeValue(origin, gesture, current).value as T;
}

/**
 * An undo history for studios that have none of their own. Consecutive edits
 * that continue each other within `coalesceMs` form one step, so a typed word
 * undoes as a word rather than a keystroke. Steps replay through
 * `applyStudioHistory`, so collaborators' edits made in between survive.
 */
export function createStudioHistory<T>({
  limit = 80,
  coalesceMs = 800,
  now = () => Date.now(),
}: { limit?: number; coalesceMs?: number; now?: () => number } = {}) {
  let undoStack: StudioHistoryEntry<T>[] = [];
  let redoStack: StudioHistoryEntry<T>[] = [];
  let lastRecordedAt = Number.NEGATIVE_INFINITY;
  return {
    record(before: T, after: T) {
      if (studioValuesEqual(before, after)) return;
      const at = now();
      const last = undoStack[undoStack.length - 1];
      if (
        last &&
        at - lastRecordedAt < coalesceMs &&
        studioValuesEqual(last.after, before)
      ) {
        undoStack[undoStack.length - 1] = { before: last.before, after };
      } else {
        undoStack = [...undoStack.slice(-(limit - 1)), { before, after }];
      }
      lastRecordedAt = at;
      redoStack = [];
    },
    step(direction: "undo" | "redo", current: T): T | null {
      const from = direction === "undo" ? undoStack : redoStack;
      const entry = from.pop();
      if (!entry) return null;
      (direction === "undo" ? redoStack : undoStack).push(entry);
      lastRecordedAt = Number.NEGATIVE_INFINITY;
      return applyStudioHistory(entry, direction, current);
    },
    reset() {
      undoStack = [];
      redoStack = [];
      lastRecordedAt = Number.NEGATIVE_INFINITY;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
  };
}

/** Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y, outside any text field. */
export function studioHistoryShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const target = event.target as HTMLElement | null;
  // Text fields keep the browser's own text undo.
  if (
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable)
  )
    return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.shiftKey) return "redo";
  return null;
}
