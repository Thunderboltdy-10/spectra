import { normalizeArtifactContent } from "../ai/content-normalization";
import type { ArtifactTypeKey } from "../artifacts/types";
import { auditDeck, estimateTextOverflow } from "../presentation/audit";
import { BIBLIOGRAPHY_SLIDE_MARKER } from "../presentation/bibliography";
import {
  ensurePresentationReadingOrders,
  isPresentationLayoutId,
  presentationLayoutRoleIssues,
  realizeGeneratedPresentation,
} from "../presentation/layouts";
import {
  normalizePresentationContent,
  presentationObjectText,
  type PresentationContent,
} from "../presentation/model";
import { collectFormulaReferences } from "../sheets/formula-refs";
import {
  calculateWorkbook,
  normalizeSheetsContent,
  parseRange,
  rangeAddresses,
  type SheetsContent,
} from "../sheets/model";

export const QUALITY_CRITIQUE_MAX_PASSES = 2;

export const ARTIFACT_QUALITY_RUBRICS = {
  presentation: {
    title: "Presentation quality",
    passScore: 80,
    criteria: [
      {
        id: "structure",
        label: "Narrative structure",
        weight: 25,
        guidance:
          "Honor the requested slide count, give every slide a specific title, and make the sequence advance a clear narrative.",
      },
      {
        id: "layout",
        label: "Template composition",
        weight: 25,
        guidance:
          "Choose a supported layout intent for every slide and supply the semantic objects that layout needs.",
      },
      {
        id: "density",
        label: "Density and text fit",
        weight: 25,
        guidance:
          "Keep one idea per slide, use presentation-scale type, and fit every text frame without overflow.",
      },
      {
        id: "accessibility",
        label: "Contrast, reading order, and evidence",
        weight: 25,
        guidance:
          "Meet contrast, alt-text, reading-order, and source-coverage requirements.",
      },
    ],
  },
  sheets: {
    title: "Workbook quality",
    passScore: 80,
    criteria: [
      {
        id: "structure",
        label: "Usable structure and labels",
        weight: 20,
        guidance:
          "Use meaningful sheet names, labeled headers, stable ranges, and a valid active sheet.",
      },
      {
        id: "recalculation",
        label: "Formulas and recalculability",
        weight: 30,
        guidance:
          "Derive outputs with formulas over input cells, keep calculation automatic, and ship no formula errors.",
      },
      {
        id: "charts",
        label: "Chart-data honesty",
        weight: 20,
        guidance:
          "Use an appropriate real chart bound to a populated source range with a specific title.",
      },
      {
        id: "conclusions",
        label: "Units and stated conclusions",
        weight: 15,
        guidance:
          "Label units and include a visible conclusions or insights block for analysis work.",
      },
      {
        id: "readability",
        label: "Workbook readability",
        weight: 15,
        guidance:
          "Use number formats, frozen headers, and sizing that keeps the analysis inspectable rather than decorative.",
      },
    ],
  },
  document: {
    title: "Document quality",
    passScore: 80,
    criteria: [
      {
        id: "structure",
        label: "Document structure",
        weight: 30,
        guidance:
          "Use stable blocks, a coherent heading hierarchy, and the structure the requested document actually needs.",
      },
      {
        id: "flow",
        label: "Readable flow",
        weight: 25,
        guidance:
          "Keep paragraphs focused, remove placeholders, and ensure headings lead to substantive content.",
      },
      {
        id: "intent",
        label: "Editing intent",
        weight: 20,
        guidance:
          "Classify the request as append, rewrite, or restructure before editing and use the smallest matching operation.",
      },
      {
        id: "evidence",
        label: "Citation and source integrity",
        weight: 15,
        guidance:
          "Preserve citations and require verified source metadata when the request relies on research or supplied evidence.",
      },
      {
        id: "accessibility",
        label: "Accessible export structure",
        weight: 10,
        guidance:
          "Keep tables, equations, code, lists, and callouts as semantic blocks that remain readable when exported.",
      },
    ],
  },
} as const;

export type QualityBlueprintKey = keyof typeof ARTIFACT_QUALITY_RUBRICS;
export type DocumentEditIntent =
  "create" | "append" | "rewrite" | "restructure";
export type QualitySeverity = "blocker" | "major" | "minor";

export type ArtifactQualityFinding = {
  criterionId: string;
  severity: QualitySeverity;
  message: string;
  path?: string;
};

export type ArtifactQualityCriterionResult = {
  id: string;
  label: string;
  score: number;
  maxScore: number;
  findings: readonly ArtifactQualityFinding[];
};

export type ArtifactQualityReport = {
  blueprintKey: QualityBlueprintKey;
  score: number;
  passScore: number;
  passed: boolean;
  criteria: readonly ArtifactQualityCriterionResult[];
  findings: readonly ArtifactQualityFinding[];
  summary: string;
};

export class ArtifactQualityError extends Error {
  readonly report: ArtifactQualityReport;

  constructor(report: ArtifactQualityReport) {
    const issues = report.findings
      .slice(0, 6)
      .map((finding) => finding.message)
      .join(" ");
    super(
      `Artifact quality critique did not pass the shared ${report.blueprintKey} rubric (${report.score}/100, required ${report.passScore}): ${issues}`,
    );
    this.name = "ArtifactQualityError";
    this.report = report;
  }
}

export function isArtifactQualityError(
  error: unknown,
): error is ArtifactQualityError {
  return error instanceof ArtifactQualityError;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function words(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function finding(
  criterionId: string,
  severity: QualitySeverity,
  message: string,
  path?: string,
): ArtifactQualityFinding {
  return { criterionId, severity, message, ...(path ? { path } : {}) };
}

function criterion(
  blueprintKey: QualityBlueprintKey,
  id: string,
  score: number,
  findings: ArtifactQualityFinding[],
) {
  const definition = ARTIFACT_QUALITY_RUBRICS[blueprintKey].criteria.find(
    (entry) => entry.id === id,
  );
  if (!definition) throw new Error(`Unknown ${blueprintKey} rubric criterion.`);
  return {
    id,
    label: definition.label,
    score: Math.max(0, Math.min(definition.weight, Math.round(score))),
    maxScore: definition.weight,
    findings,
  } satisfies ArtifactQualityCriterionResult;
}

function finishReport(
  blueprintKey: QualityBlueprintKey,
  criteria: ArtifactQualityCriterionResult[],
) {
  const score = criteria.reduce((total, entry) => total + entry.score, 0);
  const findings = criteria.flatMap((entry) => entry.findings);
  const passScore = ARTIFACT_QUALITY_RUBRICS[blueprintKey].passScore;
  const passed =
    score >= passScore &&
    !findings.some((entry) => entry.severity === "blocker");
  return {
    blueprintKey,
    score,
    passScore,
    passed,
    criteria,
    findings,
    summary: passed
      ? `${ARTIFACT_QUALITY_RUBRICS[blueprintKey].title}: ${score}/100.`
      : `${ARTIFACT_QUALITY_RUBRICS[blueprintKey].title}: ${score}/100. ${findings.length} issue${findings.length === 1 ? "" : "s"} to fix.`,
  } satisfies ArtifactQualityReport;
}

const COUNT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

function requestedSlideCount(prompt: string) {
  const raw = prompt
    .match(
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d{1,3})[- ]slides?\b/i,
    )?.[1]
    ?.toLowerCase();
  return raw ? (COUNT_WORDS[raw] ?? Number(raw)) : undefined;
}

function chartHasEditableNumericSeries(
  object: PresentationContent["slides"][number]["objects"][number],
) {
  if (object.type !== "chart" || object.hidden) return false;
  const content =
    object.content && typeof object.content === "object"
      ? (object.content as Record<string, unknown>)
      : {};
  const series = Array.isArray(content.series) ? content.series : [];
  const legacyValues = Array.isArray(content.values) ? content.values : [];
  const labels = Array.isArray(content.categories) ? content.categories : Array.isArray(content.labels) ? content.labels : [];
  const validSeries = (values: unknown[], categories: unknown[]) => values.length >= 2 &&
    values.every((value) => typeof value === "number" && Number.isFinite(value)) &&
    categories.length === values.length && categories.every((label) => typeof label === "string" && label.trim());
  if (validSeries(legacyValues, labels)) return true;
  return series.some((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const values = Array.isArray((candidate as { values?: unknown }).values)
      ? ((candidate as { values: unknown[] }).values)
      : [];
    const categories = Array.isArray((candidate as { categories?: unknown }).categories)
      ? (candidate as { categories: unknown[] }).categories : labels;
    return typeof (candidate as { name?: unknown }).name === "string" &&
      Boolean((candidate as { name: string }).name.trim()) && validSeries(values, categories);
  });
}

function tableHasEditableNumericCells(
  object: PresentationContent["slides"][number]["objects"][number],
) {
  if (object.type !== "table" || object.hidden) return false;
  const content =
    object.content && typeof object.content === "object"
      ? (object.content as Record<string, unknown>)
      : {};
  const rows = Array.isArray(content.rows) ? content.rows : [];
  let numeric = 0;
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      const text =
        typeof cell === "string"
          ? cell
          : cell && typeof cell === "object" && typeof (cell as { text?: unknown }).text === "string"
            ? (cell as { text: string }).text
            : "";
      const value = text.replace(/[%°,]/g, "").trim();
      if (value && Number.isFinite(Number(value)))
        numeric += 1;
    }
  }
  return numeric >= 2;
}

function promptRequiresEditableNumericVisual(prompt: string) {
  const normalized = prompt.toLowerCase();
  if (/\b(?:chart|graph|plot|histogram|numeric series)\b/.test(normalized))
    return true;
  if (
    /\b(?:csv|dataset|data table|spreadsheet|measurements?|values?)\b/.test(
      normalized,
    ) &&
    /\b(?:present|presentation|deck|slides?|study|visuali[sz]e|compare|comparison)\b/.test(
      normalized,
    )
  )
    return true;
  return false;
}

function presentationHasEditableNumericVisual(deck: PresentationContent) {
  return deck.slides.some((slide) =>
    slide.objects.some(
      (object) =>
        chartHasEditableNumericSeries(object) ||
        tableHasEditableNumericCells(object),
    ),
  );
}

function evaluatePresentation(content: unknown, prompt: string, numericSourceRequired = false) {
  const deck = normalizePresentationContent(content);
  ensurePresentationReadingOrders(deck);
  // Existing bibliography pages count toward the total. Citations alone do
  // not imply additional slides; validate the same sequence that will save.
  const authoredSlides = deck.slides.filter(
    (slide) => slide.accessibility?.label !== BIBLIOGRAPHY_SLIDE_MARKER,
  );
  const structureFindings: ArtifactQualityFinding[] = [];
  const requestedCount = requestedSlideCount(prompt);
  const totalSlideCount = deck.slides.length;
  if (requestedCount !== undefined && totalSlideCount !== requestedCount)
    structureFindings.push(
      finding(
        "structure",
        "blocker",
        `Create exactly ${requestedCount} total slides; the draft has ${totalSlideCount}.`,
        "/slides",
      ),
    );
  if (
    (numericSourceRequired || promptRequiresEditableNumericVisual(prompt)) &&
    !presentationHasEditableNumericVisual(deck)
  )
    structureFindings.push(
      finding(
        "structure",
        "blocker",
        "Include a real editable chart or table with numeric series, categories, and units — not a shape labelled chart or a screenshot stand-in.",
        "/slides",
      ),
    );
  const placeholder =
    /^(?:slide \d+|title|subtitle|add a clear idea|new slide)$/i;
  authoredSlides.forEach((slide, index) => {
    if (!slide.title.trim() || placeholder.test(slide.title.trim()))
      structureFindings.push(
        finding(
          "structure",
          "major",
          `Slide ${index + 1} needs a specific narrative title.`,
          `/slides/${index}/title`,
        ),
      );
  });
  const uniqueTitles = new Set(
    authoredSlides.map((slide) => slide.title.trim().toLocaleLowerCase()),
  );
  if (authoredSlides.length >= 4 && uniqueTitles.size < authoredSlides.length * 0.8)
    structureFindings.push(
      finding(
        "structure",
        "major",
        "Too many slide titles repeat instead of advancing the narrative.",
      ),
    );
  const structurePenalty = structureFindings.reduce(
    (total, entry) =>
      total +
      (entry.severity === "blocker" ? 20 : entry.severity === "major" ? 5 : 2),
    0,
  );

  const layoutFindings: ArtifactQualityFinding[] = [];
  authoredSlides.forEach((slide, index) => {
    if (!isPresentationLayoutId(slide.layoutId)) {
      layoutFindings.push(
        finding(
          "layout",
          "blocker",
          `Slide ${index + 1} must choose a supported layout intent.`,
          `/slides/${index}/layoutId`,
        ),
      );
      return;
    }
    for (const issue of presentationLayoutRoleIssues(slide))
      layoutFindings.push(
        finding(
          "layout",
          "blocker",
          `Slide ${index + 1}: ${issue}`,
          `/slides/${index}`,
        ),
      );
  });
  const layoutPenalty = layoutFindings.reduce(
    (total, entry) => total + (entry.severity === "blocker" ? 25 : 5),
    0,
  );

  const densityFindings: ArtifactQualityFinding[] = [];
  const slideWordCounts = authoredSlides.map((slide) =>
    slide.objects
      .filter(
        (object) =>
          !object.hidden && Boolean(presentationObjectText(object).trim()),
      )
      .reduce(
        (total, object) => total + words(presentationObjectText(object)),
        0,
      ),
  );
  authoredSlides.forEach((slide, index) => {
    const visible = slide.objects.filter((object) => !object.hidden);
    const textObjects = visible.filter((object) =>
      Boolean(presentationObjectText(object).trim()),
    );
    const wordCount = slideWordCounts[index] ?? 0;
    if (wordCount > 95)
      densityFindings.push(
        finding(
          "density",
          "major",
          `Slide ${index + 1} has ${wordCount} words; reduce it to one presentable idea.`,
          `/slides/${index}`,
        ),
      );
    if (visible.length > 8)
      densityFindings.push(
        finding(
          "density",
          "major",
          `Slide ${index + 1} has too many competing objects.`,
          `/slides/${index}/objects`,
        ),
      );
    textObjects.forEach((object) => {
      const size = Number(object.style?.fontSize ?? 21);
      if (!Number.isFinite(size) || size <= 0)
        densityFindings.push(
          finding(
            "density",
            "blocker",
            `Slide ${index + 1} needs a positive finite text size.`,
            `/slides/${index}/objects/${object.id}/style/fontSize`,
          ),
        );
      if (estimateTextOverflow(object))
        densityFindings.push(
          finding(
            "density",
            "blocker",
            `Slide ${index + 1} has text that overflows its frame.`,
            `/slides/${index}/objects/${object.id}`,
          ),
        );
    });
  });
  const densityPenalty = densityFindings.reduce(
    (total, entry) => total + (entry.severity === "blocker" ? 10 : 4),
    0,
  );

  const accessibilityFindings: ArtifactQualityFinding[] = [];
  const audit = auditDeck(deck);
  audit.findings.forEach((entry) => {
    if (entry.kind === "overflow") return;
    accessibilityFindings.push(
      finding(
        "accessibility",
        entry.kind === "contrast" ? "blocker" : "major",
        entry.message,
        `/slides/${entry.slideIndex}`,
      ),
    );
  });
  const accessibilityPenalty = accessibilityFindings.reduce(
    (total, entry) => total + (entry.severity === "blocker" ? 8 : 3),
    0,
  );

  return finishReport("presentation", [
    criterion(
      "presentation",
      "structure",
      25 - structurePenalty,
      structureFindings,
    ),
    criterion("presentation", "layout", 25 - layoutPenalty, layoutFindings),
    criterion("presentation", "density", 25 - densityPenalty, densityFindings),
    criterion(
      "presentation",
      "accessibility",
      25 - accessibilityPenalty,
      accessibilityFindings,
    ),
  ]);
}

function sheetCellEntries(content: SheetsContent) {
  return content.sheets.flatMap((sheet) =>
    Object.entries(sheet.cells).map(([address, cell]) => ({
      sheet,
      address,
      cell,
    })),
  );
}

function rangeHasData(sheet: SheetsContent["sheets"][number], value: string) {
  const range = parseRange(value.replace(/^.*!/, ""));
  if (!range) return false;
  return (
    rangeAddresses(range, 10_000).filter((address) => {
      const cell = sheet.cells[address];
      return cell && (cell.value !== undefined || Boolean(cell.formula));
    }).length >= 2
  );
}

function evaluateSheets(content: unknown, prompt: string) {
  const workbook = normalizeSheetsContent(content);
  const allCells = sheetCellEntries(workbook);
  const analysisRequested =
    /\b(analy[sz]e|analysis|trend|forecast|correlation|compare|insight|conclusion|variance)\b/i.test(
      prompt,
    );
  const calculationRequested =
    analysisRequested ||
    /\b(formula|calculate|total|average|budget|percentage|rate|projection|score)\b/i.test(
      prompt,
    );
  const chartRequested =
    analysisRequested || /\b(chart|graph|plot|visuali[sz]e)\b/i.test(prompt);

  const structureFindings: ArtifactQualityFinding[] = [];
  if (!workbook.sheets.some((sheet) => sheet.id === workbook.activeSheetId))
    structureFindings.push(
      finding(
        "structure",
        "blocker",
        "The active sheet must reference a real sheet.",
        "/activeSheetId",
      ),
    );
  workbook.sheets.forEach((sheet, index) => {
    if (/^(?:sheet\s*\d*|new sheet)$/i.test(sheet.name.trim()))
      structureFindings.push(
        finding(
          "structure",
          "major",
          `Sheet ${index + 1} needs a meaningful name.`,
          `/sheets/${index}/name`,
        ),
      );
    const headerValues = Object.entries(sheet.cells)
      .filter(([address]) => /1$/.test(address))
      .map(([, cell]) => text(cell.value));
    if (
      Object.keys(sheet.cells).length >= 4 &&
      headerValues.filter(Boolean).length < 2
    )
      structureFindings.push(
        finding(
          "structure",
          "major",
          `${sheet.name} needs clear column labels in its first row.`,
        ),
      );
  });
  const structurePenalty = structureFindings.reduce(
    (total, entry) => total + (entry.severity === "blocker" ? 20 : 5),
    0,
  );

  const calculationFindings: ArtifactQualityFinding[] = [];
  const formulaCells = allCells.filter((entry) => Boolean(entry.cell.formula));
  if (calculationRequested && formulaCells.length === 0)
    calculationFindings.push(
      finding(
        "recalculation",
        "blocker",
        "Build calculated outputs with formulas over input cells instead of typed result literals.",
      ),
    );
  if (calculationRequested && workbook.workbook.calculationMode !== "automatic")
    calculationFindings.push(
      finding(
        "recalculation",
        "major",
        "Keep analysis workbooks in automatic calculation mode.",
        "/workbook/calculationMode",
      ),
    );
  formulaCells.forEach(({ sheet, address, cell }) => {
    const formula = cell.formula ?? "";
    if (collectFormulaReferences(formula).length === 0)
      calculationFindings.push(
        finding(
          "recalculation",
          "major",
          `${sheet.name}!${address} is a formula-shaped literal with no input reference.`,
        ),
      );
  });
  const calculations = calculateWorkbook(workbook);
  for (const { sheet, address, cell } of formulaCells) {
    const result = calculations.get(`${sheet.id}:${address}`);
    if (result?.error)
      calculationFindings.push(
        finding(
          "recalculation",
          "blocker",
          `${sheet.name}!${address} evaluates to ${result.error}.`,
        ),
      );
    if (cell.cachedValueStale)
      calculationFindings.push(
        finding(
          "recalculation",
          "major",
          `${sheet.name}!${address} still carries a stale cached value.`,
        ),
      );
  }
  const calculationPenalty = calculationFindings.reduce(
    (total, entry) => total + (entry.severity === "blocker" ? 15 : 5),
    0,
  );

  const chartFindings: ArtifactQualityFinding[] = [];
  const charts = workbook.sheets.flatMap((sheet) =>
    sheet.charts.map((chart) => ({ sheet, chart })),
  );
  if (chartRequested && charts.length === 0)
    chartFindings.push(
      finding(
        "charts",
        "blocker",
        "Add a real chart bound to the analysis range.",
      ),
    );
  charts.forEach(({ sheet, chart }) => {
    if (!chart.title.trim())
      chartFindings.push(
        finding(
          "charts",
          "major",
          `The chart on ${sheet.name} needs a specific title.`,
        ),
      );
    if (!rangeHasData(sheet, chart.sourceRange))
      chartFindings.push(
        finding(
          "charts",
          "blocker",
          `The chart on ${sheet.name} is not bound to a populated source range.`,
        ),
      );
  });
  const chartPenalty = chartFindings.reduce(
    (total, entry) => total + (entry.severity === "blocker" ? 12 : 4),
    0,
  );

  const conclusionFindings: ArtifactQualityFinding[] = [];
  const stringValues = allCells
    .map((entry) => text(entry.cell.value))
    .filter(Boolean);
  const hasConclusion = stringValues.some((value) =>
    /\b(conclusion|insight|finding|summary|recommendation)\b/i.test(value),
  );
  if (analysisRequested && !hasConclusion)
    conclusionFindings.push(
      finding(
        "conclusions",
        "major",
        "Add a visible conclusions or insights block that states what the analysis shows.",
      ),
    );
  const numericCells = allCells.filter(
    (entry) =>
      typeof entry.cell.value === "number" || Boolean(entry.cell.formula),
  );
  const formattedNumeric = numericCells.filter(
    (entry) => entry.cell.format?.numberFormat,
  ).length;
  if (analysisRequested && numericCells.length >= 3 && formattedNumeric === 0)
    conclusionFindings.push(
      finding(
        "conclusions",
        "major",
        "Label numeric outputs with appropriate units or number formats.",
      ),
    );
  const conclusionPenalty = conclusionFindings.length * 6;

  const readabilityFindings: ArtifactQualityFinding[] = [];
  const populatedSheets = workbook.sheets.filter(
    (sheet) => Object.keys(sheet.cells).length >= 8,
  );
  populatedSheets.forEach((sheet) => {
    if (!sheet.frozenRows)
      readabilityFindings.push(
        finding(
          "readability",
          "minor",
          `Freeze the header row on ${sheet.name} so labels remain visible.`,
        ),
      );
    if (!sheet.columnWidths || Object.keys(sheet.columnWidths).length === 0)
      readabilityFindings.push(
        finding(
          "readability",
          "minor",
          `Set readable column widths on ${sheet.name}.`,
        ),
      );
  });

  return finishReport("sheets", [
    criterion("sheets", "structure", 20 - structurePenalty, structureFindings),
    criterion(
      "sheets",
      "recalculation",
      30 - calculationPenalty,
      calculationFindings,
    ),
    criterion("sheets", "charts", 20 - chartPenalty, chartFindings),
    criterion(
      "sheets",
      "conclusions",
      15 - conclusionPenalty,
      conclusionFindings,
    ),
    criterion(
      "sheets",
      "readability",
      15 - readabilityFindings.length * 2,
      readabilityFindings,
    ),
  ]);
}

export function classifyDocumentEditIntent(prompt: string): DocumentEditIntent {
  if (
    /\b(restructure|reorganize|reorganise|reorder|move sections?|change the structure|new outline)\b/i.test(
      prompt,
    )
  )
    return "restructure";
  if (
    /\b(rewrite|revise|edit|tighten|shorten|expand|improve|change the wording|replace)\b/i.test(
      prompt,
    )
  )
    return "rewrite";
  if (
    /\b(append|add (?:a |the )?(?:section|paragraph|note|conclusion)|continue|extend)\b/i.test(
      prompt,
    )
  )
    return "append";
  return "create";
}

function documentPromptRequiresSources(prompt: string) {
  if (
    /\b(?:do not|don't|without|no)\b.{0,40}\b(?:cite|citation|citations|sources?|references?)\b/i.test(
      prompt,
    )
  )
    return false;
  return /\b(cite|citation|research|bibliography|references?|source-backed|evidence-backed)\b/i.test(
    prompt,
  );
}

function evaluateDocument(content: unknown, prompt: string) {
  const document = record(normalizeArtifactContent("document", content));
  const blocks = Array.isArray(document.blocks)
    ? document.blocks.filter(
        (block): block is Record<string, unknown> =>
          Boolean(block) && typeof block === "object" && !Array.isArray(block),
      )
    : [];
  const structureFindings: ArtifactQualityFinding[] = [];
  const ids = new Set<string>();
  const headings = blocks.filter((block) => block.type === "heading");
  blocks.forEach((block, index) => {
    const id = text(block.id);
    if (!id || ids.has(id))
      structureFindings.push(
        finding(
          "structure",
          "blocker",
          `Block ${index + 1} needs a unique stable id.`,
          `/blocks/${index}/id`,
        ),
      );
    if (id) ids.add(id);
  });
  let previousLevel = 0;
  headings.forEach((heading, index) => {
    const level = Number(record(heading.attrs).level ?? 1);
    if (index === 0 && level !== 1)
      structureFindings.push(
        finding(
          "structure",
          "major",
          "Start the heading hierarchy at level 1.",
        ),
      );
    if (previousLevel && level > previousLevel + 1)
      structureFindings.push(
        finding(
          "structure",
          "major",
          "Do not skip heading levels in the document outline.",
        ),
      );
    previousLevel = level;
  });
  const structurePenalty = structureFindings.reduce(
    (total, entry) => total + (entry.severity === "blocker" ? 15 : 6),
    0,
  );

  const flowFindings: ArtifactQualityFinding[] = [];
  const placeholder =
    /^(?:lorem ipsum|add text|start writing|heading|untitled|todo)\b/i;
  blocks.forEach((block, index) => {
    const value = text(block.text) || text(block.latex);
    if (placeholder.test(value))
      flowFindings.push(
        finding(
          "flow",
          "blocker",
          `Block ${index + 1} still contains placeholder copy.`,
          `/blocks/${index}`,
        ),
      );
    if (block.type === "paragraph" && words(value) > 180)
      flowFindings.push(
        finding(
          "flow",
          "major",
          `Paragraph ${index + 1} is too dense to scan or revise comfortably.`,
          `/blocks/${index}`,
        ),
      );
    if (block.type === "heading") {
      const next = blocks[index + 1];
      const headingLevel = Number(record(block.attrs).level ?? 1);
      const nextHeadingLevel =
        next?.type === "heading"
          ? Number(record(next.attrs).level ?? 1)
          : null;
      const nextIsDeeperHeading =
        nextHeadingLevel !== null && nextHeadingLevel > headingLevel;
      const emptySameLevelSection =
        next?.type === "heading" && !nextIsDeeperHeading;
      const thinBody =
        next != null &&
        next.type !== "heading" &&
        words(text(next.text)) < 4;
      if (!next || emptySameLevelSection || thinBody)
        flowFindings.push(
          finding(
            "flow",
            "major",
            `The heading "${value || `at block ${index + 1}`}" needs substantive content below it.`,
          ),
        );
    }
  });
  const flowPenalty = flowFindings.reduce(
    (total, entry) => total + (entry.severity === "blocker" ? 12 : 4),
    0,
  );

  const intent = classifyDocumentEditIntent(prompt);
  const intentFindings: ArtifactQualityFinding[] = [];
  if (intent === "append" && /\b(replace|rewrite|restructure)\b/i.test(prompt))
    intentFindings.push(
      finding(
        "intent",
        "major",
        "The request mixes append and replacement semantics; choose the smallest explicit editing intent.",
      ),
    );

  const evidenceFindings: ArtifactQualityFinding[] = [];
  const sourceDriven = documentPromptRequiresSources(prompt);
  const sources = Array.isArray(document.sources) ? document.sources : [];
  if (sourceDriven && sources.length === 0)
    evidenceFindings.push(
      finding(
        "evidence",
        "blocker",
        "Add verified source metadata for the evidence this document relies on.",
        "/sources",
      ),
    );
  sources.forEach((source, index) => {
    const row = record(source);
    if (row.verified !== true || !text(row.title) || !text(row.accessedAt))
      evidenceFindings.push(
        finding(
          "evidence",
          "major",
          `Source ${index + 1} is missing verified citation metadata.`,
          `/sources/${index}`,
        ),
      );
  });
  const evidencePenalty = evidenceFindings.reduce(
    (total, entry) => total + (entry.severity === "blocker" ? 15 : 5),
    0,
  );

  const accessibilityFindings: ArtifactQualityFinding[] = [];
  blocks.forEach((block, index) => {
    if (
      ["table", "equation", "math", "code", "list", "callout"].includes(
        String(block.type),
      ) &&
      !text(block.text) &&
      !text(block.latex) &&
      Object.keys(block).every((key) => ["id", "type", "attrs"].includes(key))
    )
      accessibilityFindings.push(
        finding(
          "accessibility",
          "major",
          `Semantic block ${index + 1} has no readable content or fallback.`,
          `/blocks/${index}`,
        ),
      );
  });

  return finishReport("document", [
    criterion(
      "document",
      "structure",
      30 - structurePenalty,
      structureFindings,
    ),
    criterion("document", "flow", 25 - flowPenalty, flowFindings),
    criterion(
      "document",
      "intent",
      20 - intentFindings.length * 5,
      intentFindings,
    ),
    criterion("document", "evidence", 15 - evidencePenalty, evidenceFindings),
    criterion(
      "document",
      "accessibility",
      10 - accessibilityFindings.length * 4,
      accessibilityFindings,
    ),
  ]);
}

export function artifactQualityRepairInstructions(report: ArtifactQualityReport) {
  return report.findings
    .map(
      (finding) =>
        `${finding.severity === "blocker" ? "Must fix" : "Fix"} ${finding.path ?? finding.criterionId}: ${finding.message}`,
    )
    .join("\n");
}

export function isQualityBlueprintKey(
  blueprintKey: ArtifactTypeKey,
): blueprintKey is QualityBlueprintKey {
  return blueprintKey in ARTIFACT_QUALITY_RUBRICS;
}

export function prepareArtifactContentForQuality(
  blueprintKey: ArtifactTypeKey,
  content: unknown,
) {
  if (blueprintKey === "presentation")
    return realizeGeneratedPresentation(content);
  return normalizeArtifactContent(blueprintKey, content);
}

export function evaluateArtifactQuality(params: {
  blueprintKey: QualityBlueprintKey;
  content: unknown;
  prompt?: string;
  numericSourceRequired?: boolean;
}) {
  const prompt = params.prompt ?? "";
  if (params.blueprintKey === "presentation")
    return evaluatePresentation(params.content, prompt, params.numericSourceRequired);
  if (params.blueprintKey === "sheets")
    return evaluateSheets(params.content, prompt);
  return evaluateDocument(params.content, prompt);
}

export function assertArtifactQuality(params: {
  blueprintKey: ArtifactTypeKey;
  content: unknown;
  prompt?: string;
  numericSourceRequired?: boolean;
}) {
  if (!isQualityBlueprintKey(params.blueprintKey)) return null;
  const report = evaluateArtifactQuality({
    blueprintKey: params.blueprintKey,
    content: params.content,
    prompt: params.prompt,
    numericSourceRequired: params.numericSourceRequired,
  });
  if (!report.passed) throw new ArtifactQualityError(report);
  return report;
}

export function artifactQualityPromptSection(
  blueprintKey: ArtifactTypeKey,
  prompt = "",
) {
  if (!isQualityBlueprintKey(blueprintKey)) return "";
  const rubric = ARTIFACT_QUALITY_RUBRICS[blueprintKey];
  const taskInstructions = artifactQualityTaskSection(blueprintKey, prompt);
  const presentationInstructions =
    blueprintKey === "presentation"
      ? "\n- Author semantic slide objects and choose layoutId. Geometry is optional in the create tool because Spectra realizes the shared template after generation.\n- Honor the requested total using the actual slide sequence. Keep citations on supported narrative slides; add a separate bibliography only when requested or appropriate to the brief, and include it in the total. No References pages are added automatically.\n- Choose layouts for the explanation. Consistent comparison slides and purposeful text-only sequences do not need artificial variation.\n- Keep display copy focused and fit it to the intended viewing context. Put delivery cues in speakerNotes deliberately; never rely on normalization to remove or relocate authored content.\n- Choose legible type for the intended use: projected body copy usually needs at least 20px, while close-reading labels may be smaller. Preserve requested sizes and correct overflow deliberately.\n- On each slide with three or more visible objects, include accessibility.readingOrder with every visible object ID exactly once in the intended spoken order.\n- When asked for a chart, author an object with type chart and content containing chartType, categories, and named numeric series whose values and categories align. Put units in the series names and valueAxisTitle; do not simulate a chart with shapes or an image. When asked for a table, author a table object with editable rows and cells.\n- Fill every layout role: title-content needs supporting text, two-column needs both columns, three-ideas needs three complete ideas, and visual layouts need an editable visual.\n- Use editable visuals, charts or diagrams when they clarify the subject; there is no required visual fraction."
      : "";
  return `\n\nShared ${rubric.title} rubric. Spectra will re-read and score the authored content before accepting it, then score the saved artifact again during verify. The automated threshold is ${rubric.passScore}/100 with no blocker findings; passing these mechanical checks does not establish visual quality. Inspect actual output when available.${taskInstructions}\n- ${rubric.criteria.map((entry) => `${entry.label} (${entry.weight}): ${entry.guidance}`).join("\n- ")}${
    presentationInstructions
  }`;
}

export function artifactQualityTaskSection(blueprintKey: ArtifactTypeKey, prompt: string) {
  if (blueprintKey !== "document" || !prompt) return "";
  return `\n- Editing intent for this request: ${classifyDocumentEditIntent(prompt)}.${documentPromptRequiresSources(prompt)
    ? "\n- For every document block that relies on supplied evidence, set sourceRefs to the exact server-issued evidence IDs shown in context. Do not use filenames or invent handles. Spectra will materialize verified document.sources and native citations from those references; do not author source metadata yourself."
    : ""}`;
}

export function presentationQualityDeck(content: unknown): PresentationContent {
  return realizeGeneratedPresentation(content);
}
