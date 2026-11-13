/**
 * What a student can sync from ManageBac, and how. Shared by Convex (preferences, scheduling,
 * enforcement), the ManageBac route (which routes run for a job) and the School page.
 * See docs/product/SCHOOL.md.
 */

/** Each kind of data is a separate sync job. Listed in the order a full "Sync now" runs them. */
export const SCHOOL_SYNC_KINDS = [
  "classes",
  "current_tasks",
  "task_resources",
  "grades",
  "past_tasks",
  "dropbox_files",
  "cas",
  "calendar_events",
] as const;
export type SchoolSyncKind = (typeof SCHOOL_SYNC_KINDS)[number];

/** What the AI asks ManageBac to refresh, and the sync kinds each one needs. */
export const AI_SYNC_PURPOSE_KINDS = {
  upcoming_deadlines: ["current_tasks"],
  class_resources: ["task_resources"],
  timetable: ["classes"],
  classes: ["classes"],
  past_tasks: ["past_tasks", "dropbox_files"],
  grades: ["grades"],
  cas: ["cas"],
} as const satisfies Record<string, readonly SchoolSyncKind[]>;
export type AiSyncPurpose = keyof typeof AI_SYNC_PURPOSE_KINDS;
export const AI_SYNC_PURPOSES = Object.keys(AI_SYNC_PURPOSE_KINDS) as AiSyncPurpose[];
export function aiSyncPurpose(value: unknown): AiSyncPurpose {
  return typeof value === "string" && value in AI_SYNC_PURPOSE_KINDS ? (value as AiSyncPurpose) : "upcoming_deadlines";
}
/** The `managebac:requestAiRefresh` arguments for an AI sync: only the kinds its purpose needs. */
export function aiRefreshRequest(purposeValue: unknown, forceValue: unknown) {
  const purpose = aiSyncPurpose(purposeValue);
  return { reason: `ai_${purpose}`, force: forceValue !== false, kinds: [...AI_SYNC_PURPOSE_KINDS[purpose]] as SchoolSyncKind[] };
}

export const SCHOOL_SYNC_MODES = ["auto", "manual", "off"] as const;
export type SchoolSyncMode = (typeof SCHOOL_SYNC_MODES)[number];

/** Whether ManageBac's public API can serve a kind at all (docs/product/SCHOOL.md, "What the API allows"). */
export type SchoolSyncAvailability = "available" | "unavailable";

export type SchoolSyncKindInfo = {
  label: string;
  description: string;
  defaultMode: SchoolSyncMode;
  /** How often Auto runs. */
  autoEveryMinutes: number;
  /** Whether a class can override this kind's mode. */
  classScoped: boolean;
  availability: SchoolSyncAvailability;
  /** Plain words for the School page when the kind is unavailable. */
  unavailableReason?: string;
  /** False when the student doesn't choose it: it always runs in its default mode, and Sync doesn't list it. */
  choice?: false;
};

export const SCHOOL_SYNC_KIND_INFO: Record<SchoolSyncKind, SchoolSyncKindInfo> = {
  classes: {
    label: "Classes and timetable",
    description: "Your classes, which become workspaces, and their timetable.",
    defaultMode: "auto", autoEveryMinutes: 12 * 60, classScoped: true, availability: "available",
  },
  current_tasks: {
    label: "Current tasks and deadlines",
    description: "Tasks still in progress. They feed the Calendar and the planner.",
    defaultMode: "auto", autoEveryMinutes: 60, classScoped: true, availability: "available",
  },
  task_resources: {
    label: "Task resources",
    description: "Files and links your teachers attach to your classes.",
    defaultMode: "auto", autoEveryMinutes: 6 * 60, classScoped: true, availability: "unavailable",
    unavailableReason: "ManageBac's API has no way to read the files and links on a task, so Spectra can't sync them.",
  },
  grades: {
    label: "Grades and feedback",
    description: "Your own grades and feedback on tasks.",
    defaultMode: "auto", autoEveryMinutes: 6 * 60, classScoped: true, availability: "available",
  },
  past_tasks: {
    label: "Past tasks",
    description: "Finished tasks, kept for revision and portfolios.",
    defaultMode: "auto", autoEveryMinutes: 24 * 60, classScoped: true, availability: "available", choice: false,
  },
  dropbox_files: {
    label: "Dropbox files",
    description: "What you handed in. Files download when you open them, and stay cached.",
    defaultMode: "auto", autoEveryMinutes: 24 * 60, classScoped: true, availability: "available",
  },
  cas: {
    label: "CAS",
    description: "Your CAS experiences.",
    defaultMode: "manual", autoEveryMinutes: 24 * 60, classScoped: false, availability: "unavailable",
    unavailableReason: "ManageBac doesn't share CAS with apps a student connects, so Spectra can't sync it.",
  },
  calendar_events: {
    label: "Calendar events",
    description: "School events.",
    defaultMode: "auto", autoEveryMinutes: 24 * 60, classScoped: false, availability: "unavailable",
    unavailableReason: "ManageBac's API has no school events to read, so Spectra can't sync them.",
  },
};

/**
 * Kinds that reach back through the student's history. A sync of the whole page (and the
 * first one) starts from today: it leaves these out unless they are Auto, and they come in
 * when the student syncs them on their own.
 */
export const HISTORY_SYNC_KINDS: readonly SchoolSyncKind[] = ["past_tasks", "dropbox_files"];

/** Whether a kind runs in a sync of the whole page, given whether it is Auto anywhere. */
export function joinsPageSync(kind: SchoolSyncKind, auto: boolean) {
  return auto || !HISTORY_SYNC_KINDS.includes(kind);
}

export function isSchoolSyncKind(value: unknown): value is SchoolSyncKind {
  return typeof value === "string" && (SCHOOL_SYNC_KINDS as readonly string[]).includes(value);
}

export function isSchoolSyncMode(value: unknown): value is SchoolSyncMode {
  return typeof value === "string" && (SCHOOL_SYNC_MODES as readonly string[]).includes(value);
}

/**
 * The mode that applies: an unavailable kind is always Off; a class override wins over the
 * student's choice for the kind, which wins over the default.
 */
export function effectiveSchoolSyncMode(
  kind: SchoolSyncKind,
  chosen: SchoolSyncMode | undefined,
  classOverride?: SchoolSyncMode,
): SchoolSyncMode {
  const info = SCHOOL_SYNC_KIND_INFO[kind];
  if (info.availability === "unavailable") return "off";
  if (info.choice === false) return info.defaultMode;
  if (info.classScoped && classOverride) return classOverride;
  return chosen ?? info.defaultMode;
}

/** Whether a run started by this trigger may sync data in this mode. */
export function modeAdmitsTrigger(mode: SchoolSyncMode, trigger: "schedule" | "user" | "ai") {
  if (mode === "off") return false;
  return mode === "auto" || trigger !== "schedule";
}

const TASK_TYPES = new Set(["assignment", "deadline", "assessment", "task"]);
const CLASS_TYPES = new Set(["class", "course", "membership", "timetable", "timetable_event", "lesson", "class_event"]);
const RESOURCE_TYPES = new Set(["class_resource", "school_resource", "resource", "file", "task_resource"]);
const GRADE_TYPES = new Set(["grade", "task_result", "feedback"]);
const SUBMISSION_TYPES = new Set(["submission", "dropbox_submission"]);
const CAS_TYPES = new Set(["cas_experience", "cas_reflection", "cas_evidence"]);
const EVENT_TYPES = new Set(["calendar_event", "school_event"]);

/** A task stays current for a week after its due date, so late work and feedback stay in view. */
export const PAST_TASK_GRACE_MS = 7 * 24 * 60 * 60_000;

function dueTime(normalized: unknown) {
  const value = normalized && typeof normalized === "object" ? (normalized as Record<string, unknown>) : {};
  for (const field of ["dueAt", "deadlineAt", "due_at", "due_date"]) {
    const raw = value[field];
    const time = typeof raw === "number" ? raw : typeof raw === "string" ? Date.parse(raw) : Number.NaN;
    if (Number.isFinite(time)) return time;
  }
  return undefined;
}

/** Whether a task belongs to the archive: its class is archived, or it was due over a week ago. */
export function taskIsPast(normalized: unknown, classArchived: boolean, now: number) {
  if (classArchived) return true;
  const due = dueTime(normalized);
  return due !== undefined && due < now - PAST_TASK_GRACE_MS;
}

/** The kind a stored record belongs to. Undefined for records no student preference governs. */
export function recordSyncKind(
  recordType: string,
  normalized: unknown,
  context: { classArchived: boolean; now: number },
): SchoolSyncKind | undefined {
  if (TASK_TYPES.has(recordType))
    return taskIsPast(normalized, context.classArchived, context.now) ? "past_tasks" : "current_tasks";
  if (EVENT_TYPES.has(recordType)) return "calendar_events";
  if (CLASS_TYPES.has(recordType)) return "classes";
  if (RESOURCE_TYPES.has(recordType)) return "task_resources";
  if (GRADE_TYPES.has(recordType)) return "grades";
  if (SUBMISSION_TYPES.has(recordType)) return "dropbox_files";
  if (CAS_TYPES.has(recordType)) return "cas";
  return undefined;
}

/** The kinds a provider route serves. A tasks route serves current and past tasks. */
export function capabilitySyncKinds(capability: { recordType: string; normalization?: unknown }): SchoolSyncKind[] {
  const config = capability.normalization && typeof capability.normalization === "object"
    ? (capability.normalization as Record<string, unknown>) : {};
  if (config.identityOnly === true || config.onDemand === true) return [];
  if (isSchoolSyncKind(config.syncKind)) return [config.syncKind];
  if (TASK_TYPES.has(capability.recordType)) return ["current_tasks", "past_tasks"];
  const kind = recordSyncKind(capability.recordType, {}, { classArchived: false, now: 0 });
  return kind ? [kind] : [];
}

/** Who can fix a sync problem, in the words the School page shows. */
export type SchoolSyncFixer = "student" | "school_admin" | "spectra" | "wait" | "nobody";

export type SchoolSyncProblem = { code: string; message: string; fixBy: SchoolSyncFixer; fixHint: string };

const FIX_HINTS: Record<SchoolSyncFixer, string> = {
  student: "You can fix this.",
  school_admin: "A ManageBac administrator at your school can fix this.",
  spectra: "Spectra tries again later.",
  wait: "Nothing to do: it continues shortly.",
  nobody: "This isn't something anyone can change from Spectra.",
};

/** Turns a sync error code into plain words and who can fix it. */
export function describeSchoolSyncProblem(code: string, kind?: SchoolSyncKind): SchoolSyncProblem {
  const what = kind ? SCHOOL_SYNC_KIND_INFO[kind].label.toLowerCase() : "this data";
  const pick = (message: string, fixBy: SchoolSyncFixer) => ({ code, message, fixBy, fixHint: FIX_HINTS[fixBy] });
  switch (code) {
    case "INTEGRATION_PERMISSION_DENIED":
      return pick(`Your school's ManageBac API key doesn't allow reading ${what}.`, "school_admin");
    case "INTEGRATION_CREDENTIAL_REJECTED":
    case "INTEGRATION_TOKEN_REQUIRED":
      return pick("ManageBac no longer accepts your school's connection.", "school_admin");
    case "INTEGRATION_NOT_READY":
    case "INTEGRATION_NOT_CONNECTED":
      return pick("Your school hasn't connected ManageBac yet.", "school_admin");
    case "INTEGRATION_SYNC_PARTIAL":
      return pick(`Some ${what} could not be synced.`, "student");
    case "INTEGRATION_REVIEW_REQUIRED":
      return pick("Some ManageBac changes need review.", "student");
    case "INTEGRATION_IDENTITY_REQUIRED":
      return pick("Spectra hasn't matched you to your ManageBac account yet.", "student");
    case "INTEGRATION_RATE_LIMITED":
      return pick("ManageBac asked Spectra to slow down.", "wait");
    case "INTEGRATION_SYNC_TIME_BUDGET":
    case "INTEGRATION_WORKER_LEASE_EXPIRED":
      return pick(`There's a lot of ${what}, so the sync runs in parts.`, "wait");
    case "INTEGRATION_ENDPOINT_UNAVAILABLE":
      return pick(`ManageBac's API has no way to read ${what}.`, "nobody");
    case "INTEGRATION_SELECTION_CHANGED":
      return pick("Your classes changed while this sync ran, so it starts again.", "wait");
    default:
      return pick(`The last sync of ${what} didn't finish.`, "spectra");
  }
}

/**
 * The seven IB CAS learning outcomes. Experiences are tagged with them in Spectra: ManageBac's
 * public API doesn't expose outcome tagging.
 */
export const CAS_LEARNING_OUTCOMES = [
  { id: 1, label: "Strengths and growth", description: "Identify own strengths and develop areas for growth." },
  { id: 2, label: "New challenges", description: "Demonstrate that challenges have been undertaken, developing new skills in the process." },
  { id: 3, label: "Initiative and planning", description: "Demonstrate how to initiate and plan a CAS experience." },
  { id: 4, label: "Commitment and perseverance", description: "Show commitment to and perseverance in CAS experiences." },
  { id: 5, label: "Collaboration", description: "Demonstrate the skills and recognize the benefits of working collaboratively." },
  { id: 6, label: "Global significance", description: "Demonstrate engagement with issues of global significance." },
  { id: 7, label: "Ethics", description: "Recognize and consider the ethics of choices and actions." },
] as const;
export type CasLearningOutcomeId = (typeof CAS_LEARNING_OUTCOMES)[number]["id"];

/**
 * Writing back to ManageBac. The public API has no write endpoints for CAS, so reflections and
 * evidence stay in Spectra. When a live check finds one, the route gains the write and this flips.
 */
export const CAS_WRITE_BACK = {
  reflections: { supported: false, reason: "ManageBac's API can't save CAS reflections, so yours stay in Spectra." },
  evidence: { supported: false, reason: "ManageBac's API can't save CAS evidence, so yours stays in Spectra." },
} as const;

/** Largest dropbox or evidence file Spectra keeps. */
export const SCHOOL_FILE_MAX_BYTES = 50_000_000;
/** Text kept from a fetched file for search. */
export const SCHOOL_FILE_TEXT_MAX_CHARS = 40_000;
