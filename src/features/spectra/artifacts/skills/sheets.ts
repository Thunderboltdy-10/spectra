import { defineArtifactSkill } from "../types";
export const sheetsSkill = defineArtifactSkill({
  typeKey: "sheets", purpose: "Provide familiar workbook-scale calculation, structured data, analysis, tables, and graphing.",
  createWhen: ["The work needs rows and columns, formulas, repeatable analysis, filtering, or charts."], inspect: ["Inspect workbook outline, names, dependencies, then request only required cells, ranges, tables, or charts."],
  regions: ["workbook", "sheet", "cell", "range", "table", "filter", "chart", "named range"], operations: ["Set cells or formulas, fill ranges, format, sort, filter, create tables and charts, import, analyze, and validate."],
  preservationRules: ["Preserve formulas, references, types, formats, hidden state, names, comments, and unaffected ranges."], validation: ["Recalculate dependency graph; report circular, parse, reference, spill, type, and import-fidelity errors."],
  approvals: ["Preview destructive range clears, formula replacement, structural moves, external refresh, and macro loss."], connections: ["Charts and live ranges embed in documents and presentations; tasks and connector records may feed tables."], workingEffects: ["Target ranges populate in a perceivable sweep and charts resolve from their committed source range."],
});
