import {
  getArtifactTypeManifest,
  validateArtifactContent,
} from "../../artifacts/registry";
import {
  WORK_TYPE_KEYS,
  type ArtifactTypeKey,
} from "../../artifacts/types";
import type {
  WorkDefinition,
  WorkModeDefinition,
  WorkResponsiveContract,
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

const modes = {
  document: ["Write", "Read", "Review", "Focus"],
  flashcard_deck: ["Build", "Browse", "Study", "Progress"],
  quiz: ["Build", "Preview", "Attempt", "Responses", "Results"],
  planner_task: ["List", "Board", "Timeline", "Review"],
  agent: ["Build", "Use", "Evaluate", "Releases"],
  timetable: ["Calendar", "Tasks", "Agenda"],
  presentation: ["Edit", "Present", "Notes"],
  sheets: ["Edit", "Analyse", "Read"],
  code: ["Source", "Preview", "Split", "Run", "Settings"],
  whiteboard: ["Edit", "Read"],
} satisfies Record<ArtifactTypeKey, readonly string[]>;

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

function modeDefinitions(type: ArtifactTypeKey): WorkModeDefinition[] {
  return modes[type].map((label, index) => ({
    id: label.toLowerCase().replaceAll(/\s+/g, "_"),
    label,
    requiredCapability:
      /read|browse|study|preview|present/i.test(label)
        ? "view"
        : /attempt/i.test(label)
          ? "attempt"
          : /run/i.test(label)
            ? "execute"
            : "edit",
    primary: index === 0,
  }));
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
    permissions: {
      readOnly: ["view", "interact"],
      edit: ["view", "edit", "interact", "ai_mutate"],
    },
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
