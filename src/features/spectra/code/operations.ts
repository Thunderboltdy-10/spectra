export const MAX_CODE_RUN_REPORTS = 20;
export const MAX_CODE_RUN_OUTPUT_CHARACTERS = 12_000;

export type PythonCell = {
  id: string;
  index: number;
  title: string;
  markerLine?: number;
  startLine: number;
  endLine: number;
  source: string;
};

export type CodeRunReportStatus = "ready" | "error" | "limited" | "cancelled";

export type CodeRunReport = {
  id: string;
  createdAt: number;
  runtime: "browser" | "react" | "python";
  runtimeVersion: string;
  scope: "project" | "cell" | "tests";
  status: CodeRunReportStatus;
  durationMs: number;
  sourceFingerprint: string;
  entryPath: string;
  cell?: {
    index: number;
    title: string;
    startLine: number;
    endLine: number;
  };
  pythonPackages?: string[];
  events: Array<{
    atMs: number;
    state: string;
    message?: string;
  }>;
  outputExcerpt: string;
  problems: Array<{
    severity: "error" | "warning" | "info";
    message: string;
    file?: string;
    line?: number;
    column?: number;
  }>;
  tests: Array<{
    name: string;
    status: "passed" | "failed";
    message?: string;
  }>;
};

export type CodeStudioOperation =
  | "diagnostics.problems"
  | "files.create"
  | "files.delete"
  | "files.duplicate"
  | "files.rename"
  | "files.searchProject"
  | "files.setEntry"
  | "format"
  | "notebook.runAll"
  | "notebook.runCell"
  | "output.clear"
  | "output.console"
  | "runs.copyReport"
  | "runs.downloadReport"
  | "runs.history"
  | "runtime.run"
  | "runtime.stop"
  | "settings"
  | "tests.run";

const PYTHON_CELL_MARKER = /^\s*#\s*%%(?:\s*\[[^\]]+\])?(?:\s+(.*))?\s*$/;

export function discoverPythonCells(source: string): PythonCell[] {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const markers = lines.flatMap((line, index) => {
    const match = PYTHON_CELL_MARKER.exec(line);
    return match ? [{ lineIndex: index, title: match[1]?.trim() }] : [];
  });
  if (!markers.length) {
    return [
      {
        id: "cell:1",
        index: 0,
        title: "Whole file",
        startLine: 1,
        endLine: Math.max(1, lines.length),
        source: lines.join("\n"),
      },
    ];
  }

  const cells: PythonCell[] = [];
  const firstMarker = markers[0]!.lineIndex;
  if (
    firstMarker > 0 &&
    lines.slice(0, firstMarker).some((line) => line.trim())
  ) {
    cells.push({
      id: "cell:preamble",
      index: 0,
      title: "Preamble",
      startLine: 1,
      endLine: firstMarker,
      source: lines.slice(0, firstMarker).join("\n"),
    });
  }

  for (const [markerIndex, marker] of markers.entries()) {
    const nextMarker = markers[markerIndex + 1]?.lineIndex ?? lines.length;
    const startLine = marker.lineIndex + 2;
    const endLine = Math.max(marker.lineIndex + 1, nextMarker);
    const index = cells.length;
    cells.push({
      id: `cell:${marker.lineIndex + 1}`,
      index,
      title: marker.title || `Cell ${index + 1}`,
      markerLine: marker.lineIndex + 1,
      startLine,
      endLine,
      source: lines.slice(marker.lineIndex + 1, nextMarker).join("\n"),
    });
  }
  return cells;
}

export function pythonCellAtLine(cells: readonly PythonCell[], line: number) {
  const safeLine = Math.max(1, Math.round(line));
  return (
    cells.find((cell) => {
      const firstLine = cell.markerLine ?? cell.startLine;
      return (
        safeLine >= firstLine && safeLine <= Math.max(firstLine, cell.endLine)
      );
    }) ?? cells.at(-1)
  );
}

/** Preserve original line numbers in Python tracebacks while executing one cell. */
export function pythonCellExecutionSource(cell: PythonCell) {
  return `${"\n".repeat(Math.max(0, cell.startLine - 1))}${cell.source}`;
}

function boundedText(value: unknown, maximum: number) {
  if (typeof value !== "string") return "";
  let text = value
    .replaceAll("\r\n", "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi,
      "[private key redacted]",
    )
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/-]{12,}/gi, "$1 [redacted]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|auth(?:orization)?|password|secret)\b\s*[:=]\s*([^\s,;]{4,})/gi,
      "$1=[redacted]",
    );
  if (text.length > maximum) text = `${text.slice(0, maximum)}\n[truncated]`;
  return text;
}

function safeId(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 180)
    : "";
}

export function normalizeCodeRunReports(value: unknown): CodeRunReport[] {
  if (!Array.isArray(value)) return [];
  const reports: CodeRunReport[] = [];
  const ids = new Set<string>();
  for (const candidate of value.slice(0, MAX_CODE_RUN_REPORTS)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      continue;
    const row = candidate as Record<string, unknown>;
    const id = safeId(row.id);
    if (!id || ids.has(id)) continue;
    if (
      row.runtime !== "browser" &&
      row.runtime !== "react" &&
      row.runtime !== "python"
    )
      continue;
    if (
      row.status !== "ready" &&
      row.status !== "error" &&
      row.status !== "limited" &&
      row.status !== "cancelled"
    )
      continue;
    if (
      row.scope !== "project" &&
      row.scope !== "cell" &&
      row.scope !== "tests"
    )
      continue;
    const sourceFingerprint = boundedText(
      row.sourceFingerprint,
      64,
    ).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sourceFingerprint)) continue;
    ids.add(id);
    const rawCell =
      row.cell && typeof row.cell === "object" && !Array.isArray(row.cell)
        ? (row.cell as Record<string, unknown>)
        : null;
    reports.push({
      id,
      createdAt:
        typeof row.createdAt === "number" && Number.isFinite(row.createdAt)
          ? Math.max(0, Math.round(row.createdAt))
          : 0,
      runtime: row.runtime,
      runtimeVersion: boundedText(row.runtimeVersion, 80),
      scope: row.scope,
      status: row.status,
      durationMs:
        typeof row.durationMs === "number" && Number.isFinite(row.durationMs)
          ? Math.max(0, Math.min(120_000, Math.round(row.durationMs)))
          : 0,
      sourceFingerprint,
      entryPath: boundedText(row.entryPath, 500),
      ...(rawCell
        ? {
            cell: {
              index:
                typeof rawCell.index === "number"
                  ? Math.max(0, Math.round(rawCell.index))
                  : 0,
              title: boundedText(rawCell.title, 160) || "Cell",
              startLine:
                typeof rawCell.startLine === "number"
                  ? Math.max(1, Math.round(rawCell.startLine))
                  : 1,
              endLine:
                typeof rawCell.endLine === "number"
                  ? Math.max(1, Math.round(rawCell.endLine))
                  : 1,
            },
          }
        : {}),
      ...(Array.isArray(row.pythonPackages)
        ? {
            pythonPackages: [
              ...new Set(
                row.pythonPackages
                  .filter((item): item is string => typeof item === "string")
                  .map((item) => item.trim().slice(0, 80))
                  .filter(Boolean),
              ),
            ].slice(0, 6),
          }
        : {}),
      events: Array.isArray(row.events)
        ? row.events.slice(0, 40).flatMap((event) => {
            if (!event || typeof event !== "object" || Array.isArray(event))
              return [];
            const item = event as Record<string, unknown>;
            const state = boundedText(item.state, 40);
            if (!state) return [];
            return [
              {
                atMs:
                  typeof item.atMs === "number" && Number.isFinite(item.atMs)
                    ? Math.max(0, Math.min(120_000, Math.round(item.atMs)))
                    : 0,
                state,
                ...(typeof item.message === "string" && item.message
                  ? { message: boundedText(item.message, 500) }
                  : {}),
              },
            ];
          })
        : [],
      outputExcerpt: boundedText(
        row.outputExcerpt,
        MAX_CODE_RUN_OUTPUT_CHARACTERS,
      ),
      problems: Array.isArray(row.problems)
        ? row.problems.slice(0, 50).flatMap((problem) => {
            if (
              !problem ||
              typeof problem !== "object" ||
              Array.isArray(problem)
            )
              return [];
            const item = problem as Record<string, unknown>;
            const severity =
              item.severity === "warning" || item.severity === "info"
                ? item.severity
                : "error";
            const message = boundedText(item.message, 800);
            if (!message) return [];
            return [
              {
                severity,
                message,
                ...(typeof item.file === "string"
                  ? { file: boundedText(item.file, 500) }
                  : {}),
                ...(typeof item.line === "number"
                  ? { line: Math.max(1, Math.round(item.line)) }
                  : {}),
                ...(typeof item.column === "number"
                  ? { column: Math.max(0, Math.round(item.column)) }
                  : {}),
              },
            ];
          })
        : [],
      tests: Array.isArray(row.tests)
        ? row.tests.slice(0, 100).flatMap((test) => {
            if (!test || typeof test !== "object" || Array.isArray(test))
              return [];
            const item = test as Record<string, unknown>;
            const name = boundedText(item.name, 200);
            if (!name || (item.status !== "passed" && item.status !== "failed"))
              return [];
            return [
              {
                name,
                status: item.status,
                ...(typeof item.message === "string" && item.message
                  ? { message: boundedText(item.message, 800) }
                  : {}),
              },
            ];
          })
        : [],
    });
  }
  return reports;
}

export function appendCodeRunReport(
  reports: readonly CodeRunReport[] | undefined,
  report: CodeRunReport,
) {
  return normalizeCodeRunReports([report, ...(reports ?? [])]);
}

function markdownCell(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function codeRunReportMarkdown(report: CodeRunReport) {
  const rows = [
    "# Spectra code run",
    "",
    `- Status: ${report.status}`,
    `- Runtime: ${report.runtime} (${report.runtimeVersion})`,
    `- Scope: ${report.scope}`,
    `- Entry: ${report.entryPath}`,
    `- Duration: ${report.durationMs} ms`,
    `- Source fingerprint: \`${report.sourceFingerprint}\``,
  ];
  if (report.cell)
    rows.push(
      `- Cell: ${markdownCell(report.cell.title)} (lines ${report.cell.startLine}-${report.cell.endLine})`,
    );
  if (report.pythonPackages?.length)
    rows.push(`- Python packages: ${report.pythonPackages.join(", ")}`);
  if (report.tests.length) {
    rows.push(
      "",
      "## Checks",
      "",
      "| Check | Result | Detail |",
      "| --- | --- | --- |",
    );
    for (const test of report.tests)
      rows.push(
        `| ${markdownCell(test.name)} | ${test.status} | ${markdownCell(test.message ?? "")} |`,
      );
  }
  if (report.problems.length) {
    rows.push("", "## Problems", "");
    for (const problem of report.problems)
      rows.push(
        `- ${problem.severity}: ${problem.message}${problem.file ? ` (${problem.file}${problem.line ? `:${problem.line}` : ""})` : ""}`,
      );
  }
  if (report.outputExcerpt)
    rows.push(
      "",
      "## Output excerpt",
      "",
      "```text",
      report.outputExcerpt.replaceAll("```", "'''"),
      "```",
    );
  return `${rows.join("\n")}\n`;
}

export function codeRunReportJson(report: CodeRunReport) {
  return JSON.stringify(report, null, 2);
}

export function codeShortcutOperation(event: {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): CodeStudioOperation | null {
  const key = event.key.toLowerCase();
  const mod = Boolean(event.ctrlKey || event.metaKey);
  if (!mod && event.shiftKey && key === "enter") return "notebook.runCell";
  if (mod && event.shiftKey && key === "enter") return "notebook.runAll";
  if (mod && !event.shiftKey && !event.altKey && key === "enter")
    return "runtime.run";
  if (mod && event.shiftKey && key === "f") return "files.searchProject";
  if (mod && event.altKey && key === "f") return "format";
  if (mod && event.shiftKey && key === "m") return "diagnostics.problems";
  if (mod && !event.shiftKey && !event.altKey && key === "j")
    return "output.console";
  if (mod && event.altKey && key === "t") return "tests.run";
  return null;
}
