import { refreshPlannerSourceProjection } from "./planner-source.mjs";

/** Provider-owned facts applied to one personal planner. Shared by the direct
 * no-room effect, the canonical room action and its admitting mutation. */
export type PlannerProviderMode = "refresh" | "removed" | "rebase" | "keep_overlay";
export type PlannerProviderValue = { title: string; summary?: string; tags: string[]; content: unknown };
export type PlannerProviderText = { title?: string; description?: string; summary?: string };
export type PlannerProviderSource = {
  normalized: unknown; providerRecordId: string; payloadVersion: string; sourceHash: string;
};
export type PlannerProviderIntent = {
  mode: PlannerProviderMode;
  previousSourceHash: string;
  /** Normalized previous provider text. Absent means unknown, never empty. */
  previousText?: PlannerProviderText;
};

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function managebacText(value: unknown, maximum: number, fallback = "") {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : fallback;
}

/** Strip ManageBac HTML so planner summaries/descriptions never show raw tags. */
export function managebacPlainText(value: unknown, maximum: number, fallback = "") {
  if (typeof value !== "string") return fallback;
  const stripped = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return (stripped || fallback).slice(0, maximum);
}

/** The copied text a planner received from one provider generation. */
export function plannerProviderText(normalized: unknown): PlannerProviderText {
  const value = object(normalized);
  const title = value.title ?? value.name;
  return {
    ...(typeof title === "string" ? { title: managebacText(title, 240) } : {}),
    ...(typeof value.description === "string" ? {
      description: managebacPlainText(value.description, 20_000),
      summary: managebacPlainText(value.description, 600),
    } : {}),
  };
}

/** Order-independent digest binding a prepared room update to the exact
 * artifact head it was computed from. */
export async function plannerProviderDigest(value: unknown): Promise<string> {
  const ordered = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(ordered);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item).filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, ordered(child)]));
  };
  const bytes = new TextEncoder().encode(JSON.stringify(ordered(value)));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    byte => byte.toString(16).padStart(2, "0")).join("");
}

export function plannerProviderArtifactIdentity(artifact: {
  title: string; summary?: string; content: unknown; tags: string[]; updatedAt: number;
  currentVersionId?: string; contentHash?: string; liveStateVectorHash?: string;
}) {
  const { title, summary, content, tags, updatedAt, currentVersionId, contentHash, liveStateVectorHash } = artifact;
  return { title, summary, content, tags, updatedAt, currentVersionId, contentHash, liveStateVectorHash };
}

function timestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return Date.parse(value);
  return undefined;
}

/** Apply only provider-owned facts to the actual current planner. Personal
 * text advances only when it still equals the previous provider baseline.
 * Throws MANAGEBAC_PROJECTION_BASE_CONFLICT when an ordinary refresh cannot
 * prove that baseline, and MANAGEBAC_PROJECTION_RELINKED for another source. */
export function preparePlannerProviderValue(
  current: PlannerProviderValue, source: PlannerProviderSource, intent: PlannerProviderIntent,
): PlannerProviderValue {
  const content = object(current.content);
  const oldSource = object(content.source);
  if ((oldSource.provider !== undefined && oldSource.provider !== "managebac") ||
      oldSource.externalId !== source.providerRecordId)
    throw new Error("MANAGEBAC_PROJECTION_RELINKED");
  if (intent.mode === "removed")
    return { ...current, content: { ...content, source: { ...oldSource, status: "removed" } } };
  const normalized = object(source.normalized);
  const next = refreshPlannerSourceProjection({ ...current, summary: current.summary }, {
    previousSourceHash: intent.previousSourceHash,
    // Keeping an overlay advances official facts but never copied text.
    previous: intent.mode === "keep_overlay" ? undefined : intent.previousText,
    force: intent.mode === "rebase" || intent.mode === "keep_overlay",
    next: {
      title: managebacText(normalized.title ?? normalized.name, 240, current.title),
      description: managebacPlainText(normalized.description, 20_000),
      summary: managebacPlainText(normalized.description, 600),
      dueAt: timestamp(normalized.dueAt),
      source: {
        ...oldSource, provider: "managebac", externalId: source.providerRecordId,
        version: source.payloadVersion, hash: source.sourceHash, status: "active",
        lockedFields: ["taskTitle", "description", "dueAt", "source"],
      },
    },
  });
  if (!next) throw new Error("MANAGEBAC_PROJECTION_BASE_CONFLICT");
  return { title: next.title, summary: next.summary, tags: next.tags, content: next.content };
}
