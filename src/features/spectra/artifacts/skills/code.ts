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
    "For Python, inspect the approved package selection, whether # %% cell mode is enabled, and the exact current-cell boundary before proposing or running a cell.",
    "Inspect the latest build problems, sanitized console, accessibility report, and rendered state before diagnosing a runtime or visual defect.",
    "Inspect bounded run reports as private execution evidence. A report describes one source fingerprint and must not be treated as proof about later edits.",
  ],
  regions: [
    "file-tree operation",
    "stable source line",
    "symbol or contiguous range",
    "dependency declaration",
    "approved Python package selection",
    "Python # %% source cell",
    "test",
    "runtime output",
    "bounded run report",
    "visual component or preview property",
    "viewer-facing visualisation parameter",
    "immutable runtime asset reference",
  ],
  operations: [
    "Create, rename, or remove files transactionally; patch the smallest stable lines or symbol; declare only allowlisted dependencies; build; run; test; debug; check accessibility; format a visualisation; and connect permissioned Sheets ranges or artifacts.",
    "Select only the pinned local Python packages, run the current # %% cell or the complete project, and share a sanitized run report as Markdown or JSON without publishing private run history.",
    "Refuse arbitrary package installation, terminal or hosted-server claims, breakpoint stepping, fidelity-preserving notebook export, remote kernels, Python formatting, external lint scripts, and public links for ephemeral runs with the product's exact refusal guidance.",
  ],
  preservationRules: [
    "Preserve unrelated files and stable line identities, public interfaces, tests, comments, user-authored styling, resource bindings, runtime policy, and sandbox boundaries.",
    "Keep binary/generated media outside the text CRDT. Preserve immutable asset IDs and content hashes; replace a reference with a newly verified asset instead of mutating stored bytes.",
    "Never replace a working multi-file project with one generated file merely because it is easier to author.",
    "Keep unsupported-language source editable and exportable even when Spectra cannot execute it.",
    "Keep # %% cells as ordinary Python source rather than creating a competing notebook document model, and keep durable run reports out of published executable payloads.",
  ],
  validation: [
    "Validate paths, unique file/line identities, entry point, total source size, imports, declared dependencies, parser/build output, runtime limits, tests, sanitized console, accessibility report, CSP, and network policy.",
    "Validate Python packages against the pinned allowlist, preserve original line numbers in current-cell tracebacks, and bound and redact every persisted run report before it reaches collaboration state or an export.",
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
