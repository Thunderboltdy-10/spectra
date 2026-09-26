/** Offline prompt capture only: no model calls, effects or self-scoring. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getEncoding } from "js-tiktoken";
import { WORKSPACE_ASSISTANT_PROMPT, workspaceSystemPrompt } from "../../../src/features/spectra/ai/workspace-assistant-prompt";
import { artifactWorkerSystemPrompt } from "../../../src/app/api/spectra/run/loop/plan";
import { artifactQualityPromptSection } from "../../../src/features/spectra/quality/rubrics";

async function main() {
  const label = process.argv[2];
  if (label !== "before" && label !== "after") throw new Error("Supply before or after.");
  const encoding = getEncoding("o200k_base");
  const output = path.resolve(".spectra-local/launch-s11/craft/prompt-corpus", label);
  mkdirSync(output, { recursive: true });
  const cases = [
    { id: "simple", brief: "Explain why we have leap years in two sentences.", types: [] },
    { id: "document", brief: "Write a short letter thanking the workshop volunteers. Keep it as five brief paragraphs, with no section headings or exercises.", types: ["document"] },
    { id: "presentation", brief: "Make an eight-slide handout comparing two possible rehearsal plans. Keep the same two-column layout throughout so readers can compare them; use 18px body text and preserve the quotations in full.", types: ["presentation"] },
    { id: "sheets", brief: "Make an editable rehearsal budget workbook with labelled inputs, formulas for costs and a clear total. Keep its formatting restrained and show units.", types: ["sheets"] },
    { id: "mixed", brief: "Using the supplied council pilot reading, prepare a one-page decision note and a three-slide briefing with an editable comparison chart. Explain the uncertainty and suggest the next step.", types: ["document", "presentation"] },
  ] as const;
  const counts: Record<string, number> = {
    warmBase: encoding.encode(WORKSPACE_ASSISTANT_PROMPT).length,
    workspaceTools: encoding.encode(workspaceSystemPrompt("workspace", "tools")).length,
    workspacePlan: encoding.encode(workspaceSystemPrompt("workspace", "plan")).length,
  };
  for (const entry of cases) {
    const parts: Record<string, string> = { workspaceCore: workspaceSystemPrompt("workspace", "tools") };
    for (const type of entry.types) {
      parts[`${type}Worker`] = await artifactWorkerSystemPrompt(type) + artifactQualityPromptSection(type, entry.brief);
    }
    for (const [name, prompt] of Object.entries(parts)) counts[`${entry.id}.${name}`] = encoding.encode(prompt).length;
    writeFileSync(path.join(output, `${entry.id}.json`), JSON.stringify({
      id: entry.id, brief: entry.brief, parts,
      scope: "Exact exported workspace core and assigned artifact worker sections, captured offline. Excludes agentSystemPrompt routing, dynamic orientation, tool schemas, attachments and conversation. No model response or saved-artifact quality claim.",
    }, null, 2));
  }
  writeFileSync(path.join(output, "token-counts.json"), JSON.stringify({ encoding: "o200k_base", counts }, null, 2));
  process.stdout.write(JSON.stringify({ label, output, encoding: "o200k_base", counts }));
}

void main().catch((error: unknown) => {
  process.stderr.write(String(error));
  process.exitCode = 1;
});
