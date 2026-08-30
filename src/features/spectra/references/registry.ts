import type { ArtifactTypeKey } from "../artifacts/types";

export type ReferenceTargetDefinition = { kind: string; label: string; views: readonly string[] };
export type WorkReferenceContract = {
  type: ArtifactTypeKey;
  targets: readonly ReferenceTargetDefinition[];
  insertion: "tiptap_node" | "slide_element" | "board_object" | "sheet_object" | "detail_block" | "source_element" | "calendar_reference";
};

export const WORK_REFERENCE_CONTRACTS = {
  document: { type: "document", insertion: "tiptap_node", targets: [{ kind: "document", label: "Whole document", views: ["excerpt", "section"] }, { kind: "heading", label: "Heading or section", views: ["excerpt", "section"] }, { kind: "block", label: "Block or selection", views: ["excerpt"] }] },
  sheets: { type: "sheets", insertion: "sheet_object", targets: [{ kind: "sheet", label: "Sheet", views: ["table"] }, { kind: "range", label: "Range", views: ["table", "metric"] }, { kind: "chart", label: "Chart", views: ["chart"] }] },
  presentation: { type: "presentation", insertion: "slide_element", targets: [{ kind: "deck", label: "Presentation", views: ["slide_strip"] }, { kind: "slide", label: "Slide", views: ["slide"] }, { kind: "element", label: "Element", views: ["element"] }] },
  whiteboard: { type: "whiteboard", insertion: "board_object", targets: [{ kind: "frame", label: "Frame", views: ["viewport"] }, { kind: "objects", label: "Selected objects", views: ["viewport"] }, { kind: "viewport", label: "Captured viewport", views: ["viewport"] }] },
  code: { type: "code", insertion: "source_element", targets: [{ kind: "project", label: "Project", views: ["source", "preview"] }, { kind: "file", label: "File", views: ["source"] }, { kind: "range", label: "Line range", views: ["source"] }, { kind: "output", label: "Preview or output", views: ["preview"] }] },
  quiz: { type: "quiz", insertion: "source_element", targets: [{ kind: "quiz", label: "Quiz", views: ["preview", "attempt"] }, { kind: "question", label: "Question", views: ["preview"] }, { kind: "results", label: "Results summary", views: ["results"] }] },
  flashcard_deck: { type: "flashcard_deck", insertion: "source_element", targets: [{ kind: "deck", label: "Deck", views: ["browse", "study"] }, { kind: "section", label: "Section", views: ["browse"] }, { kind: "card", label: "Card", views: ["card"] }] },
  planner_task: { type: "planner_task", insertion: "detail_block", targets: [{ kind: "plan", label: "Plan", views: ["list", "board", "timeline", "workload"] }, { kind: "task", label: "Task", views: ["detail"] }, { kind: "milestone", label: "Milestone", views: ["detail"] }] },
  agent: { type: "agent", insertion: "source_element", targets: [{ kind: "release", label: "Agent release", views: ["use_card", "capability"] }, { kind: "skill", label: "Skill", views: ["capability"] }, { kind: "evidence", label: "Evidence summary", views: ["evidence"] }] },
  timetable: { type: "timetable", insertion: "calendar_reference", targets: [{ kind: "event", label: "Calendar event", views: ["agenda"] }, { kind: "time_range", label: "Time range", views: ["agenda"] }] },
} as const satisfies Record<ArtifactTypeKey, WorkReferenceContract>;

export function getWorkReferenceContract(type: ArtifactTypeKey): WorkReferenceContract {
  return WORK_REFERENCE_CONTRACTS[type];
}

export function validateReferenceView(type: ArtifactTypeKey, kind: string, view?: string) {
  const target = getWorkReferenceContract(type).targets.find((entry) => entry.kind === kind);
  return Boolean(target && (!view || (target.views as readonly string[]).includes(view)));
}

export type BoardCapture = { objectIds: string[]; frameId?: string; camera: { x: number; y: number; zoom: number; width: number; height: number } };
export function createBoardCapture(input: BoardCapture): BoardCapture {
  const objectIds = [...new Set(input.objectIds.filter(Boolean))];
  if (!objectIds.length && !input.frameId) throw new Error("BOARD_CAPTURE_TARGET_REQUIRED");
  return { ...input, objectIds, camera: { ...input.camera, zoom: Math.max(0.05, Math.min(8, input.camera.zoom)) } };
}

export function resolveBoardCapture(capture: BoardCapture, existingObjectIds: readonly string[]) {
  const existing = new Set(existingObjectIds);
  const available = capture.objectIds.filter((id) => existing.has(id));
  const missing = capture.objectIds.filter((id) => !existing.has(id));
  return { capture, available, missing, status: missing.length ? (available.length ? "partial" : "missing") : "ready" } as const;
}

export function suggestReferencePlacement(input: { confidence: number; referencedWorkId: string; workspaceId?: string; alreadyPlaced: boolean; rawSpectraUrl?: string }) {
  if (input.confidence < 0.86 || input.alreadyPlaced) return null;
  return { id: `place:${input.referencedWorkId}:${input.workspaceId ?? "none"}`, kind: input.rawSpectraUrl ? "replace_url" : "place_work", dismissible: true } as const;
}
