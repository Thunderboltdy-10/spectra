import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { EvalResults, EvalRow } from "./runner";

/*
 * The eval report: one self-contained HTML page (no scripts, no network) and
 * the raw results as JSON, under .spectra-local/ai-evals/<date>/. It names
 * the model id the run used and never any key.
 */

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ms = (value: number | null) => (value === null ? "none" : value < 10_000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`);

const STYLE = `
:root { color-scheme: light dark; --bg: #fafaf9; --panel: #ffffff; --ink: #1c1917; --muted: #57534e; --line: #e7e5e4; --pass: #15803d; --fail: #b91c1c; --code: #f5f5f4; }
@media (prefers-color-scheme: dark) { :root { --bg: #0c0a09; --panel: #1c1917; --ink: #f5f5f4; --muted: #a8a29e; --line: #292524; --pass: #4ade80; --fail: #f87171; --code: #292524; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 26px; margin: 0 0 4px; }
h2 { font-size: 19px; margin: 36px 0 12px; }
.muted { color: var(--muted); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-top: 20px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.card b { display: block; font-size: 24px; }
table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 13px; color: var(--muted); font-weight: 600; }
.pass { color: var(--pass); font-weight: 600; }
.fail { color: var(--fail); font-weight: 600; }
details { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; margin: 8px 0; padding: 10px 14px; }
summary { cursor: pointer; font-weight: 600; }
pre { background: var(--code); border-radius: 8px; padding: 10px 12px; white-space: pre-wrap; word-break: break-word; font-size: 13px; max-height: 360px; overflow: auto; }
ul { margin: 6px 0; padding-left: 20px; }
.wrap { overflow-x: auto; }
`;

const status = (pass: boolean) => `<span class="${pass ? "pass" : "fail"}">${pass ? "Pass" : "Fail"}</span>`;

function list(items: readonly string[], empty: string) {
  return items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p class="muted">${escapeHtml(empty)}</p>`;
}

function scenarioDetails(row: EvalRow) {
  const artifacts = row.artifacts
    .map(
      (artifact) =>
        `<h4>${escapeHtml(artifact.title)} <span class="muted">(${escapeHtml(artifact.type)}, ${artifact.action}${artifact.shape ? `, ${escapeHtml(artifact.shape)}` : ""})</span></h4><pre>${escapeHtml(artifact.preview)}</pre>`,
    )
    .join("");
  return `<details${row.pass ? "" : " open"}>
<summary>${status(row.pass)} ${escapeHtml(row.name)} <span class="muted">${escapeHtml(row.group)} · ${ms(row.totalMs)} · ${row.modelCalls} model calls</span></summary>
<p><b>Prompt.</b> ${escapeHtml(row.prompt)}</p>
${row.problems.length ? `<p><b>Problems</b></p>${list(row.problems, "")}` : ""}
<p><b>Reply</b></p><pre>${escapeHtml(row.reply || "(no reply)")}</pre>
<p><b>Steps</b></p>${list(row.steps, "No steps.")}
${row.captions.length ? `<p><b>Captions</b></p>${list(row.captions, "")}` : ""}
${row.title ? `<p><b>Thread title.</b> ${escapeHtml(row.title)}</p>` : ""}
<p><b>Latency.</b> First output ${ms(row.firstOutputMs)}, total ${ms(row.totalMs)}${row.samples.length > 1 ? ` (median of ${row.samples.length} runs: ${row.samples.map((sample) => ms(sample.firstOutputMs)).join(", ")})` : ""}.</p>
${artifacts ? `<p><b>Work it made or changed</b></p>${artifacts}` : ""}
</details>`;
}

export function renderEvalReport(results: EvalResults) {
  const { summary, rows } = results;
  const date = new Date(results.startedAt).toISOString().replace("T", " ").slice(0, 16);
  const latencyRows = summary.latency
    .map(
      (target) =>
        `<tr><td>${escapeHtml(target.name)}</td><td>${target.metric}</td><td>${ms(target.p50)}</td><td>under ${ms(target.targetMs)}</td><td>${status(target.pass)}</td></tr>`,
    )
    .join("");
  const groupRows = summary.groups
    .map((group) => `<tr><td>${escapeHtml(group.group)}</td><td>${group.passed} of ${group.total}</td><td>${status(group.passed === group.total)}</td></tr>`)
    .join("");
  const scenarioRows = rows
    .map(
      (row) =>
        `<tr><td>${status(row.pass)}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.group)}</td><td>${ms(row.firstOutputMs)}</td><td>${ms(row.totalMs)}</td><td>${escapeHtml(row.problems[0] ?? "")}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spectra AI evals</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Spectra AI evals</h1>
<p class="muted">${escapeHtml(date)} UTC · model ${escapeHtml(results.model ?? "unknown")} · ${ms(results.finishedAt - results.startedAt)}</p>
<div class="cards">
<div class="card"><b>${summary.passed} of ${summary.total}</b>scenarios pass</div>
<div class="card"><b class="${summary.failed ? "fail" : "pass"}">${summary.failed}</b>failed</div>
${summary.latency.map((target) => `<div class="card"><b class="${target.pass ? "pass" : "fail"}">${ms(target.p50)}</b>${escapeHtml(target.name)}, ${target.metric} at p50</div>`).join("")}
</div>
<h2>Latency targets</h2>
<div class="wrap"><table><thead><tr><th>Scenario</th><th>Measure</th><th>p50</th><th>Target</th><th></th></tr></thead><tbody>${latencyRows || `<tr><td colspan="5" class="muted">No targets in this run.</td></tr>`}</tbody></table></div>
<h2>By area</h2>
<div class="wrap"><table><thead><tr><th>Area</th><th>Passed</th><th></th></tr></thead><tbody>${groupRows}</tbody></table></div>
<h2>Scenarios</h2>
<div class="wrap"><table><thead><tr><th></th><th>Scenario</th><th>Area</th><th>First output</th><th>Total</th><th>First problem</th></tr></thead><tbody>${scenarioRows}</tbody></table></div>
<h2>Details</h2>
${rows.map(scenarioDetails).join("\n")}
</main>
</body>
</html>
`;
}

/** Writes report.html and results.json; returns the folder. */
export function writeEvalReport(results: EvalResults, root = path.resolve(".spectra-local/ai-evals")) {
  const dir = path.join(root, new Date(results.startedAt).toISOString().slice(0, 10));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "report.html"), renderEvalReport(results));
  writeFileSync(path.join(dir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  return dir;
}
