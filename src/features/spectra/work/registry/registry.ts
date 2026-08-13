import {
  getArtifactTypeManifest,
  validateArtifactContent,
} from "../../artifacts/registry";
import {
  WORK_TYPE_KEYS,
  type ArtifactTypeKey,
} from "../../artifacts/types";
import type {
  WorkAccessibilityContract,
  WorkCapability,
  WorkDefinition,
  WorkEmptyState,
  WorkModeDefinition,
  WorkResponsiveContract,
  WorkSharingRole,
  WorkSurface,
} from "./types";

const names = {
  document: "Document",
  flashcard_deck: "Flashcards",
  quiz: "Quiz",
  planner_task: "Plan",
  agent: "Agent",
  timetable: "Calendar",
  presentation: "Presentation",
  sheets: "Sheet",
  code: "Code",
  whiteboard: "Board",
} satisfies Record<ArtifactTypeKey, string>;

/**
 * Modes are the user-facing choices for a type, each paired with the capability
 * it needs. The capability is declared rather than guessed from the label, so a
 * rename cannot quietly turn a learner mode into an editing one.
 */
const modes = {
  document: [
    ["Edit", "edit"],
    ["Preview as reader", "view"],
  ],
  flashcard_deck: [
    ["Build", "edit"],
    ["Browse", "view"],
    ["Study", "attempt"],
    ["Progress", "view"],
  ],
  quiz: [
    ["Build", "edit"],
    ["Preview as learner", "view"],
    ["Attempt", "attempt"],
    ["Responses", "submit"],
    ["Results", "view"],
  ],
  planner_task: [
    ["List", "edit"],
    ["Board", "edit"],
    ["Timeline", "edit"],
    ["Review", "interact"],
  ],
  agent: [
    ["Build", "edit"],
    ["Use", "interact"],
    ["Evaluate", "edit"],
    ["Releases", "view"],
  ],
  timetable: [
    ["Calendar", "view"],
    ["Tasks", "edit"],
    ["Agenda", "view"],
  ],
  presentation: [
    ["Edit", "edit"],
    ["Present", "present"],
    ["Notes", "edit"],
  ],
  sheets: [
    ["Edit", "edit"],
    ["Analyse", "interact"],
    ["View", "view"],
  ],
  code: [
    ["Source", "edit"],
    ["Preview", "interact"],
    ["Split", "edit"],
    ["Run", "execute"],
    ["Settings", "edit"],
  ],
  whiteboard: [
    ["Edit", "edit"],
    ["View", "view"],
  ],
} satisfies Record<
  ArtifactTypeKey,
  readonly (readonly [string, WorkCapability])[]
>;

const responsive = {
  document: [360, 760],
  flashcard_deck: [340, 720],
  quiz: [360, 760],
  planner_task: [360, 800],
  agent: [380, 840],
  timetable: [420, 920],
  presentation: [480, 960],
  sheets: [520, 1040],
  code: [480, 1000],
  whiteboard: [460, 980],
} satisfies Record<ArtifactTypeKey, readonly [number, number]>;

/**
 * The operations that must be reachable from the keyboard alone. The manifest
 * already names the navigation model; this names what has to work inside it.
 */
const keyboardOperations = {
  document: [
    "move by heading",
    "select block",
    "apply formatting",
    "insert reference",
    "open find and replace",
  ],
  flashcard_deck: [
    "move between cards",
    "reveal answer",
    "grade card",
    "edit a side",
    "filter the deck",
  ],
  quiz: [
    "move between questions",
    "choose an option",
    "enter a response",
    "submit an attempt",
    "open an explanation",
  ],
  planner_task: [
    "move between tasks",
    "change status",
    "reorder a task",
    "open task detail",
    "schedule a work block",
  ],
  agent: [
    "move between sections",
    "answer a question",
    "remove or restore a section",
    "run an evaluation",
    "open a release",
  ],
  timetable: ["move by day", "move by week", "open an event"],
  presentation: [
    "move between slides",
    "select an element",
    "nudge an element",
    "edit element text",
    "start and leave Present",
  ],
  sheets: [
    "move by cell",
    "extend a range",
    "edit a formula",
    "sort or filter",
    "select a chart",
  ],
  code: [
    "move between files",
    "jump to a line",
    "open find and replace",
    "run the project",
    "read diagnostics",
  ],
  whiteboard: [
    "move between objects",
    "read the spatial outline",
    "nudge an object",
    "group a selection",
    "pan and zoom",
  ],
} satisfies Record<ArtifactTypeKey, readonly string[]>;

/**
 * Empty-state copy lives with the definition so every surface that can be empty
 * says the same thing, in the interface's voice, with one next action.
 */
const emptyStates = {
  document: {
    headline: "Start writing",
    body: "Add a heading, paste your research, or ask Spectra to draft the first section.",
    action: "Add a heading",
  },
  flashcard_deck: {
    headline: "No cards yet",
    body: "Write cards yourself, or generate them from a source you have already added.",
    action: "Add a card",
  },
  quiz: {
    headline: "No questions yet",
    body: "Write a question, or build a set from the sources attached to this quiz.",
    action: "Add a question",
  },
  planner_task: {
    headline: "Nothing planned yet",
    body: "Add a task or a milestone, then schedule the work in Calendar.",
    action: "Add a task",
  },
  agent: {
    headline: "Describe what this agent should do",
    body: "State the objective and Spectra proposes the skills, checks and sources it needs.",
    action: "Set the objective",
  },
  timetable: {
    headline: "Nothing scheduled",
    body: "Connect your school account to see official events and deadlines here.",
    action: "Open School",
  },
  presentation: {
    headline: "One empty slide",
    body: "Add a title, or outline the talk and let Spectra build the slides from it.",
    action: "Add a slide",
  },
  sheets: {
    headline: "Empty sheet",
    body: "Type a value, paste a table, or import a spreadsheet to start from real data.",
    action: "Import data",
  },
  code: {
    headline: "No files yet",
    body: "Create a file, or import a project archive to work on something existing.",
    action: "New file",
  },
  whiteboard: {
    headline: "Empty board",
    body: "Drop a shape, write a note, or paste a reference to work you already have.",
    action: "Add a note",
  },
} satisfies Record<ArtifactTypeKey, WorkEmptyState>;

function modeDefinitions(type: ArtifactTypeKey): WorkModeDefinition[] {
  return modes[type].map(([label, requiredCapability], index) => ({
    id: label.toLowerCase().replaceAll(/\s+/g, "_"),
    label,
    requiredCapability,
    primary: index === 0,
  }));
}

/**
 * Sharing grants Read-only or Edit and nothing else. Everything past viewing —
 * attempting, presenting, running — is an internal capability derived from what
 * the type can actually do, so a read-only learner can still sit a quiz and a
 * read-only reviewer can still run a project when its runtime policy allows it.
 */
function permissionsFor(
  type: ArtifactTypeKey,
): WorkDefinition["permissions"] {
  const manifest = getArtifactTypeManifest(type);
  if (!manifest) throw new Error(`WORK_DEFINITION_MISSING: ${type}`);
  const { canPresent, canExecute, canAssessFormatively } =
    manifest.capabilities;
  // Interacting is not editing: selecting, filtering, navigating and commenting
  // are how a viewer reads anything, so every role gets them.
  const readOnly: WorkCapability[] = ["view", "interact"];
  if (canAssessFormatively) readOnly.push("attempt", "submit");
  if (canPresent) readOnly.push("present");
  if (canExecute) readOnly.push("execute");
  return {
    readOnly,
    // Edit is a superset: an editor never loses a capability a viewer has.
    edit: [...readOnly, "edit", "ai_mutate"],
  };
}
function accessibilityContract(
  type: ArtifactTypeKey,
): WorkAccessibilityContract {
  const manifest = getArtifactTypeManifest(type);
  if (!manifest) throw new Error(`WORK_DEFINITION_MISSING: ${type}`);
  return {
    primaryModel: manifest.quality.primaryAccessibilityModel,
    keyboardOperations: keyboardOperations[type],
  };
}

function responsiveContract(type: ArtifactTypeKey): WorkResponsiveContract {
  const [minInlineSize, preferredInlineSize] = responsive[type];
  return {
    minInlineSize,
    preferredInlineSize,
    supportsPanel: true,
    supportsTile: true,
    supportsCompact: true,
    toolbarPriorities: ["mode", "primary", "contextual", "overflow"],
  };
}

function definition(type: ArtifactTypeKey): WorkDefinition {
  const manifest = getArtifactTypeManifest(type);
  if (!manifest) throw new Error(`WORK_DEFINITION_MISSING: ${type}`);
  const surfaces: Record<WorkSurface, string | null> = {
    full: manifest.renderers.full,
    panel: manifest.renderers.panel,
    tile: manifest.renderers.compact,
    read_only: manifest.renderers.historical,
    reference_collapsed: manifest.renderers.embedCompact,
    reference_expanded: manifest.renderers.embedExpanded,
    public: manifest.renderers.historical,
    print: manifest.renderers.print,
  };
  return {
    key: type,
    internalName: type,
    userFacingName: names[type],
    description: manifest.identity.description,
    model: {
      schemaVersion: manifest.schemas.currentVersion,
      validate: (value) => validateArtifactContent(type, value),
      deriveSemanticRegions: (value) => manifest.regions(value),
    },
    modes: modeDefinitions(type),
    surfaces,
    collaboration: {
      partition:
        manifest.collaboration.roomPartition === "artifact"
          ? "work"
          : manifest.collaboration.roomPartition,
      defaultPolicy: "mergeable",
    },
    permissions: permissionsFor(type),
    capabilities: {
      present: manifest.capabilities.canPresent,
      execute: manifest.capabilities.canExecute,
      assess: manifest.capabilities.canAssessFormatively,
      embedInteractively: manifest.capabilities.canEmbedInteractively,
    },
    comments: {
      anchorKinds: manifest.collaboration.commentAnchors,
      supportsGeneral: true,
    },
    history: {
      snapshot: manifest.history.snapshot,
      partialRestore: manifest.history.partialRestore,
    },
    interoperability: {
      imports: manifest.interoperability.imports,
      exports: manifest.interoperability.exports,
      quarantinesExecutableContent:
        manifest.interoperability.quarantinesExecutableContent,
    },
    accessibility: accessibilityContract(type),
    emptyState: emptyStates[type],
    anchors: {
      fromRegion: (workId, region) => ({
        workId,
        workType: type,
        kind: region.kind,
        path: region.path.map(String),
        stableIds: { regionId: region.regionId },
        fallbackExcerpt: region.readableText,
        schemaVersion: manifest.schemas.currentVersion,
      }),
    },
    references: {
      collapsed: manifest.renderers.embedCompact,
      expanded: manifest.renderers.embedExpanded,
    },
    sources: {
      supported: true,
      citationKinds: ["source", "evidence", "linked_work"],
    },
    actions: manifest.operations,
    commands: manifest.operations,
    responsive: responsiveContract(type),
  };
}

export const WORK_DEFINITIONS = Object.freeze(
  Object.fromEntries(
    WORK_TYPE_KEYS.map((type) => [type, definition(type)]),
  ) as Record<(typeof WORK_TYPE_KEYS)[number], WorkDefinition>,
);

export function getWorkDefinition(type: ArtifactTypeKey) {
  // Legacy timetable work remains readable only through this compatibility
  // adapter. It is deliberately absent from WORK_DEFINITIONS/listing paths.
  return type === "timetable"
    ? definition("timetable")
    : WORK_DEFINITIONS[type];
}

export function listWorkDefinitions() {
  return WORK_TYPE_KEYS.map((type) => WORK_DEFINITIONS[type]);
}

export function workCapabilities(
  type: ArtifactTypeKey,
  role: WorkSharingRole,
): readonly WorkCapability[] {
  const permissions = getWorkDefinition(type).permissions;
  return role === "edit" ? permissions.edit : permissions.readOnly;
}

export function workCan(
  type: ArtifactTypeKey,
  role: WorkSharingRole,
  capability: WorkCapability,
) {
  return workCapabilities(type, role).includes(capability);
}

/**
 * Modes a person can actually use here. A mode whose capability this role lacks
 * is not shown disabled — it is absent, because offering a door that cannot open
 * is worse than not mentioning the room.
 */
export function availableWorkModes(
  type: ArtifactTypeKey,
  role: WorkSharingRole,
): readonly WorkModeDefinition[] {
  const granted = new Set(workCapabilities(type, role));
  const usable = getWorkDefinition(type).modes.filter((mode) =>
    granted.has(mode.requiredCapability),
  );
  // Whatever the role, at least one mode has to remain reachable, and viewing
  // is the mode every role can always be given.
  return usable.length
    ? usable
    : getWorkDefinition(type).modes.filter(
        (mode) => mode.requiredCapability === "view",
      );
}
