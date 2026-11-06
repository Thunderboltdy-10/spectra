import type { MemoryHead } from "../../../../../../shared/memory-files";
import { DEFAULT_PERMISSION_PREFS, readPermissionPrefs, type PermissionPrefs } from "@/features/spectra/ai/harness/permissions";
import type { EnvironmentInput, EnvironmentPlace, EnvironmentPointer, EnvironmentRecentWork } from "@/features/spectra/ai/harness/prompt";
import { notesMessage } from "@/features/spectra/ai/harness/compaction";
import type { HarnessContentPart, HarnessMessage } from "@/features/spectra/ai/harness/types";
import type { PreparedAttachment, RunPointers } from "./contract";
import { rows } from "./effects";
import { query } from "./io";

/*
 * What Spectra knows at the start of a run: who the user is, where they are,
 * what is open and what they pointed at (titles, summaries and what each is
 * about, never content), their Bridge and permission choices, a short index
 * of what they asked Spectra to remember, and this thread's past: its running
 * notes and recent turns. Nothing about the content on screen is injected:
 * the model searches and reads. Every read is best effort and they all run
 * in parallel: missing context never fails a run.
 */

const HISTORY_MESSAGES = 80;
const HISTORY_MESSAGE_CHARS = 8_000;
const ATTACHMENT_TEXT_CHARS = 60_000;
const POINTERS = 12;
const SELECTION_CHARS = 1_000;
/** A Bridge seen this recently is treated as online. */
const BRIDGE_ONLINE_MS = 5 * 60_000;
/** The most recently active workspaces named to the model as places to file work. */
const PLACES = 24;

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function validTimeZone(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value.trim() });
    return value.trim();
  } catch {
    return undefined;
  }
}

function pointer(value: unknown): EnvironmentPointer | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = text(row.id).trim().slice(0, 160);
  const type = text(row.type).trim().slice(0, 40);
  if (!id || !type) return null;
  return { id, type, title: text(row.title).replace(/\s+/g, " ").trim().slice(0, 160) || "Untitled" };
}

function pointers(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: EnvironmentPointer[] = [];
  for (const entry of value) {
    const item = pointer(entry);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
    if (result.length >= POINTERS) break;
  }
  return result;
}

/**
 * The client's pointers, bounded and normalised. They are labels, never
 * permissions: every read and write still checks access on the server.
 */
export function normalizePointers(value: unknown): RunPointers {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const open = pointers(source.open);
  const references = pointers(source.references);
  const selectionRow = source.selection && typeof source.selection === "object" ? (source.selection as Record<string, unknown>) : null;
  const selectionText = text(selectionRow?.text).trim();
  const selectionIn = pointer(selectionRow?.in);
  const currentView = text(source.currentView).trim().slice(0, 200);
  return {
    ...(currentView ? { currentView } : {}),
    ...(open.length ? { open } : {}),
    ...(references.length ? { references } : {}),
    ...(selectionText
      ? {
          selection: {
            text: selectionText.length > SELECTION_CHARS ? `${selectionText.slice(0, SELECTION_CHARS)}…` : selectionText,
            ...(selectionIn ? { in: selectionIn } : {}),
          },
        }
      : {}),
  };
}

export type RunPreferences = {
  permissions: PermissionPrefs;
  runtime: { provider: unknown; model?: string; reasoning?: "medium" | "high" };
};

/** The account's settings a run obeys: one read for all of them. */
export async function readRunPreferences(actorClerkId: string): Promise<RunPreferences> {
  const layers = await query<unknown & object, Array<{ scope: string; values: unknown }> | null>("accountPreferences:layers", {
    actorClerkId,
    deviceId: "spectra-ai-harness",
  }).catch(() => null);
  const account = (layers ?? []).find((layer) => layer.scope === "account");
  const values = account?.values && typeof account.values === "object" ? (account.values as Record<string, unknown>) : {};
  const ai = values.ai && typeof values.ai === "object" ? (values.ai as Record<string, unknown>) : {};
  const provider = ai.runtime === "codex" || ai.runtime === "claude" ? ai.runtime : "spectra";
  const model = provider === "codex" ? ai.codexModel : provider === "claude" ? ai.claudeModel : undefined;
  return {
    permissions: layers ? readPermissionPrefs(values.ai) : DEFAULT_PERMISSION_PREFS,
    runtime: {
      provider,
      ...(typeof model === "string" && model ? { model } : {}),
      ...(ai.thinking === "medium" || ai.thinking === "high" ? { reasoning: ai.thinking } : {}),
    },
  };
}

/** This thread's earlier turns, oldest first. Never another thread's. */
export type ThreadHistory = {
  /** What the model replays: the thread's notes, then its recent messages. */
  messages: HarnessMessage[];
  notes?: string;
  /** The messages after the notes, oldest first, for folding once the run is done. */
  unfolded: Array<HarnessMessage & { createdAt: number }>;
};

export const EMPTY_HISTORY: ThreadHistory = { messages: [], unfolded: [] };

export async function readThreadHistory(actorClerkId: string, threadId: string | undefined, runId: string): Promise<ThreadHistory> {
  if (!threadId) return EMPTY_HISTORY;
  const page = await query<unknown & object, { notes?: unknown; messages?: unknown } | null>("spectraThreads:agentHistory", {
    actorClerkId,
    threadId,
    limit: HISTORY_MESSAGES,
  }).catch(() => null);
  const unfolded: ThreadHistory["unfolded"] = [];
  for (const message of rows(page?.messages)) {
    if (String(message.runId ?? "") === runId) continue;
    const role = message.role === "assistant" ? "assistant" : message.role === "user" ? "user" : null;
    const content = text(message.content).trim();
    if (!role || !content) continue;
    const clipped = content.length > HISTORY_MESSAGE_CHARS ? `${content.slice(0, HISTORY_MESSAGE_CHARS)}…` : content;
    unfolded.push({ role, content: clipped, createdAt: typeof message.createdAt === "number" ? message.createdAt : 0 });
  }
  const notes = text(page?.notes).trim() || undefined;
  const replay = unfolded.map(({ role, content }) => ({ role, content }) as HarnessMessage);
  return { messages: notes ? [notesMessage(notes), ...replay] : replay, unfolded, ...(notes ? { notes } : {}) };
}

/** Attachments as model content parts: images and PDFs natively, the rest as text. */
export function attachmentParts(attachments: PreparedAttachment[] | undefined): HarnessContentPart[] {
  const parts: HarnessContentPart[] = [];
  for (const attachment of attachments ?? []) {
    const data = attachment.data?.trim();
    const dataUrl = data ? (data.startsWith("data:") ? data : `data:${attachment.mimeType};base64,${data}`) : "";
    if (attachment.handling === "image" && dataUrl) {
      parts.push({ type: "image_url", image_url: { url: dataUrl } });
      continue;
    }
    const extracted = attachment.extractedText?.trim();
    if (extracted) {
      parts.push({
        type: "text",
        text: `Attached file "${attachment.name}":\n${extracted.length > ATTACHMENT_TEXT_CHARS ? `${extracted.slice(0, ATTACHMENT_TEXT_CHARS)}\n… (cut short)` : extracted}`,
      });
      continue;
    }
    if (attachment.handling === "pdf" && dataUrl) parts.push({ type: "file", file: { filename: attachment.name, file_data: dataUrl } });
    else if (typeof attachment.extractedText === "string") parts.push({ type: "text", text: `Attached file "${attachment.name}" was read and has no text in it.` });
    else parts.push({ type: "text", text: `Attached file "${attachment.name}" could not be read.` });
  }
  return parts;
}

/** What is always loaded of Spectra's notes about the user. One small read. */
export async function readMemoryHead(actorClerkId: string): Promise<MemoryHead> {
  const head = await query<unknown & object, MemoryHead>("spectraMemory:head", { actorClerkId }).catch(() => null);
  return head ?? { enabled: false, about: "", preferences: "", topics: [] };
}

export async function readBridgeStatus(actorClerkId: string, now: number) {
  const devices = await query<unknown & object, unknown>("bridge:devices", { actorClerkId }).catch(() => null);
  if (!Array.isArray(devices)) return undefined;
  const paired = rows(devices);
  if (!paired.length) return "not set up";
  const online = paired.filter((device) => typeof device.lastSeenAt === "number" && now - device.lastSeenAt < BRIDGE_ONLINE_MS);
  const names = (online.length ? online : paired).map((device) => text(device.name).trim() || "a computer").slice(0, 3);
  return `${online.length ? "online" : "offline"} (${names.join(", ")})`;
}

/**
 * The user's workspaces (their classes and projects), most active first, so
 * Spectra can file a work or a conversation where it belongs without a search.
 */
export async function readPlaces(actorClerkId: string, hereId?: string) {
  const workspaces = await query<unknown & object, unknown>("spectraWorkspaces:list", { actorClerkId, limit: PLACES }).catch(() => null);
  if (!Array.isArray(workspaces)) return { places: [] as EnvironmentPlace[] };
  const places = rows(workspaces)
    .filter((workspace) => workspace.accessLevel === "modify")
    .map((workspace) => ({
      id: String(workspace._id),
      title: text(workspace.title).trim().slice(0, 120) || "Untitled",
      // A class is marked by the student, or by coming from one of their ManageBac classes.
      ...((typeof workspace.isClass === "boolean" ? workspace.isClass : workspace.starterKey === "managebac-class") ? { isClass: true } : {}),
    }));
  const here = hereId ? places.find((place) => place.id === hereId) : undefined;
  return { places, ...(here ? { here } : {}) };
}

export type EnvironmentRequest = RunPointers & {
  actorClerkId: string;
  surface?: string;
  /** The workspace this conversation belongs to, when it has one. */
  workspaceId?: string;
  attachments?: PreparedAttachment[];
  now?: number;
};

/**
 * A line about each pointed-at work: its summary and what it is about in
 * words, from its index. Never its content: the model reads what it needs.
 */
async function describePointers(actorClerkId: string, items: EnvironmentPointer[]) {
  if (!items.length) return items;
  const described = await query<unknown & object, Array<{ id: string; summary?: string; about?: string }> | null>(
    "spectraArtifacts:describeForAgent",
    { actorClerkId, artifactIds: [...new Set(items.map((item) => item.id))] },
  ).catch(() => null);
  if (!Array.isArray(described)) return items;
  const byId = new Map(described.map((entry) => [entry.id, entry]));
  return items.map((item) => {
    const entry = byId.get(item.id);
    return entry
      ? { ...item, ...(entry.summary ? { summary: entry.summary } : {}), ...(entry.about ? { about: entry.about } : {}) }
      : item;
  });
}

/** What the user worked on last, so a request that names one of these needs no search. */
async function readRecentWorks(actorClerkId: string): Promise<EnvironmentRecentWork[]> {
  const page = await query<unknown & object, { page?: unknown } | null>("orgTree:quickViewPage", {
    actorClerkId,
    view: "recent",
    kinds: ["work"],
    paginationOpts: { numItems: 12, cursor: null },
  }).catch(() => null);
  const rows = Array.isArray(page?.page) ? (page.page as Array<Record<string, unknown>>) : [];
  return rows.flatMap((row) => {
    const id = text(row.sourceId);
    if (!id) return [];
    const path = Array.isArray(row.parentPath) ? row.parentPath.filter((entry): entry is string => typeof entry === "string") : [];
    return [{ id, type: text(row.typeKey), title: text(row.name) || "Untitled", ...(path.length ? { location: path.join(" / ") } : {}) }];
  });
}

export async function buildEnvironment(request: EnvironmentRequest): Promise<Omit<EnvironmentInput, "permissions" | "timeZone">> {
  const now = request.now ?? Date.now();
  const pointed = [...(request.open ?? []), ...(request.references ?? [])];
  const [me, memory, bridge, places, described, recent] = await Promise.all([
    query<unknown & object, { name?: string; schoolRole?: string } | null>("identity:me", {
      actorClerkId: request.actorClerkId,
    }).catch(() => null),
    readMemoryHead(request.actorClerkId),
    readBridgeStatus(request.actorClerkId, now),
    readPlaces(request.actorClerkId, request.workspaceId),
    describePointers(request.actorClerkId, pointed),
    readRecentWorks(request.actorClerkId),
  ]);
  const describedById = new Map(described.map((item) => [item.id, item]));
  const withDescription = (items: EnvironmentPointer[] | undefined) =>
    (items ?? []).map((item) => describedById.get(item.id) ?? item);
  const first = request.open?.[0];
  const page =
    text(request.currentView).trim().slice(0, 200) ||
    (first ? `Editing ${first.type} "${first.title}"` : request.surface === "workspace" ? "Workspace" : "Chat");
  return {
    now,
    ...(me ? { user: { ...(me.name ? { name: me.name } : {}), ...(me.schoolRole ? { role: me.schoolRole } : {}) } } : {}),
    page,
    ...(request.open?.length ? { open: withDescription(request.open) } : {}),
    ...(request.selection ? { selection: request.selection } : {}),
    ...(request.references?.length ? { references: withDescription(request.references) } : {}),
    ...(bridge ? { bridge } : {}),
    ...(recent.length ? { recent } : {}),
    ...(places.places.length ? { places: places.places } : {}),
    ...(places.here ? { here: places.here } : {}),
    ...(memory.about || memory.preferences || memory.topics.length ? { memory } : {}),
    ...(request.attachments?.length ? { attachments: request.attachments.map((attachment) => attachment.name) } : {}),
  };
}
