import type { WorkAnchor } from "../work/registry";
import type { SpectraPreferences } from "../settings/schema";

export type SpectraCommands = {
  "work.open": {
    workId: string;
    surface?: "full" | "panel" | "tile";
    anchor?: WorkAnchor;
  };
  "work.revealAnchor": { anchor: WorkAnchor; focus?: boolean };
  "run.openConversation": { runId: string; threadId?: string };
  "reference.insert": { hostWorkId: string; target: WorkAnchor };
  "reference.beginPicking": { hostWorkId: string };
  "context.beginPicking": { source: "quick_chat" | "composer" };
  "settings.manageAccount": Record<string, never>;
  "settings.clearLocalComputeCache": Record<string, never>;
};

export type SpectraEvents = {
  "work.updated": { workId: string; origin: "human" | "ai" | "system" };
  "run.requiredInput": {
    runId: string;
    requestId: string;
    kind: "choice" | "short_answer" | "file" | "permission" | "context";
  };
  "integration.statusChanged": {
    integration: string;
    state: string;
  };
  "settings.changed": { preferences: SpectraPreferences };
};

export type SpectraQueries = {
  "work.active": { workId: string | null };
  "run.active": { runIds: string[] };
};
