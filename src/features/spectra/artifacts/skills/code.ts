import { defineArtifactSkill } from "../types";
export const codeSkill = defineArtifactSkill({
  typeKey: "code", purpose: "Author source in any language and safely run prioritized browser, React/TypeScript, HTML/CSS/JS, and Python work.",
  createWhen: ["The requested output is source code, a runnable example, or an approachable interactive visualisation."], inspect: ["Inspect the file tree and runtime first, then read only relevant files and line regions."],
  regions: ["file", "line range", "symbol", "dependency", "runtime output", "visualisation surface"], operations: ["Create files, patch stable lines or symbols, install allowed dependencies, run, verify, and format output."],
  preservationRules: ["Preserve unrelated files, public interfaces, comments, resource budgets, and sandbox boundaries."], validation: ["Parse, typecheck where supported, execute in sandbox, inspect output, and enforce CSP, time, memory, and network budgets."],
  approvals: ["Require approval for consequential tools, network access, dependency expansion, or destructive multi-file changes."], connections: ["Interactive visualisations embed in threads and documents through the versioned Spectra SDK."], workingEffects: ["Changed lines form deliberately while the sandbox preview transitions only after a valid committed build."],
});
