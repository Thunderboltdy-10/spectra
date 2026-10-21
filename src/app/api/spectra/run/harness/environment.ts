import { DEFAULT_PERMISSION_PREFS, readPermissionPrefs, type PermissionPrefs } from "@/features/spectra/ai/harness/permissions";
import type { EnvironmentInput, EnvironmentPlace, EnvironmentPointer } from "@/features/spectra/ai/harness/prompt";
import type { HarnessContentPart, HarnessMessage } from "@/features/spectra/ai/harness/types";
import type { PreparedAttachment, RunPointers } from "./contract";
import { rows } from "./effects";
import { query } from "./io";

/*
 * What Spectra knows at the start of a run: who the user is, where they are,
 * what is open and what they pointed at (ids, types and titles only), their
 * Bridge and permission choices, a short index of what they asked Spectra to
 * remember, and this thread's earlier turns. Nothing about the content on
 * screen is injected: the model searches and reads. Every read is best
 * effort and they all run in parallel: missing context never fails a run.
 */

const HISTORY_MESSAGES = 80;
const HISTORY_MESSAGE_CHARS = 8_000;
const ATTACHMENT_TEXT_CHARS = 60_000;
const MEMORY_INDEX_ENTRIES = 12;
const MEMORY_ENTRY_CHARS = 200;
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

export async function readPermissions(actorClerkId: string): Promise<PermissionPrefs> {
  const layers = await query<unknown & object, Array<{ scope: string; values: unknown }> | null>("accountPreferences:layers", {
    actorClerkId,
    deviceId: "spectra-ai-harness",
  }).catch(() => null);
  const account = (layers ?? []).find((layer) => layer.scope === "account");
  const values = account?.values && typeof account.values === "object" ? (account.values as Record<string, unknown>) : {};
  return layers ? readPermissionPrefs(values.ai) : DEFAULT_PERMISSION_PREFS;
}

/** This thread's earlier turns, oldest first. Never another thread's. */
export async function readThreadHistory(actorClerkId: string, threadId: string | undefined, runId: string) {
  if (!threadId) return [];
  const page = await query<unknown & object, { messages?: unknown }>("spectraThreads:listMessages", {
    actorClerkId,
    threadId,
    limit: HISTORY_MESSAGES,
  }).catch(() => ({ messages: [] }));
  const history: HarnessMessage[] = [];
  for (const message of rows(page.messages)) {
    if (String(message.runId ?? "") === runId) continue;
    const role = message.role === "assistant" ? "assistant" : message.role === "user" ? "user" : null;
    const content = text(message.content).trim();
    if (!role || !content) continue;
    const clipped = content.length > HISTORY_MESSAGE_CHARS ? `${content.slice(0, HISTORY_MESSAGE_CHARS)}…` : content;
    history.push(role === "assistant" ? { role, content: clipped } : { role, content: clipped });
  }
  return history;
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

/** A short, query-free index of what the user asked Spectra to remember. */
export async function readMemoryIndex(actorClerkId: string) {
  const listed = await query<unknown & object, { preferences?: { enabled?: boolean }; claims?: unknown } | null>("memory:listMine", {
    actorClerkId,
    status: "active",
    limit: MEMORY_INDEX_ENTRIES,
  }).catch(() => null);
  if (!listed || listed.preferences?.enabled === false) return [];
  return rows(listed.claims)
    .map((claim) => text(claim.proposition).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, MEMORY_INDEX_ENTRIES)
    .map((entry) => (entry.length > MEMORY_ENTRY_CHARS ? `${entry.slice(0, MEMORY_ENTRY_CHARS)}…` : entry));
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
    .map((workspace) => ({ id: String(workspace._id), title: text(workspace.title).trim().slice(0, 120) || "Untitled" }));
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

export async function buildEnvironment(request: EnvironmentRequest): Promise<Omit<EnvironmentInput, "permissions" | "timeZone">> {
  const now = request.now ?? Date.now();
  const [me, memory, bridge, places] = await Promise.all([
    query<unknown & object, { name?: string; schoolRole?: string } | null>("identity:me", {
      actorClerkId: request.actorClerkId,
    }).catch(() => null),
    readMemoryIndex(request.actorClerkId),
    readBridgeStatus(request.actorClerkId, now),
    readPlaces(request.actorClerkId, request.workspaceId),
  ]);
  const first = request.open?.[0];
  const page =
    text(request.currentView).trim().slice(0, 200) ||
    (first ? `Editing ${first.type} "${first.title}"` : request.surface === "workspace" ? "Workspace" : "Chat");
  return {
    now,
    ...(me ? { user: { ...(me.name ? { name: me.name } : {}), ...(me.schoolRole ? { role: me.schoolRole } : {}) } } : {}),
    page,
    ...(request.open?.length ? { open: request.open } : {}),
    ...(request.selection ? { selection: request.selection } : {}),
    ...(request.references?.length ? { references: request.references } : {}),
    ...(bridge ? { bridge } : {}),
    ...(places.places.length ? { places: places.places } : {}),
    ...(places.here ? { here: places.here } : {}),
    ...(memory.length ? { memory } : {}),
    ...(request.attachments?.length ? { attachments: request.attachments.map((attachment) => attachment.name) } : {}),
  };
}
