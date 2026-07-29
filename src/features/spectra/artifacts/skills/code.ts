import { defineArtifactSkill } from "../types";
import { visualisationDesignGuide } from "./visualisation-design";

export const codeSkill = defineArtifactSkill({
  typeKey: "code",
  purpose:
    "Author source in any language and safely run prioritized browser, React/TypeScript, HTML/CSS/JavaScript, and Python work.",
  createWhen: [
    "The requested output is source code, a runnable example, or an approachable interactive visualisation.",
  ],
  inspect: [
    "Inspect the runtime, entry point, file tree, declared dependencies, tests, resource bindings, and only the relevant stable line or symbol regions before changing source.",
    "Inspect the latest build problems, sanitized console, accessibility report, and rendered state before diagnosing a runtime or visual defect.",
  ],
  regions: [
    "file-tree operation",
    "stable source line",
    "symbol or contiguous range",
    "dependency declaration",
    "test",
    "runtime output",
    "visual component or preview property",
    "viewer-facing visualisation parameter",
    "immutable runtime asset reference",
  ],
  operations: [
    "Create, rename, or remove files transactionally; patch the smallest stable lines or symbol; declare only allowlisted dependencies; build; run; test; debug; check accessibility; format a visualisation; and connect permissioned Sheets ranges or artifacts.",
  ],
  preservationRules: [
    "Preserve unrelated files and stable line identities, public interfaces, tests, comments, user-authored styling, resource bindings, runtime policy, and sandbox boundaries.",
    "Keep binary/generated media outside the text CRDT. Preserve immutable asset IDs and content hashes; replace a reference with a newly verified asset instead of mutating stored bytes.",
    "Never replace a working multi-file project with one generated file merely because it is easier to author.",
    "Keep unsupported-language source editable and exportable even when Spectra cannot execute it.",
  ],
  validation: [
    "Validate paths, unique file/line identities, entry point, total source size, imports, declared dependencies, parser/build output, runtime limits, tests, sanitized console, accessibility report, CSP, and network policy.",
    "Treat a rendered preview as successful only when the actual interaction works at wide and narrow sizes and source remains recoverable after failure.",
  ],
  approvals: [
    "Require approval for network allowlist changes, new privileged resource bindings, consequential dependency expansion, secret brokerage, publishing, or destructive multi-file rewrites.",
  ],
  connections: [
    "Use permissioned Sheets ranges and artifacts through explicit bindings; interactive visualisations embed in threads and documents through the versioned Spectra SDK without ambient access.",
    "Browser and React source reads bound snapshots with @spectra/sdk getResource/listResources. Python reads JSON with spectra.get_resource/list_resources and may emit an accessible Spectra-native graph with spectra.chart({type, title, labels, series}). Public builds never inherit private binding data.",
    "Approachable controls are declared as stable parameters. Browser and React use getParameter/listParameters plus onHostChange; Python uses spectra.get_parameter/list_parameters. Preserve parameter identities and keys when changing their labels or values.",
    "Browser and React source may use an asset's versioned path or SpectraEmbed.getAsset(referenceId). Python receives the same verified bytes at the referenced project path and can inspect mappings through spectra_assets. Revoked assets must fail visibly and invalidate published playback.",
  ],
  workingEffects: [
    "Changed source lines form deliberately while the corresponding preview component transitions only after a valid build; clear both effects on success, failure, cancellation, rejection, revocation, or navigation.",
  ],
  specialistGuides: [visualisationDesignGuide],
});
