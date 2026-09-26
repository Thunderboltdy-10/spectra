import { normalizeArtifactContent } from "../ai/content-normalization";
import type { ArtifactTypeKey } from "../artifacts/types";
import { documentContentToProseMirrorJson } from "../../../../shared/document-projection.mjs";
import { sheetCellEntries } from "../../../../shared/sheet-cells";
import { whiteboardNodeText, type WhiteboardNode } from "../whiteboard/model";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : [];
const text = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;
const anyText = (value: unknown): boolean => Array.isArray(value) ? value.some(anyText) : text(value);
const scalar = (value: unknown): boolean => typeof value === "number" || typeof value === "boolean" || text(value);

function documentBody(value: unknown): boolean {
  const node = row(value);
  if (text(node.text)) return true;
  const attrs = row(node.attrs);
  if (["image", "nativeDocxImage", "video", "audio", "file", "artifactEmbed", "spectraEmbed"].includes(String(node.type)))
    return [attrs.src, attrs.assetId, attrs.artifactId, attrs.workId, attrs.native].some(value => text(value) || Object.keys(row(value)).length > 0);
  if (["equation", "inlineEquation", "math"].includes(String(node.type)))
    return text(attrs.latex) || text(attrs.source) || Object.keys(row(attrs.equation)).length > 0;
  if (["spectraCitation", "bibliography", "footnote", "endnote"].includes(String(node.type)))
    return text(attrs.label) || text(attrs.text) || text(row(attrs.native).text);
  return rows(node.content).some(documentBody);
}

function tableBody(value: unknown): boolean {
  return Array.isArray(value) && value.some(item => Array.isArray(item)
    ? item.some(cell => scalar(cell) || text(row(cell).text) || rows(row(cell).paragraphs).some(paragraph => rows(paragraph.runs).some(run => text(run.text))))
    : false);
}

function presentationObjectBody(object: Row): boolean {
  const content = row(object.content);
  switch (object.type) {
    case "text": return text(content.text) || rows(content.paragraphs).some(paragraph => rows(paragraph.runs).some(run => text(run.text)));
    // Drawn geometry is authored work even without a label. Groups and layout
    // placeholders are containers; their real children are checked separately.
    case "shape": return text(content.shape) || text(content.path) || text(content.text);
    case "image": case "video": return [content.src, content.url, content.assetId, content.nativeMediaPart].some(text);
    case "embed": return [content.artifactId, content.workId, content.url, content.src, object.sourceBinding].some(value => text(value) || Object.keys(row(value)).length > 0);
    case "chart": return rows(content.series).some(series => Array.isArray(series.values) && series.values.some(scalar));
    case "table": return tableBody(content.rows);
    default: return false;
  }
}

function whiteboardNodeBody(node: Row): boolean {
  const content = row(node.content);
  switch (node.type) {
    case "shape": return text(content.shape) || text(content.text);
    case "drawing": return (Array.isArray(content.points) && content.points.length > 0) || text(content.path);
    case "image": return [content.src, content.url, content.assetId].some(text);
    case "embed": return [content.artifactId, content.workId, content.url, content.src].some(text);
    case "table": return tableBody(content.rows);
    case "text": case "note": case "card": return text(whiteboardNodeText(node as unknown as WhiteboardNode));
    default: return false;
  }
}

function agentBody(content: Row): boolean {
  const profile = row(content.profile);
  const foundry = row(content.foundry);
  const sectionAnswer = (section: Row) => {
    const value = row(section.value);
    return text(value.text) || text(value.other) || text(value.note) || anyText(value.selected) || anyText(value.fileIds) || anyText(value.workIds) ||
      rows(value.pairs).some(pair => text(pair.input) || text(pair.output));
  };
  const extractedBody = (binding: Row) => {
    const extraction = row(binding.extraction);
    return rows(extraction.criteria).some(item => text(item.name) || text(item.description) || rows(item.levels).some(level => text(level.descriptor))) ||
      rows(extraction.rules).some(item => text(item.statement)) ||
      rows(extraction.vocabulary).some(item => text(item.term) || text(item.meaning)) ||
      rows(extraction.procedures).some(item => text(item.name) || anyText(item.steps)) ||
      rows(extraction.examples).some(item => text(item.input) || text(item.output) || text(item.commentary)) ||
      rows(extraction.edgeCases).some(item => text(item.situation) || text(item.expectedHandling)) ||
      rows(extraction.contradictions).some(item => text(item.description) || text(row(item.resolution).note)) ||
      rows(extraction.unresolvedQuestions).some(item => text(item.question) || text(item.answer)) ||
      rows(extraction.securityConcerns).some(item => text(item.excerpt));
  };
  const mission = row(foundry.mission);
  return text(row(content.instructions).text) || text(profile.purpose) || anyText(profile.outcomes) ||
    anyText(profile.inScope) || anyText(profile.outOfScope) ||
    rows(content.skills).some(skill => text(skill.instructions)) ||
    rows(content.evals).some(evaluation => text(evaluation.prompt) || text(evaluation.expected)) ||
    rows(content.resources).some(resource => text(resource.artifactId)) ||
    text(mission.objective) || anyText(mission.domains) || anyText(mission.exclusions) ||
    rows(mission.expectedInputs).some(input => text(input.description)) || rows(mission.expectedOutputs).some(output => text(output.description)) ||
    rows(row(foundry.state).sections).some(sectionAnswer) ||
    rows(foundry.evidenceBindings).some(extractedBody) ||
    rows(foundry.skills).some(skill => text(skill.purpose) || rows(skill.procedure).some(step => text(step.action)) ||
      rows(skill.examples).some(example => text(example.input) || text(example.output)));
}

function sheetsHaveValues(content: Row): boolean {
  return rows(content.sheets).some(sheet => sheetCellEntries(sheet.cells).some(([, candidate]) => {
    const cell = row(candidate);
    return scalar(candidate) || scalar(cell.value) || text(cell.formula);
  }));
}

/** Inspect the canonical authored surface, excluding titles, IDs, settings,
 * source catalogues and cached summaries. No size/percentage/quality heuristic
 * decides whether an edit is destructive. */
function hasBody(type: ArtifactTypeKey, canonical: Row, original: Row): boolean {
  switch (type) {
    case "document": return documentBody(documentContentToProseMirrorJson(canonical));
    case "presentation": return rows(original.slides).length > 0 && rows(canonical.slides).some(slide => rows(slide.objects).some(presentationObjectBody));
    case "sheets": return sheetsHaveValues(canonical) || rows(canonical.sheets).some(sheet => rows(sheet.charts).length > 0);
    // Normalizers may manufacture a starter file or slide when a collection is
    // removed. That fallback is not authored replacement content.
    case "code": return rows(original.files).some(file => text(file.source)) || rows(canonical.assets).some(asset => text(asset.assetId));
    case "whiteboard": return rows(canonical.nodes).some(whiteboardNodeBody) || rows(canonical.edges).some(edge => text(edge.from) && text(edge.to));
    case "quiz": return rows(canonical.questions).some(question => text(question.prompt) || text(question.correctAnswer) ||
      // The normalizer generates True/False options for an empty question.
      (question.type !== "true_false" && anyText(question.options)) || text(question.explanation) ||
      rows(question.matchingPairs).some(pair => text(pair.left) || text(pair.right)) || text(row(question.media).assetId));
    case "flashcard_deck": return rows(canonical.cards).some(card => text(card.front) || text(card.back) || text(card.hint) || text(row(card.media).assetId));
    case "planner_task": return text(canonical.description) || text(canonical.progressNote) ||
      (Array.isArray(canonical.tasks)
        ? rows(canonical.tasks).some(task => text(task.title) || text(task.description) || rows(task.checklist).some(item => text(item.title)))
        : text(canonical.taskTitle) || rows(canonical.subtasks).some(task => text(task.title))) ||
      rows(canonical.attachments).some(attachment => text(attachment.assetId));
    case "timetable": return rows(canonical.events).some(event => text(event.title) || text(event.start) || text(event.end));
    case "agent": return agentBody(canonical);
  }
}

export type ArtifactContentWipe = { fullContentDeletion: boolean; reason?: string };

/** A fresh blank artifact or a substantive replacement stays an ordinary edit.
 * For sheets, erasing every value/formula is data deletion even if a residual
 * chart, formatting or workbook scaffold remains. */
export function classifyArtifactContentWipe(type: ArtifactTypeKey, before: unknown, after: unknown): ArtifactContentWipe {
  const prior = row(normalizeArtifactContent(type, structuredClone(before)));
  const next = row(normalizeArtifactContent(type, structuredClone(after)));
  const dataWipe = type === "sheets" && sheetsHaveValues(prior) && !sheetsHaveValues(next);
  const fullContentDeletion = dataWipe || (hasBody(type, prior, row(before)) && !hasBody(type, next, row(after)));
  return fullContentDeletion
    ? { fullContentDeletion: true, reason: dataWipe ? "Clear all populated spreadsheet values and formulas" : "Clear all authored artifact content" }
    : { fullContentDeletion: false };
}
