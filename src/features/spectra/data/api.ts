import type { ArtifactCardView } from "../components/artifact-card";

export type SpectraBlueprintKey = ArtifactCardView["blueprintKey"];

export type SpectraWorkspace = {
  _id: string;
  title: string;
  description?: string;
  icon?: string;
  color?: string;
  status: "active" | "archived";
  defaultView: "cards" | "canvas" | "timeline" | "library";
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
};

export type SpectraArtifact = {
  _id: string;
  blueprintKey: SpectraBlueprintKey;
  title: string;
  summary?: string;
  tags: string[];
  status: "active" | "draft" | "archived" | "deleted";
  createdAt: number;
  updatedAt: number;
  placements: Array<{
    workspaceId: string;
    workspaceTitle: string;
    workspaceItemId: string;
  }>;
  placementStatus: "inbox" | "workspace";
};

export type SpectraWorkspaceItem = {
  _id: string;
  workspaceId: string;
  sourceType: "artifact" | "thread" | "task" | "widget" | "custom";
  sourceId: string;
  viewData: {
    titleOverride?: string;
    compactSummary?: string;
    cardVariant?: string;
    pinned?: boolean;
    hidden?: boolean;
  };
  layout: {
    view: "cards" | "canvas" | "timeline";
  };
  artifact: SpectraArtifact | null;
  createdAt: number;
  updatedAt: number;
};

export type SpectraRun = {
  _id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  sourceSurface: "chat" | "workspace" | "artifact";
  userPrompt: string;
  finalSummary?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export type SpectraResultCard = {
  _id: string;
  runId: string;
  surface: "chat" | "workspace" | "artifact";
  workspaceId?: string;
  artifactId?: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  variant: "status" | "artifact" | "thread" | "operation" | "error";
  title: string;
  summary?: string;
  actions: Array<{
    key: string;
    label: string;
    targetType?: "artifact" | "thread" | "run" | "workspace";
    targetId?: string;
  }>;
  hiddenAt?: number;
  createdAt: number;
  updatedAt: number;
  run?: SpectraRun;
};

export type SpectraOverview = {
  workspaces: SpectraWorkspace[];
  selectedWorkspaceId?: string;
  workspace: {
    workspace: SpectraWorkspace;
    items: SpectraWorkspaceItem[];
  } | null;
  artifacts: SpectraArtifact[];
  runs: SpectraRun[];
  resultCards: SpectraResultCard[];
};

type JsonRecord = Record<string, unknown>;

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as T | { error?: { message?: string } } | { error?: string } | null;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? typeof payload.error === "string"
          ? payload.error
          : payload.error?.message
        : undefined;
    throw new Error(message || `Spectra request failed (${response.status})`);
  }
  return payload as T;
}

export async function getSpectraOverview(workspaceId?: string) {
  const params = new URLSearchParams({ action: "overview" });
  if (workspaceId) params.set("workspaceId", workspaceId);
  return readJson<SpectraOverview>(await fetch(`/api/spectra?${params.toString()}`, { cache: "no-store" }));
}

export async function getSpectraArtifacts(params?: {
  placement?: "all" | "inbox" | "workspace";
  blueprintKey?: SpectraBlueprintKey | "all";
  search?: string;
}) {
  const qs = new URLSearchParams({ action: "artifacts", placement: params?.placement ?? "all" });
  if (params?.blueprintKey && params.blueprintKey !== "all") qs.set("blueprintKey", params.blueprintKey);
  if (params?.search?.trim()) qs.set("search", params.search.trim());
  return readJson<{ artifacts: SpectraArtifact[] }>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function postSpectra<T>(body: JsonRecord) {
  return readJson<T>(await fetch("/api/spectra", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export function toArtifactCardView(artifact: SpectraArtifact): ArtifactCardView {
  return {
    id: artifact._id,
    title: artifact.title,
    blueprintKey: artifact.blueprintKey,
    summary: artifact.summary ?? "No summary yet.",
    meta: artifact.placements.length > 0
      ? artifact.placements.map((placement) => placement.workspaceTitle).join(", ")
      : "Inbox",
    placement: artifact.placementStatus,
  };
}

export function workspaceItemToArtifactCardView(item: SpectraWorkspaceItem): ArtifactCardView | null {
  if (!item.artifact) return null;
  return {
    id: item.artifact._id,
    title: item.viewData.titleOverride ?? item.artifact.title,
    blueprintKey: item.artifact.blueprintKey,
    summary: item.viewData.compactSummary ?? item.artifact.summary ?? "No summary yet.",
    meta: "Workspace card",
    placement: "workspace",
    pinned: item.viewData.pinned,
  };
}
