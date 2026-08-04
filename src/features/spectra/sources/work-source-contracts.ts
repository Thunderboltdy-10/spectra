import type { ArtifactTypeKey } from "../artifacts/types";
import type { EvidenceSpan, SourceRecord, VerifiedCitation } from "./records/source-record";

export type WorkSourceContract = {
  type: ArtifactTypeKey;
  placements: readonly string[];
  sourceViews: readonly string[];
  exportTargets: readonly string[];
  preservesOnConversion: true;
};

export const WORK_SOURCE_CONTRACTS = {
  document: { type: "document", placements: ["citation_node", "footnote", "endnote", "bibliography"], sourceViews: ["navigator", "pdf_page"], exportTargets: ["docx", "pdf", "html"], preservesOnConversion: true },
  sheets: { type: "sheets", placements: ["cell", "range", "chart", "import_lineage"], sourceViews: ["cell_metadata", "dashboard_label"], exportTargets: ["xlsx", "csv", "pdf"], preservesOnConversion: true },
  presentation: { type: "presentation", placements: ["element", "slide_footer", "speaker_note", "bibliography_slide"], sourceViews: ["slide_sources", "notes"], exportTargets: ["pptx", "pdf"], preservesOnConversion: true },
  whiteboard: { type: "whiteboard", placements: ["object", "frame", "reference", "source_card"], sourceViews: ["selection_panel"], exportTargets: ["png", "pdf", "json"], preservesOnConversion: true },
  code: { type: "code", placements: ["file", "range", "output", "documentation"], sourceViews: ["provenance_panel"], exportTargets: ["project", "zip", "html"], preservesOnConversion: true },
  quiz: { type: "quiz", placements: ["question", "explanation"], sourceViews: ["learner_reveal", "coverage"], exportTargets: ["json", "pdf"], preservesOnConversion: true },
  flashcard_deck: { type: "flashcard_deck", placements: ["card", "explanation"], sourceViews: ["learner_reveal", "coverage"], exportTargets: ["csv", "json", "pdf"], preservesOnConversion: true },
  planner_task: { type: "planner_task", placements: ["task", "milestone", "official_deadline"], sourceViews: ["task_detail", "calendar_provenance"], exportTargets: ["csv", "json", "ics"], preservesOnConversion: true },
  agent: { type: "agent", placements: ["evidence_pack", "skill_binding", "release"], sourceViews: ["evidence_version", "skill_map"], exportTargets: ["package", "json"], preservesOnConversion: true },
  timetable: { type: "timetable", placements: ["official_event", "deadline"], sourceViews: ["provider", "timestamp"], exportTargets: ["ics", "json"], preservesOnConversion: true },
} as const satisfies Record<ArtifactTypeKey, WorkSourceContract>;

export function getWorkSourceContract(type: ArtifactTypeKey): WorkSourceContract {
  return WORK_SOURCE_CONTRACTS[type];
}

export type PortableSourceBundle = { sources: SourceRecord[]; evidence: EvidenceSpan[]; citations: VerifiedCitation[] };
export function createPortableSourceBundle(input: PortableSourceBundle): PortableSourceBundle {
  const sourceIds = new Set(input.sources.filter((source) => source.verified).map((source) => source.id));
  const evidenceIds = new Set(input.evidence.filter((span) => sourceIds.has(span.sourceId)).map((span) => span.id));
  const citations = input.citations.filter((citation) => sourceIds.has(citation.sourceId) && citation.evidenceIds.length > 0 && citation.evidenceIds.every((id) => evidenceIds.has(id)));
  if (citations.length !== input.citations.length) throw new Error("SOURCE_BUNDLE_CONTAINS_UNVERIFIED_CITATION");
  return { sources: [...input.sources], evidence: [...input.evidence], citations: [...citations] };
}

export function preserveSourcesThroughConversion<T>(content: T, bundle: PortableSourceBundle, targetType: ArtifactTypeKey) {
  return { content, sourceBundle: createPortableSourceBundle(bundle), targetContract: getWorkSourceContract(targetType) };
}
