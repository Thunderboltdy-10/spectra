import type { WorkAnchor } from "../work/registry";
import type { SpectraPreferences } from "../settings/schema";
import type { ReferenceNode } from "../references";

export type SpectraCommands = {
  "library.organize": {
    action: "create_folder" | "rename" | "move" | "link";
    targetIds: string[];
    destinationId?: string;
    name?: string;
  };
  "library.delete": { targetIds: string[] };
  "work.open": {
    workId: string;
    surface?: "full" | "panel" | "tile";
    anchor?: WorkAnchor;
  };
  "navigation.show": {
    actorId?: string;
    route: "library" | "calendar" | "settings" | "workspace" | "artifact";
    target?: string;
  };
  "navigation.home": Record<string, never>;
  "surface.share": Record<string, never>;
  "work.requestClose": { workId: string };
  "work.reveal": { workId: string; path?: string };
  "quiz.preview": { workId: string };
  "deck.study": { workId: string };
  "work.revealAnchor": { anchor: WorkAnchor; focus?: boolean };
  "run.openConversation": { runId: string; threadId?: string };
  "reference.insert": {
    hostWorkId: string;
    target?: WorkAnchor;
    reference?: ReferenceNode;
  };
  "reference.remove": { hostWorkId: string; embedId: string };
  "reference.beginPicking": { hostWorkId: string };
  "context.beginPicking": { source: "quick_chat" | "composer" };
  "settings.manageAccount": Record<string, never>;
  "settings.clearLocalComputeCache": Record<string, never>;
  "settings.change": { patch: Record<string, unknown>; section?: string };
  "sync.policy.change": { targetIds: string[]; patch: Record<string, unknown> };
  "memory.write": {
    action: "create" | "revise";
    content: string;
    memoryId?: string;
  };
  "sharing.change": {
    resourceType: "workspace" | "artifact" | "agent";
    resourceId: string;
    action: "invite" | "change_level" | "revoke";
    subjectId?: string;
    invitationId?: string;
    grantId?: string;
    level?: "read" | "modify";
  };
  "managebac.sync": {
    purpose:
      | "upcoming_deadlines"
      | "class_resources"
      | "timetable"
      | "classes"
      | "cas";
  };
};

export type SpectraEvents = {
  "artifact.lensActivated": { artifactId: string; projection?: unknown };
  "workspace.refreshRequested": Record<string, never>;
  "threads.changed": Record<string, never>;
  "notifications.changed": Record<string, never>;
  "workspaces.changed": Record<string, never>;
  "shell.sidebarLayout": { collapsed: boolean };
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
