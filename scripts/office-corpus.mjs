import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// External Office-authored packages are local integration data. Public unit
// tests create their own inputs; these suites also exercise the external corpus.
export const officeCorpusSuites = [
  "src/features/spectra/__tests__/docx-academic-citations.test.ts",
  "src/features/spectra/__tests__/docx-academic-notes.test.ts",
  "src/features/spectra/__tests__/docx-adapter.test.ts",
  "src/features/spectra/__tests__/docx-lens.test.ts",
  "src/features/spectra/__tests__/docx-word-review-projection.test.ts",
  "src/features/spectra/__tests__/parser-limits.test.ts",
  "src/features/spectra/__tests__/pptx-materialization-route.test.ts",
  "src/features/spectra/__tests__/pptx-media.test.ts",
  "src/features/spectra/__tests__/pptx-office-depth.test.ts",
  "src/features/spectra/__tests__/pptx-transition.test.ts",
  "src/features/spectra/__tests__/presentation-io.test.ts",
  "src/features/spectra/__tests__/preservation-proof.test.ts",
  "src/features/spectra/__tests__/s11-office-models.test.ts",
  "src/features/spectra/__tests__/s11-office-review.test.ts",
  "src/features/spectra/__tests__/seam-contract.test.ts",
  "src/features/spectra/__tests__/w6-05-presentation-native.test.ts",
  "src/features/spectra/__tests__/w7-06-powerpoint-owned-content.test.ts",
  "src/features/spectra/__tests__/xlsx-materialization-route.test.ts",
  "src/features/spectra/__tests__/xlsx-pptx-lens.test.ts",
  "src/features/spectra/__tests__/xlsx-w6-04.test.ts",
  "src/features/spectra/files/__tests__/office-preview-document-depth.test.ts",
  "src/features/spectra/files/__tests__/office-preview-sheet-depth.test.ts",
  "src/features/spectra/files/__tests__/office-preview.test.ts"
];
const corpusFiles = [
  "docx/bibliography-source.docx",
  "docx/bibliography-source.fixture.json",
  "docx/complex-structure.docx",
  "docx/complex-structure.fixture.json",
  "docx/content-controls-customxml.docx",
  "docx/content-controls-customxml.fixture.json",
  "docx/corrupt.docx",
  "docx/corrupt.fixture.json",
  "docx/embedded-ole.docx",
  "docx/embedded-ole.fixture.json",
  "docx/equation-omml.docx",
  "docx/equation-omml.fixture.json",
  "docx/fields-toc.docx",
  "docx/fields-toc.fixture.json",
  "docx/floating-textbox.docx",
  "docx/floating-textbox.fixture.json",
  "docx/footnotes-endnotes.docx",
  "docx/footnotes-endnotes.fixture.json",
  "docx/macro-enabled.docm",
  "docx/macro-enabled.fixture.json",
  "docx/multilevel-numbering.docx",
  "docx/multilevel-numbering.fixture.json",
  "docx/password-protected.docx",
  "docx/password-protected.fixture.json",
  "docx/section-headers-footers.docx",
  "docx/section-headers-footers.fixture.json",
  "docx/smartart.docx",
  "docx/smartart.fixture.json",
  "docx/tracked-changes.docx",
  "docx/tracked-changes.fixture.json",
  "docx/unknown-extension.docx",
  "docx/unknown-extension.fixture.json",
  "pptx/animation-timing.fixture.json",
  "pptx/animation-timing.pptx",
  "pptx/chart-notes-preservation.fixture.json",
  "pptx/chart-notes-preservation.pptx",
  "pptx/masters-media-preservation.fixture.json",
  "pptx/masters-media-preservation.pptx",
  "pptx/media-preservation.fixture.json",
  "pptx/media-preservation.pptx",
  "pptx/transition-law.fixture.json",
  "pptx/transition-law.pptx",
  "pptx/typical-preservation.fixture.json",
  "pptx/typical-preservation.pptx",
  "sequences/docx-table-then-external-format.json",
  "sequences/pptx-add-object-undo-rematerialize.json",
  "sequences/xlsx-clear-then-sort.json",
  "xlsx/active-x-preservation.fixture.json",
  "xlsx/active-x-preservation.xlsm",
  "xlsx/comments-preservation.fixture.json",
  "xlsx/comments-preservation.xlsx",
  "xlsx/complex-preservation.fixture.json",
  "xlsx/complex-preservation.xlsx",
  "xlsx/pivot-preservation.fixture.json",
  "xlsx/pivot-preservation.xlsx",
  "xlsx/representative.fixture.json",
  "xlsx/representative.xlsm"
];

export function missingOfficeCorpus() {
  return corpusFiles.filter((name) => !existsSync(resolve(root, "fixtures/office", name)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const missing = missingOfficeCorpus();
  if (missing.length) {
    console.error(`Office integration corpus is incomplete (${missing.length} missing files). See docs/TESTING.md.`);
    process.exitCode = 1;
  } else if (process.argv.includes("--test")) {
    const result = spawnSync(process.execPath, [resolve(root, "node_modules/vitest/vitest.mjs"), "run", ...officeCorpusSuites], { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } else {
    console.log("Local Office integration corpus is complete.");
  }
}
