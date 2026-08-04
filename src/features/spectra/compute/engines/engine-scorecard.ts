export const ENGINE_CRITERIA = [
  "license",
  "bundleRuntimeCost",
  "mobileViability",
  "transparentDataModel",
  "semanticActionSupport",
  "yjsAdaptability",
  "anchorSelectionApis",
  "conflictingUiSuppression",
  "importExportQuality",
  "codeOnlyTestability",
  "maintenance",
  "migrationCost",
  "benefitOverNative",
] as const;

export type EngineCriterion = (typeof ENGINE_CRITERIA)[number];
export type EngineScore = 0 | 1 | 2 | 3 | 4 | 5;
export type EngineScorecard = {
  id: string;
  name: string;
  version: string;
  license: string;
  integration: "headless_engine" | "parser" | "runtime" | "not_adopted";
  foreignProductShell: false;
  scores: Record<EngineCriterion, EngineScore>;
  total: number;
  disposition: "adopted" | "retained" | "not_adopted";
  rationale: string;
};

function scorecard(
  input: Omit<EngineScorecard, "total" | "foreignProductShell">,
): EngineScorecard {
  return {
    ...input,
    foreignProductShell: false,
    total: ENGINE_CRITERIA.reduce((total, criterion) => total + input.scores[criterion], 0),
  };
}

const strongHeadless = {
  transparentDataModel: 5,
  semanticActionSupport: 4,
  yjsAdaptability: 4,
  anchorSelectionApis: 3,
  conflictingUiSuppression: 5,
  codeOnlyTestability: 5,
} as const;

export const OPEN_SOURCE_ENGINE_SCORECARDS = [
  scorecard({
    id: "pyodide",
    name: "Pyodide",
    version: "314.0.2",
    license: "MPL-2.0",
    integration: "runtime",
    disposition: "retained",
    rationale: "Retained as a network-disabled, cancellable worker runtime with bounded files, approved packages and server degradation.",
    scores: { license: 5, bundleRuntimeCost: 2, mobileViability: 2, ...strongHeadless, importExportQuality: 4, maintenance: 5, migrationCost: 5, benefitOverNative: 5 },
  }),
  scorecard({
    id: "pdfjs",
    name: "PDF.js",
    version: "5.4.624",
    license: "Apache-2.0",
    integration: "parser",
    disposition: "retained",
    rationale: "Retained behind the replaceable PDF Inspector contract for positioned text and page classification; the original remains the visual truth and no OCR is claimed.",
    scores: { license: 5, bundleRuntimeCost: 3, mobileViability: 4, ...strongHeadless, semanticActionSupport: 3, anchorSelectionApis: 5, importExportQuality: 4, maintenance: 5, migrationCost: 5, benefitOverNative: 5 },
  }),
  scorecard({
    id: "firecrawl-pdf-inspector",
    name: "Firecrawl PDF Inspector",
    version: "unversioned-candidate",
    license: "Requires package-level confirmation",
    integration: "not_adopted",
    disposition: "not_adopted",
    rationale: "Not adopted because no stable standalone browser/WASM package is present and bundle/mobile/maintenance gates cannot be established. The adapter remains replaceable.",
    scores: { license: 1, bundleRuntimeCost: 2, mobileViability: 2, transparentDataModel: 3, semanticActionSupport: 3, yjsAdaptability: 3, anchorSelectionApis: 3, conflictingUiSuppression: 5, importExportQuality: 3, codeOnlyTestability: 2, maintenance: 2, migrationCost: 3, benefitOverNative: 2 },
  }),
  scorecard({
    id: "esbuild-wasm",
    name: "esbuild-wasm",
    version: "0.28.1",
    license: "MIT",
    integration: "headless_engine",
    disposition: "adopted",
    rationale: "Adopted for bounded dependency-free JS/TS and approved cached React builds in a cancellable worker, with structured diagnostics and server fallback.",
    scores: { license: 5, bundleRuntimeCost: 3, mobileViability: 3, ...strongHeadless, semanticActionSupport: 3, yjsAdaptability: 5, anchorSelectionApis: 2, importExportQuality: 5, maintenance: 5, migrationCost: 4, benefitOverNative: 5 },
  }),
  scorecard({
    id: "duckdb-wasm",
    name: "DuckDB-WASM",
    version: "candidate",
    license: "MIT",
    integration: "not_adopted",
    disposition: "not_adopted",
    rationale: "Not adopted: no scored user workflow currently justifies its bundle/runtime cost over existing Sheets and import paths.",
    scores: { license: 5, bundleRuntimeCost: 1, mobileViability: 1, transparentDataModel: 5, semanticActionSupport: 3, yjsAdaptability: 3, anchorSelectionApis: 1, conflictingUiSuppression: 5, importExportQuality: 5, codeOnlyTestability: 4, maintenance: 5, migrationCost: 2, benefitOverNative: 2 },
  }),
] as const satisfies readonly EngineScorecard[];

export function validateEngineScorecards() {
  return OPEN_SOURCE_ENGINE_SCORECARDS.every(
    (engine) =>
      engine.foreignProductShell === false &&
      ENGINE_CRITERIA.every((criterion) => Number.isInteger(engine.scores[criterion])) &&
      engine.total === ENGINE_CRITERIA.reduce((total, criterion) => total + engine.scores[criterion], 0),
  );
}
