import { verifyCitation, type EvidenceSpan, type SourceRecord } from "../../sources/records/source-record";
import type { DocumentAcademicOperation } from "./document-academic-operations";

/** Server verification uses the existing research evidence contract. */
export function verifyAcademicSourceHandles(value: unknown, operations: readonly DocumentAcademicOperation[]) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const bundle = (source.sourceBundle ?? source) as { sources?: SourceRecord[]; evidence?: EvidenceSpan[] };
  for (const operation of operations) if (operation.kind === "insert-word-citation" && operation.sourceHandle) verifyCitation(operation.sourceHandle, bundle.sources ?? [], bundle.evidence ?? []);
}
