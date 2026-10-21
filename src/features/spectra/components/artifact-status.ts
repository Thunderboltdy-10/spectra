import type { IconName } from "@/components/icons";
import {
  replicaHasNativeLock,
  type ReplicaState,
  type SyncPresentation,
} from "../bridge/status";

/*
 * The status control's model (EDITORS.md, "The status control"). One state
 * for the whole artifact, read from the one sync presenter, so the header,
 * the AI and the tests agree on what a glance should say. Pure: the control
 * renders it and the life moments react to its changes.
 */

export type ArtifactStatusState =
  | "saved"
  | "saving"
  | "offline"
  | "syncing"
  | "waitingOffice"
  | "readOnly"
  | "versions"
  | "problem";

export type ArtifactStatusActionKind =
  | "retry"
  | "reconnect"
  | "sign-in"
  | "keep-spectra"
  | "keep-office"
  | "compare"
  | "open-in-office"
  | "show-in-folder"
  | "review-draft"
  | "history";

export type ArtifactStatusAction = { kind: ArtifactStatusActionKind; label: string };

export type ArtifactStatusReplica = {
  kind: "cloud" | "local";
  state: ReplicaState;
  lastVerifiedAt?: number;
  retryAt?: number;
  errorCode?: string;
  relativePath?: string;
};

export type ArtifactStatusInput = {
  presentation: Pick<SyncPresentation, "key" | "state" | "label" | "detail" | "action">;
  replicas: readonly ArtifactStatusReplica[];
  /** The name of the desktop folder that holds the file, e.g. "Documents". */
  folderLabel?: string;
  /** "Word", "Excel", "PowerPoint" for a native Office file. */
  officeApplication?: string;
  /** Spectra is writing to or reading from the desktop file right now. */
  nativeActivity?: boolean;
  /** Spectra and the desktop file both changed (the native conflict). */
  nativeConflict?: boolean;
  /** A draft kept on this device overlaps a newer change and waits for review. */
  draftReview?: boolean;
  /** When this work was last saved, if no replica has said. */
  savedAt?: number;
  now: number;
  /** The actions this surface can carry out. Unknown ones are not offered. */
  can?: Partial<Record<ArtifactStatusActionKind, boolean>>;
};

export type ArtifactStatus = {
  state: ArtifactStatusState;
  /** The state's name in the popover, when the surface is not a work ("Syncing" on School). */
  name?: string;
  glyph: IconName;
  /** The state hue, on the glyph's accent. */
  hue: string;
  /** A word or two beside the glyph while something is happening. */
  words?: string;
  /** The glyph plays its animation continuously. */
  running: boolean;
  /** The hover sentence. */
  sentence: string;
  /** The popover's facts, label then value. */
  facts: { label: string; value: string }[];
  actions: ArtifactStatusAction[];
};

const GLYPH: Record<ArtifactStatusState, IconName> = {
  saved: "saved",
  saving: "saving",
  offline: "offline",
  syncing: "syncing",
  waitingOffice: "locked",
  readOnly: "readOnly",
  versions: "versions",
  problem: "problem",
};

const HUE: Record<ArtifactStatusState, string> = {
  saved: "var(--success)",
  saving: "var(--accent-cyan)",
  offline: "var(--text-tertiary)",
  syncing: "var(--accent-cyan)",
  waitingOffice: "var(--warning)",
  readOnly: "var(--accent-cyan)",
  versions: "var(--danger)",
  problem: "var(--danger)",
};

/** "just now", "1 min ago", "2 hr ago", "yesterday", "3 days ago". */
export function savedAgo(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** The file's own name: "Essay.docx" from "Biology/Essay.docx". */
export function fileNameOf(relativePath: string | undefined): string | undefined {
  if (!relativePath) return undefined;
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1);
}

/** A friendly folder trail, never a path: "Documents › Biology". */
export function folderTrailOf(folderLabel: string | undefined, relativePath: string | undefined): string | undefined {
  const folders = (relativePath ?? "").split(/[\\/]+/).filter(Boolean).slice(0, -1);
  const trail = [folderLabel?.trim(), ...folders].filter((part): part is string => Boolean(part));
  if (!trail.length) return undefined;
  // A deep trail keeps its ends: the place the user knows, and the folder it is in.
  return trail.length > 3 ? `${trail[0]} › … › ${trail.at(-1)}` : trail.join(" › ");
}

function stateOf(input: ArtifactStatusInput): ArtifactStatusState {
  const { presentation, replicas } = input;
  if (presentation.state === "read_only") return "readOnly";
  if (input.nativeConflict || input.draftReview || presentation.key === "conflict") return "versions";
  if (presentation.key === "error") return "problem";
  if (presentation.action?.kind === "sign-in") return "problem";
  if (presentation.state === "saving" || presentation.state === "pending") {
    if (replicas.some(replicaHasNativeLock)) return "waitingOffice";
    if (retrying(replicas)) return "problem";
    if (presentation.key === "access") return "saving";
    if (presentation.label === "Queued" || presentation.label === "Not running") return "offline";
    if (presentation.key === "syncing" || input.nativeActivity) return "syncing";
    return "saving";
  }
  if (presentation.state === "offline") return "offline";
  return "saved";
}

function retrying(replicas: readonly ArtifactStatusReplica[]) {
  return replicas.some(
    (replica) => replica.state === "pending" && replica.retryAt !== undefined && Boolean(replica.errorCode),
  );
}

function wordsOf(state: ArtifactStatusState, input: ArtifactStatusInput, fileName: string | undefined) {
  const app = input.officeApplication ?? "Office";
  switch (state) {
    case "saved":
      return undefined;
    case "saving":
      return input.presentation.key === "access" ? input.presentation.label : "Saving";
    case "syncing":
      return fileName ? `Updating ${fileName}` : "Updating";
    case "waitingOffice":
      return `Open in ${app}`;
    case "readOnly":
      return "Read only";
    case "versions":
      return "Two versions";
    case "offline":
      return input.presentation.key === "offline" ? "Offline" : input.presentation.label;
    case "problem":
      if (input.presentation.action?.kind === "sign-in") return "Signed out";
      return retrying(input.replicas) ? "Couldn't save. Retrying" : "Couldn't save";
  }
}

export function artifactStatusOf(input: ArtifactStatusInput): ArtifactStatus {
  const state = stateOf(input);
  const can = input.can ?? {};
  const app = input.officeApplication ?? "Office";
  const local = input.replicas.find((replica) => replica.kind === "local" && replica.state !== "unavailable");
  const fileName = fileNameOf(local?.relativePath);
  const trail = folderTrailOf(input.folderLabel, local?.relativePath);
  const verified = input.replicas
    .map((replica) => replica.lastVerifiedAt)
    .filter((value): value is number => typeof value === "number");
  const savedAt = verified.length ? Math.max(...verified) : input.savedAt;
  const ago = savedAt === undefined ? undefined : savedAgo(savedAt, input.now);
  const where = local ? (trail ? `on this computer in ${trail}` : "on this computer") : undefined;

  const sentence = (() => {
    if (state === "saved") {
      const saved = ago ? `Saved ${ago}` : "Saved";
      return where ? `${saved}, and ${where}.` : `${saved}.`;
    }
    if (state === "syncing") {
      return fileName
        ? `Bringing ${fileName} ${where ?? "on this computer"} up to date.`
        : "Bringing the desktop copy up to date.";
    }
    if (state === "waitingOffice") {
      return `${app} has this file open. Spectra saves it as soon as ${app} lets go of it.`;
    }
    if (state === "versions") {
      if (input.draftReview && !input.nativeConflict)
        return `A draft kept on this device overlaps a newer change${input.officeApplication ? ` from ${input.officeApplication}` : ""}. Nothing was overwritten: review it to choose.`;
      return input.nativeConflict
        ? `This work changed here and in ${app}. Nothing was overwritten: choose the version to keep.`
        : "This work changed in two places. Nothing was overwritten: choose the version to keep.";
    }
    return input.presentation.detail;
  })();

  const facts: ArtifactStatus["facts"] = [];
  if (ago) facts.push({ label: "Last saved", value: ago });
  if (fileName) facts.push({ label: "Desktop file", value: fileName });
  if (where) facts.push({ label: "Where", value: trail ? `This computer · ${trail}` : "This computer" });
  if (state === "waitingOffice") facts.push({ label: "In use", value: `Open in ${app} on this computer` });

  const actions: ArtifactStatusAction[] = [];
  const offer = (kind: ArtifactStatusActionKind, label: string) => {
    if (can[kind] && !actions.some((action) => action.kind === kind)) actions.push({ kind, label });
  };
  if (state === "versions") {
    if (input.nativeConflict) {
      offer("keep-spectra", "Keep this version");
      offer("keep-office", `Keep the ${app} version`);
    }
    if (input.draftReview) offer("review-draft", "Review the draft");
    else offer("compare", "Compare");
  }
  if (input.presentation.action?.kind === "retry") offer("retry", input.presentation.action.label);
  if (input.presentation.action?.kind === "sign-in") offer("sign-in", input.presentation.action.label);
  if (input.presentation.action?.kind === "reconnect") offer("reconnect", input.presentation.action.label);
  if (input.presentation.action?.kind === "review-conflict") offer("compare", "Compare");
  if (local && input.officeApplication) offer("open-in-office", `Open in ${app}`);
  if (local) offer("show-in-folder", "Show in folder");
  offer("history", "Version history");

  return {
    state,
    glyph: GLYPH[state],
    hue: HUE[state],
    words: wordsOf(state, input, fileName),
    running: state === "saving" || state === "syncing" || (state === "problem" && retrying(input.replicas)),
    sentence,
    facts,
    actions,
  };
}

/** The life moment a change of state earns (LIFE.md verbs, MOTION.md budgets). */
export type StatusMoment = "settle" | "alarm" | "attention" | null;

export function statusMoment(previous: ArtifactStatusState | null, next: ArtifactStatusState): StatusMoment {
  if (previous === null || previous === next) return null;
  if (next === "saved" && (previous === "saving" || previous === "syncing" || previous === "waitingOffice")) return "settle";
  if (next === "problem" || next === "versions") return "alarm";
  if (next === "waitingOffice") return "attention";
  return null;
}
