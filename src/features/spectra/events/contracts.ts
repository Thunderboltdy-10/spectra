import type { WorkAnchor } from "../work/registry";
import type { WorkRegion } from "../anchors/locate";
import type { SpectraPreferences } from "../settings/schema";
import type { ReferenceNode } from "../references";
import type { AiSyncPurpose } from "../../../../shared/school-sync";
import type { Figure } from "../life/figure";
import type { NavigationShow } from "../collaboration/follow-navigation";
import type { FirstTipId } from "../onboarding/first-tips";

/** A thread list kept to one class or workspace, named for the person reading it. */
export type ThreadScope = { workspaceId: string; title: string };

export type SpectraCommandOutcome = {
  status: "completed" | "pending" | "needs-human" | "failed";
  message: string;
  data?: unknown;
  readiness?: import("../viewport-readiness").ViewportReadinessAcknowledgement;
};

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
    /** Land on this place inside the work (a search hit, a citation); unknown places open the work as usual. */
    region?: WorkRegion;
  };
  "document.executeCommand": {
    artifactId: string;
    commandId: string;
    params?: string | number | boolean | null;
  };
  "comments.open": { artifactId: string };
  "comments.add": { artifactId: string; body: string; regionId?: string };
  "library.import": { kind: "file" | "workspace" };
  "run.stopRequested": { runId?: string };
  "follow.stopRequested": Record<string, never>;
  "navigation.show": NavigationShow;
  "navigation.home": Record<string, never>;
  "surface.share": Record<string, never>;
  /**
   * Ask a studio to close, asking first about unsynchronised changes.
   * `instance` names one copy edited in place inside another work; without it
   * the request is for the work's own studio, never those copies.
   */
  "work.requestClose": { workId: string; instance?: string };
  "work.reveal": { workId: string; path?: string };
  "quiz.preview": { workId: string };
  "deck.study": { workId: string };
  "work.revealAnchor": { anchor: WorkAnchor; focus?: boolean };
  "run.openConversation": { runId: string; threadId?: string };
  "reference.insert": {
    hostWorkId: string;
    target?: WorkAnchor;
    reference?: ReferenceNode;
    /** Lay it on this embed's card as another tab instead of a new card. */
    stackOnto?: string;
  };
  "reference.remove": { hostWorkId: string; embedId: string };
  "reference.beginPicking": { hostWorkId: string };
  /** Finds work to add as a reference, in a picker at the caret (`at`, in viewport pixels). */
  "reference.add": { hostWorkId: string; at?: { x: number; y: number }; stackOnto?: string };
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
    purpose: AiSyncPurpose;
  };
  "managebac.selectClasses": {
    recordIds: string[];
    expectedRevision?: number;
    retention?: "keep_in_spectra" | "archive_projection";
  };
  "managebac.importResource": {
    sourceRecordId: string;
    refresh?: boolean;
    requestKey?: string;
  };
};

export type SpectraEvents = {
  "artifact.lensActivated": { artifactId: string; projection?: unknown };
  /** A work moved between this computer and the cloud: an open copy reads it again so it joins the fresh live history. */
  "artifact.storageMoved": { artifactId: string };
  "workspace.refreshRequested": Record<string, never>;
  "threads.changed": Record<string, never>;
  /** Something may have put work on the calendar or moved it (a finished run); an open calendar reads again. */
  "calendar.changed": Record<string, never>;
  /** Something about this computer's Bridge changed: refresh what shows it. */
  "devices.changed": Record<string, never>;
  /** A Code work's published build changed (Spectra published or took it down). */
  "code.publishedChanged": { artifactId: string };
  /** An agent's releases or checks changed (Spectra ran its checks, or released, promoted, rolled back or suspended one). */
  "agent.releasesChanged": { agentId: string };
  /** An agent's bench changed (Spectra asked it a question, or kept or removed a test). */
  "agent.benchChanged": { agentId: string };
  /** Spectra compiled an agent in the Foundry: its drafted skills wait on the compiler job. */
  "agent.compiled": { agentId: string };
  "notifications.changed": Record<string, never>;
  /* Open the pending share invitations in the Library (a notification's
     Review), including when the Library already shows them. */
  "invitations.review": Record<string, never>;
  "workspaces.changed": Record<string, never>;
  "shell.sidebarLayout": { collapsed: boolean };
  /* The workbench row asking chrome to rail the sidebar because open panels
     do not fit beside the expanded sidebar (presentational; never writes the
     stored preference). */
  "shell.sidebarCrowd": { crowded: boolean };
  "shell.focusSidebarSearch": Record<string, never>;
  "shell.openCommandBar": Record<string, never>;
  /* Find a thread: the chat page's search, else the island's thread switcher (SHELL.md). */
  "threads.open": { query?: string; scope?: ThreadScope };
  /** Play Spectra's tour of the app from the start (the account menu's "Take the tour"). */
  "tour.start": Record<string, never>;
  /** The student did something for the first time; its tip is said once (onboarding/first-tips). */
  "tip.moment": { id: FirstTipId };
  /** Open the island's composer; `fresh` lets go of the thread in focus first. */
  /** Open the composer; `text` and `references` start it written, for the student to edit and send. */
  /** `send` sends the text at once, as if the student had pressed send (the daily brief's "Make it"). */
  "island.compose": { fresh?: boolean; text?: string; references?: Array<{ id: string; type: string; title: string }>; send?: boolean };
  /** A thread opened from elsewhere arrives in the island: `from` is what it leaves (ISLAND.md, "Arriving threads"). */
  "island.arrive": { threadId: string; from?: Figure };
  /** A notification reaches the user through the island (SHELL.md). */
  "island.notify": { id: string; title: string; detail?: string; tone: "done" | "problem" | "needs" | "info" };
  /** The user opened a notification from the island; the account's notifications act on it. */
  "notifications.choose": { id: string };
  "work.unavailable": { workId: string };
  "work.updated": { workId: string; origin: "human" | "ai" | "system" };
  "run.changed": { runId: string };
  "ai.ui.referenceReceipt": {
    runId?: string;
    hostWorkId: string;
    targetWorkId: string;
    phase:
      | "queued_refresh"
      | "consent"
      | "viewport_ready"
      | "canonical_write"
      | "verified_native_write"
      | "failed"
      | "host_unmounted";
    message: string;
    ok: boolean;
  };
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
  "navigation.readiness": import("../viewport-readiness").ViewportReadinessAcknowledgement;
  "navigation.manualInteraction": {
    surface: string;
    interaction: "pointer" | "keyboard" | "wheel";
    targetId?: string;
  };
};

export type SpectraQueries = {
  "work.active": { workId: string | null };
  "run.active": { runIds: string[] };
  /* The island prism's status dot, so still copies (the favicon, the tray) say the same. */
  "prism.status": { status: import("../life/prism").PrismStatus | null };
  /* The thread open in the route's Side: the island replies to it. */
  "side.thread": { threadId: string; title: string } | null;
  /* Whether a closable panel (work or a conversation) holds the Side: a page's
     collapsible panel tucks into its edge tab until it closes (SHELL.md). */
  "side.open": { kind: "work" | "thread" } | null;
};
