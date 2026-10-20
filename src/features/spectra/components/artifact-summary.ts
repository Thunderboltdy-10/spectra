import { isArtifactTypeKey, requireArtifactTypeManifest } from "../artifacts/registry";
import { isGeneratedArtifactSummary } from "../operations/hollow-content";

/**
 * Whether a work's summary says something under its title (EDITORS.md, "The
 * header"). A type's own description ("Structured writing, notes, and
 * authored resources.") or a generated count ("5-question quiz about …") is
 * not worth a line on every work, so the header leaves it out.
 */
export function summaryWorthShowing(summary: string, blueprintKey: string) {
  const clean = summary.trim();
  if (!clean) return false;
  if (!isArtifactTypeKey(blueprintKey)) return true;
  return !isGeneratedArtifactSummary(clean, blueprintKey) && clean !== requireArtifactTypeManifest(blueprintKey).identity.description;
}
