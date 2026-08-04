/**
 * Dynamic Foundry sections
 * Phase 10 §10.3 - generated, removable, restorable, history-backed sections.
 *
 * Sections are never a fixed wizard. The creator system decides which sections
 * exist based on the mission; the user may dismiss any of them, and every
 * creation/removal/edit is recorded so an earlier state can be restored.
 */

export type FoundrySectionKind =
  | "text"
  | "long_text"
  | "single_choice"
  | "multi_choice"
  | "file_attachment"
  | "work_reference"
  | "example_pair"
  | "permission_selection"
  | "evidence_confirmation"
  | "evaluation_response"
  | "skill_review";

export type FoundrySectionOption = {
  id: string;
  label: string;
  detail?: string;
  recommended?: boolean;
};

export type FoundryExamplePair = {
  id: string;
  input: string;
  output: string;
  note?: string;
};

export type FoundrySectionValue =
  | { kind: "text"; text: string }
  | { kind: "choice"; selected: string[] ; other?: string }
  | { kind: "files"; fileIds: string[] }
  | { kind: "works"; workIds: string[] }
  | { kind: "examples"; pairs: FoundryExamplePair[] }
  | { kind: "permissions"; toolIds: string[] }
  | { kind: "confirmation"; accepted: boolean; note?: string }
  | { kind: "skills"; approvedSkillIds: string[]; rejectedSkillIds: string[] }
  | { kind: "empty" };

export type FoundrySection = {
  id: string;
  kind: FoundrySectionKind;
  /** Why the creator system generated this section. Written by the model, contextual. */
  prompt: string;
  /** Optional supporting explanation shown under the prompt. */
  detail?: string;
  /** Mission facet this section informs — used for sufficiency scoring. */
  facet: FoundryFacet;
  options?: FoundrySectionOption[];
  multiSelect?: boolean;
  allowOther?: boolean;
  required: boolean;
  value: FoundrySectionValue;
  status: "open" | "answered" | "dismissed";
  createdAt: number;
  updatedAt: number;
  /** Ordering weight assigned at generation. Lower sorts first. */
  order: number;
};

/**
 * Mission facets drive both section generation and the sufficiency check that
 * stops "Continue building" automatically (§10.4).
 */
export type FoundryFacet =
  | "objective"
  | "interaction"
  | "inputs"
  | "outputs"
  | "criteria"
  | "evidence"
  | "procedure"
  | "boundaries"
  | "tools"
  | "calibration"
  | "evaluation";

export const FOUNDRY_FACETS: readonly FoundryFacet[] = [
  "objective",
  "interaction",
  "inputs",
  "outputs",
  "criteria",
  "evidence",
  "procedure",
  "boundaries",
  "tools",
  "calibration",
  "evaluation",
];

export type FoundryHistoryEntry = {
  id: string;
  at: number;
  actor: "creator" | "user" | "compiler";
  action:
    | "section_created"
    | "section_answered"
    | "section_edited"
    | "section_dismissed"
    | "section_restored"
    | "mission_updated"
    | "skill_proposed"
    | "release_compiled";
  sectionId?: string;
  /** Snapshot of the section before the change, so it can be restored. */
  previous?: FoundrySection;
  summary: string;
};

export type FoundryState = {
  sections: FoundrySection[];
  history: FoundryHistoryEntry[];
  /** Facets the creator system has decided are irrelevant for this mission. */
  skippedFacets: FoundryFacet[];
};

export function createFoundryState(): FoundryState {
  return { sections: [], history: [], skippedFacets: [] };
}

function stamp(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function addSection(
  state: FoundryState,
  section: Omit<FoundrySection, "createdAt" | "updatedAt" | "status" | "value"> &
    Partial<Pick<FoundrySection, "status" | "value">>,
  now: number,
): FoundryState {
  const created: FoundrySection = {
    ...section,
    status: section.status ?? "open",
    value: section.value ?? { kind: "empty" },
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...state,
    sections: [...state.sections, created].sort((a, b) => a.order - b.order),
    history: [
      ...state.history,
      {
        id: stamp("hist"),
        at: now,
        actor: "creator",
        action: "section_created",
        sectionId: created.id,
        summary: created.prompt.slice(0, 160),
      },
    ],
  };
}

export function answerSection(
  state: FoundryState,
  sectionId: string,
  value: FoundrySectionValue,
  now: number,
): FoundryState {
  const previous = state.sections.find((section) => section.id === sectionId);
  if (!previous) return state;
  const answered = isEmptyValue(value) ? "open" : "answered";
  return {
    ...state,
    sections: state.sections.map((section) =>
      section.id === sectionId
        ? { ...section, value, status: answered, updatedAt: now }
        : section,
    ),
    history: [
      ...state.history,
      {
        id: stamp("hist"),
        at: now,
        actor: "user",
        action:
          previous.status === "answered" ? "section_edited" : "section_answered",
        sectionId,
        previous,
        summary: describeValue(value),
      },
    ],
  };
}

export function dismissSection(
  state: FoundryState,
  sectionId: string,
  now: number,
): FoundryState {
  const previous = state.sections.find((section) => section.id === sectionId);
  if (!previous || previous.status === "dismissed") return state;
  return {
    ...state,
    sections: state.sections.map((section) =>
      section.id === sectionId
        ? { ...section, status: "dismissed", updatedAt: now }
        : section,
    ),
    history: [
      ...state.history,
      {
        id: stamp("hist"),
        at: now,
        actor: "user",
        action: "section_dismissed",
        sectionId,
        previous,
        summary: `Dismissed: ${previous.prompt.slice(0, 120)}`,
      },
    ],
  };
}

/**
 * Restores a section to the state captured in the newest history entry that
 * holds a snapshot for it. Used both for undoing a dismissal and for reverting
 * an edit.
 */
export function restoreSection(
  state: FoundryState,
  sectionId: string,
  now: number,
): FoundryState {
  const snapshot = [...state.history]
    .reverse()
    .find((entry) => entry.sectionId === sectionId && entry.previous);
  if (!snapshot?.previous) return state;
  const restored: FoundrySection = { ...snapshot.previous, updatedAt: now };
  const exists = state.sections.some((section) => section.id === sectionId);
  return {
    ...state,
    sections: (exists
      ? state.sections.map((section) =>
          section.id === sectionId ? restored : section,
        )
      : [...state.sections, restored]
    ).sort((a, b) => a.order - b.order),
    history: [
      ...state.history,
      {
        id: stamp("hist"),
        at: now,
        actor: "user",
        action: "section_restored",
        sectionId,
        summary: `Restored: ${restored.prompt.slice(0, 120)}`,
      },
    ],
  };
}

export function isEmptyValue(value: FoundrySectionValue): boolean {
  switch (value.kind) {
    case "text":
      return value.text.trim().length === 0;
    case "choice":
      return value.selected.length === 0 && !value.other?.trim();
    case "files":
      return value.fileIds.length === 0;
    case "works":
      return value.workIds.length === 0;
    case "examples":
      return value.pairs.length === 0;
    case "permissions":
      return value.toolIds.length === 0;
    case "confirmation":
      return false;
    case "skills":
      return (
        value.approvedSkillIds.length === 0 && value.rejectedSkillIds.length === 0
      );
    case "empty":
      return true;
  }
}

function describeValue(value: FoundrySectionValue): string {
  switch (value.kind) {
    case "text":
      return value.text.slice(0, 160);
    case "choice":
      return [...value.selected, value.other].filter(Boolean).join(", ");
    case "files":
      return `${value.fileIds.length} file(s) attached`;
    case "works":
      return `${value.workIds.length} item(s) referenced`;
    case "examples":
      return `${value.pairs.length} example pair(s)`;
    case "permissions":
      return `${value.toolIds.length} capability selection(s)`;
    case "confirmation":
      return value.accepted ? "Confirmed" : "Declined";
    case "skills":
      return `${value.approvedSkillIds.length} approved, ${value.rejectedSkillIds.length} rejected`;
    case "empty":
      return "Cleared";
  }
}

export function activeSections(state: FoundryState): FoundrySection[] {
  return state.sections.filter((section) => section.status !== "dismissed");
}

export function dismissedSections(state: FoundryState): FoundrySection[] {
  return state.sections.filter((section) => section.status === "dismissed");
}

/** Facets already satisfied by an answered section or explicitly skipped. */
export function coveredFacets(state: FoundryState): Set<FoundryFacet> {
  const covered = new Set<FoundryFacet>(state.skippedFacets);
  for (const section of state.sections) {
    if (section.status === "answered") covered.add(section.facet);
    if (section.status === "dismissed" && !section.required)
      covered.add(section.facet);
  }
  return covered;
}
