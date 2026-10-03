import type { ArtifactSnapshot } from "@/features/spectra/ai/harness/backend";
import { isAuthoredType, readAuthored } from "@/features/spectra/ai/harness/authoring";
import { DEFAULT_PERMISSION_PREFS, readPermissionPrefs, type PermissionPrefs } from "@/features/spectra/ai/harness/permissions";
import type { EnvironmentInput } from "@/features/spectra/ai/harness/prompt";
import type { HarnessContentPart, HarnessMessage } from "@/features/spectra/ai/harness/types";
import type { PreparedAttachment } from "./contract";
import { rows } from "./effects";
import { act, query } from "./io";

/*
 * What Spectra knows at the start of a run: who the user is, where they are,
 * the focused artifact with its outline, their permission choices, what they
 * asked Spectra to remember, and this thread's earlier turns. Every read is
 * best effort: missing context never fails a run.
 */

const HISTORY_MESSAGES = 80;
const HISTORY_MESSAGE_CHARS = 8_000;
const ATTACHMENT_TEXT_CHARS = 60_000;

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
    else parts.push({ type: "text", text: `Attached file "${attachment.name}" could not be read.` });
  }
  return parts;
}

export type EnvironmentRequest = {
  actorClerkId: string;
  prompt: string;
  workspaceId?: string;
  artifactId?: string;
  currentView?: string;
  surface?: string;
  attachments?: PreparedAttachment[];
  readArtifact: (id: string) => Promise<ArtifactSnapshot | null>;
};

export async function buildEnvironment(
  request: EnvironmentRequest,
): Promise<{ environment: Omit<EnvironmentInput, "permissions" | "timeZone">; focused: ArtifactSnapshot | null }> {
  const [me, focused, memory] = await Promise.all([
    query<unknown & object, { name?: string; schoolRole?: string } | null>("identity:me", {
      actorClerkId: request.actorClerkId,
    }).catch(() => null),
    request.artifactId ? request.readArtifact(request.artifactId).catch(() => null) : Promise.resolve(null),
    act<unknown & object, { text?: string } | null>("memory:contextForRun", {
      actorClerkId: request.actorClerkId,
      queryText: request.prompt.slice(0, 2_000),
      ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
      ...(request.artifactId ? { artifactId: request.artifactId } : {}),
      targetTokens: 800,
    }).catch(() => null),
  ]);
  const memoryText = text(memory?.text).trim();
  const page =
    text(request.currentView).trim().slice(0, 200) ||
    (focused ? `Editing ${focused.type} "${focused.title}"` : request.surface === "workspace" ? "Workspace" : "Chat");
  return {
    focused,
    environment: {
      now: Date.now(),
      ...(me ? { user: { ...(me.name ? { name: me.name } : {}), ...(me.schoolRole ? { role: me.schoolRole } : {}) } } : {}),
      page,
      ...(focused
        ? {
            focused: {
              id: focused.id,
              type: focused.type,
              title: focused.title,
              canEdit: focused.canEdit,
              ...(isAuthoredType(focused.type)
                ? { outline: safeOutline(() => readAuthored(focused.type as never, focused.content)) }
                : {}),
            },
          }
        : {}),
      ...(memoryText ? { memory: [memoryText.slice(0, 2_000)] } : {}),
      ...(request.attachments?.length ? { attachments: request.attachments.map((attachment) => attachment.name) } : {}),
    },
  };
}

function safeOutline(read: () => string) {
  try {
    const outline = read();
    return outline.length > 1_500 ? `${outline.slice(0, 1_500)}\n… (read_artifact for the rest)` : outline;
  } catch {
    return undefined;
  }
}
