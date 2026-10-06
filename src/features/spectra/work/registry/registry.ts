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
    // Reading stays at `view`: a read-only collaborator may legitimately look at
    // the learner-facing form. Whether a *learner* is offered it is the quiz's
    // own configuration question, answered by `availableQuizModes`.
    ["Preview as learner", "view"],
    ["Attempt", "attempt"],
    // The cohort report is owner-only on the server: `quizPractice.aggregateForOwner`
    // requires `modify`. Declaring it at `submit` offered a read-only learner a
    // door the backend then refused to open.
    ["Responses", "edit"],
    ["Results", "view"],
  ],
  planner_task: [
    // Three readings of one task set, each editable in place. There is no
    // reading/writing twin here the way a document has Edit and Preview, so
    // none of these is a permission printed as a tab (D1/D2) and all three are
    // `view` — a read-only collaborator could previously open a shared plan
    // only in `Review`, which no surface implemented. `Review` is gone rather
    // than left as a door onto nothing.
    ["List", "view"],
    ["Board", "view"],
    ["Timeline", "view"],
  ],
  // Overview is how an agent is read: it is the mission, the
  // approved skills and the sources, and declaring it `edit` left a read-only
  // viewer with Releases and no way to see what the agent actually is. Checks
  // is `edit` because the server agrees — `agents.evalRuns` and
  // `agents.analytics` both require `modify`. Using the agent is not a mode: an
  // agent is used in a conversation, which is a surface of its own, and the
  // Foundry has no single-turn invoke route behind it (the same reasoning that
  // keeps Present off presentation and Run off code).
  agent: [
    ["Overview", "view"],
    // The bench runs the draft on sample questions; it needs `modify`, as
    // `agents.benchCases` and the bench route do.
    ["Bench", "edit"],
    ["Checks", "edit"],
    ["Releases", "view"],
  ],
  timetable: [
    ["Calendar", "view"],
    ["Tasks", "edit"],
    ["Agenda", "view"],
  ],
  // Slides and Notes are the two things a deck is looked at through, and both
  // are readable by anyone the deck is shared with — an editor edits in place
  // rather than entering an editing mode (CANON D1). Presenting is not here on
  // purpose: it is an activity with an obvious exit, reached from the primary
  // verb under the `present` capability, not a peer tab beside authoring (D2/D3).
  presentation: [
    ["Slides", "view"],
    ["Notes", "view"],
  ],
  // Grid and Analysis are the two things a sheet is looked at through, and both
  // are readable by anyone it is shared with: an editor edits in place rather
  // than entering an editing mode (D1), and a compact or read-only pane is the
  // same view without a grant, not a different one (D4). `Edit`/`View` was a
  // permission printed as a tab pair, which is exactly what D1 rules out, and
  // `Analyse` at `interact` was a door onto nothing — the studio never
  // implemented it. Analysis is real now: descriptive statistics measured from
  // the calculated workbook, plus the charts that read from the sheet.
  sheets: [
    ["Grid", "view"],
    ["Analysis", "view"],
  ],
  // Code and Both are how source is looked at, so both are readable by anyone
  // the artifact is shared with: an editor edits in place (D1) and Both is never
  // a read-only split (D4). Declaring them as `edit` was a real defect — a
  // read-only viewer lost the source view entirely and was left with the
  // rendered output. Running is not a mode: it is an action gated on `execute`,
  // reached from the primary verb, not a peer tab beside authoring (D2/D3).
  // Settings is the same class of thing: configuration, reached from the bar,
  // never a fourth peer tab that crushes the file selector.
  code: [
    ["Code", "view"],
    ["Visualisation", "interact"],
    ["Both", "view"],
  ],
  // A board has one surface: the canvas. `Edit` and `View` were a permission
  // printed as a tab pair, which is what D1 rules out — an owner edits in place
  // and never enters an editing mode, and a read-only viewer is not looking at a
  // different view of the board, only at the same one without a grant. Present
  // is not here for the same reason it is absent from presentation: it is an
  // activity reached under the `present` capability, not a peer tab (D2/D3).
  whiteboard: [["Canvas", "view"]],
} satisfies Record<
  ArtifactTypeKey,
  readonly (readonly [string, WorkCapability])[]
>;

const responsive = {
  document: [360, 760],
  flashcard_deck: [340, 720],
  quiz: [360, 760],
  planner_task: [360, 800],
  // The Foundry's competence ledger and its authoring stream stop fitting side
  // by side at 1020px, where the stylesheet stacks them. 840 told the studio the
  // pane was comfortable while the layout had already broken, which is what lost
  // the authoring surface between 840 and 1020: the preferred size has to be the
  // width the two-column layout actually needs.
  agent: [380, 1040],
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
  // All five are real in `whiteboard-studio.tsx`: Tab walks the objects in
  // reading order and reveals each one, the outline panel lists objects and
  // connectors with their metadata, arrow keys nudge (Shift for a grid step),
  // Ctrl+G groups, and arrow keys pan with `+`/`-`/`0` for zoom and fit.
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
    canvasExtent: type === "presentation" ? "bounded" : "infinite",
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
