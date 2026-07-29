import { defineArtifactSkill } from "../types";
export const sheetsSkill = defineArtifactSkill({
  typeKey: "sheets",
  purpose:
    "Create and maintain familiar, durable workbooks for calculation, structured data, analysis, and linked graphing without reducing Sheets to a decorative table.",
  createWhen: [
    "The work needs rows and columns, formulas, repeatable analysis, filtering, or charts.",
    "Experimental observations, schedules, marks, budgets, trackers, or imported tabular records need calculations and reusable views.",
    "A document or presentation needs a chart or live range backed by inspectable source data.",
  ],
  inspect: [
    "Inspect the workbook outline, sheet identities, used ranges, names, tables, charts, formula errors, and dependency summary before requesting only the cells or ranges required.",
    "Resolve displayed A1 notation to stable sheet, row, and column identities before proposing a mutation.",
    "Inspect source lineage, validation, hidden or filtered state, comments, protections, and linked consumers when they can change the meaning of the requested work.",
  ],
  regions: [
    "workbook",
    "workbook setting",
    "sheet",
    "row",
    "column",
    "cell",
    "rectangular range",
    "formula",
    "validation rule",
    "conditional-format rule",
    "table",
    "filter",
    "sort",
    "chart",
    "chart series",
    "named range",
  ],
  operations: [
    "Inspect workbook outline, range values and formulas, dependencies, errors, tables, charts, names, and provenance.",
    "Create, rename, reorder, or remove sheets while preserving stable identities and repairing dependent references.",
    "Set typed cells and formulas, fill or transform ranges, format, validate, merge, insert or remove rows and columns, freeze panes, and create named ranges.",
    "Create and edit typed tables, totals, structured filters and sorts, conditional formatting, and line, bar, column, area, pie, scatter, combination, or histogram charts.",
    "Analyze statistics, trends, anomalies, correlations, and assumptions; explain formulas and errors; verify recalculation after every formula-bearing change.",
    "Import permissioned data with provenance and fidelity reporting, and connect live or pinned ranges and charts to other artifacts.",
  ],
  preservationRules: [
    "Preserve formulas, references, types, formats, hidden state, names, comments, and unaffected ranges.",
    "Never replace a broad range when a smaller stable region satisfies the request, and never silently discard a formula, validation rule, chart source, user overlay, or imported provenance.",
    "Treat filtered and hidden cells as existing data, not empty space. Structural edits must rewrite all affected formulas, names, tables, charts, and embeds or stop with an intelligible dependency warning.",
    "Do not infer that an embedded chart or range grants access to its source workbook.",
  ],
  validation: [
    "Recalculate dependency graph; report circular, parse, reference, spill, type, and import-fidelity errors.",
    "Validate table bounds, unique stable identities, named-range targets, chart series, locale and timezone determinism, data-validation rules, and accessible chart summaries.",
    "Compare the committed calculation version and values with the proposed output before declaring an operation complete.",
  ],
  approvals: [
    "Preview destructive range clears, formula replacement, structural moves, external refresh, and macro loss.",
    "Require approval before sharing a sensitive range, deleting a populated sheet or dependent structure, replacing formulas across a broad range, or applying an ambiguous import mapping.",
    "Safe non-destructive population, formatting, analysis, and chart construction may proceed without interrupting the user.",
  ],
  connections: [
    "Charts and live ranges embed in documents and presentations; tasks and connector records may feed tables.",
    "Documents can become structured extraction sources, code visualisations can consume permissioned ranges, and threads or agents can analyze only the workbook regions they may read.",
    "Live embeds re-check source access and update from the current workbook; pinned embeds retain an explicit version and fidelity label.",
  ],
  workingEffects: [
    "Target ranges populate in a perceivable sweep and charts resolve from their committed source range.",
    "Formula changes form with restrained dependency feedback, independent ranges animate concurrently, and the active effect remains attached to the exact cells or chart being changed.",
    "Completion, rejection, cancellation, failure, reconnect, and permission loss always clear the blue treatment and reconcile the visible grid to durable state; reduced motion uses a concise region outline and state label.",
  ],
  specialistGuides: [
    {
      id: "formula-and-calculation",
      trigger:
        "The request creates, rewrites, explains, or repairs formulas or calculated ranges.",
      instructions: [
        "Inspect precedents, dependents, locale, calculation version, and current errors before editing.",
        "Prefer readable formulas and named ranges when they improve durability; do not introduce volatile, network, or custom-code functions.",
        "Recalculate and report any new cycle, reference, type, or compatibility error.",
      ],
    },
    {
      id: "analysis-and-charting",
      trigger:
        "The request asks for statistics, trends, anomalies, graphs, or a chart used by another artifact.",
      instructions: [
        "Confirm labels, units, missing values, series orientation, and the analysis question before selecting a chart.",
        "Keep chart source lineage explicit and produce an accessible textual summary.",
        "Preserve the source range and choose live versus pinned embedding according to the user's intent.",
      ],
    },
    {
      id: "spreadsheet-migration",
      trigger:
        "The operation imports CSV, TSV, XLSX, ODS, clipboard data, or connector records.",
      instructions: [
        "Retain the immutable original, parse within size limits, quarantine executable or external content, and itemize adapted or unsupported features.",
        "Do not silently convert unsupported formulas or dates; preserve them as text or request a mapping decision.",
        "Attach provenance to imported regions and verify formulas, types, merged ranges, validations, comments, and chart sources after import.",
      ],
    },
  ],
});
