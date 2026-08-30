import { z } from "zod";
import type { WorkCapability } from "../work/registry";
import type { CapabilityDefinition } from "./types";
import { stableCapabilityId } from "./studios";

const none = z.null();
const fileId = z.object({ fileId: z.string().trim().min(1).max(180) }).strict();
const filePath = z.object({ path: z.string().trim().min(1).max(500) }).strict();
const renameFile = z
  .object({
    fileId: z.string().trim().min(1).max(180),
    path: z.string().trim().min(1).max(500),
  })
  .strict();
const projectQuery = z
  .object({ query: z.string().trim().min(1).max(500) })
  .strict();
const packageSelection = z
  .object({ packages: z.array(z.string().trim().min(1).max(80)).max(6) })
  .strict();
const runReportTarget = z
  .object({ reportId: z.string().trim().min(1).max(180) })
  .strict();

type CodeSpec = {
  localId: string;
  description: string;
  params?: z.ZodType;
  requires?: WorkCapability | false;
  manifest?: string;
  exposed?: boolean;
  risk?: CapabilityDefinition["ai"]["riskClass"];
  refusal?: string;
  embed?: CapabilityDefinition["embed"];
};

export const CODE_CAPABILITY_REFUSALS = Object.freeze({
  arbitraryPackages:
    "Spectra does not install arbitrary packages or run package scripts. Choose an approved local package or export the project.",
  terminal:
    "This browser-isolated artifact has no terminal or operating-system shell. Export the project to use local tools.",
  serverCompute:
    "Runs are bounded browser sessions, not hosted servers or background jobs.",
  breakpoints:
    "Spectra records output and source-linked failures, but it does not pause execution or step through a call stack.",
  profiler:
    "Spectra enforces runtime budgets, but it does not provide CPU or memory profiling.",
  extensions:
    "This browser artifact cannot install editor extensions. Supported checks are named in Settings.",
  richNotebook:
    "Notebook cells run as Python source. Spectra does not preserve Jupyter widgets, rich MIME output bundles, or kernel metadata.",
  notebookExport:
    "Spectra cannot export a fidelity-preserving Jupyter notebook. Export Python source or the complete source archive instead.",
  remoteKernel:
    "Notebook cells use a bounded local worker, not a durable remote kernel session.",
  pythonFormat:
    "Python formatting is not bundled in this offline runtime. Source stays unchanged.",
  externalLint:
    "Spectra does not execute project scripts or download linters. Export the project for those checks.",
  publicRunLink:
    "Individual run traces are private artifact history. Publish the verified build to share a runnable link.",
} as const);

const CODE_SPECS: readonly CodeSpec[] = [
  {
    localId: "controls",
    description: "Edit the typed parameters a reader can change.",
    requires: "edit",
    manifest: "configure_parameters",
  },
  {
    localId: "runtime.interact",
    description: "Interact with the isolated published runtime.",
    requires: "execute",
    exposed: false,
    embed: { levels: ["interact", "edit"] },
  },
  {
    localId: "files",
    description: "Show or hide the project file tree.",
    exposed: false,
  },
  {
    localId: "find",
    description: "Find text in the active source file.",
    manifest: "read_file",
    exposed: false,
  },
  {
    localId: "format",
    description:
      "Format the active source with its bundled deterministic formatter.",
    requires: "edit",
    manifest: "format_source",
  },
  {
    localId: "settings",
    description: "Open runtime, package, access, and connection settings.",
    exposed: false,
  },
  {
    localId: "publish",
    description:
      "Publish the current verified build at an artifact checkpoint.",
    requires: "edit",
    manifest: "prepare_publish",
    risk: "confirm",
  },
  {
    localId: "import-files",
    description: "Import source files or a safe source archive.",
    requires: "edit",
    exposed: false,
  },
  {
    localId: "import-folder",
    description: "Import a source folder without executing its scripts.",
    requires: "edit",
    exposed: false,
  },
  {
    localId: "export-archive",
    description: "Export the complete source archive.",
    exposed: false,
  },
  {
    localId: "export-html",
    description: "Export the current isolated HTML output.",
    exposed: false,
  },
  {
    localId: "export-svg",
    description: "Export a rendered SVG output.",
    exposed: false,
  },
  {
    localId: "export-png",
    description: "Export a rendered PNG output.",
    exposed: false,
  },
  {
    localId: "export-pdf",
    description: "Export a rendered PDF output.",
    exposed: false,
  },
  {
    localId: "export-webm",
    description: "Export a short rendered canvas video.",
    exposed: false,
  },
  {
    localId: "download-file",
    description: "Download the active source file.",
    exposed: false,
  },
  {
    localId: "unpublish",
    description:
      "Remove the live published build while retaining pinned history.",
    requires: "edit",
    risk: "confirm",
    exposed: false,
  },

  {
    localId: "files.create",
    description: "Create a source file at a safe project path.",
    params: filePath,
    requires: "edit",
    manifest: "create_file",
  },
  {
    localId: "files.rename",
    description: "Rename a source file without changing its stable identity.",
    params: renameFile,
    requires: "edit",
    manifest: "rename_file",
  },
  {
    localId: "files.duplicate",
    description: "Duplicate a source file at a unique sibling path.",
    params: fileId,
    requires: "edit",
    manifest: "plan_files",
  },
  {
    localId: "files.setEntry",
    description: "Choose the project entry file.",
    params: fileId,
    requires: "edit",
    manifest: "plan_files",
  },
  {
    localId: "files.delete",
    description: "Delete a source file while retaining artifact history.",
    params: fileId,
    requires: "edit",
    manifest: "delete_file",
    risk: "confirm",
  },
  {
    localId: "files.searchProject",
    description: "Search paths and source across the project.",
    params: projectQuery,
    manifest: "inspect_tree",
  },

  {
    localId: "runtime.run",
    description: "Run the current project in its declared isolated runtime.",
    requires: "execute",
    manifest: "run",
  },
  {
    localId: "runtime.stop",
    description: "Stop the active bounded run without changing source.",
    requires: "execute",
    manifest: "stop",
  },
  {
    localId: "runtime.rerun",
    description: "Run the current source again and record a distinct result.",
    requires: "execute",
    manifest: "run",
  },
  {
    localId: "runtime.packages",
    description: "Select packages from the pinned local runtime set.",
    params: packageSelection,
    requires: "edit",
    manifest: "declare_dependency",
    risk: "confirm",
  },
  {
    localId: "runtime.sourceOnly",
    description:
      "Keep unsupported-language source editable and exportable without claiming execution.",
    exposed: false,
  },
  {
    localId: "runtime.installArbitraryPackage",
    description: CODE_CAPABILITY_REFUSALS.arbitraryPackages,
    refusal: CODE_CAPABILITY_REFUSALS.arbitraryPackages,
    manifest: "declare_dependency",
  },
  {
    localId: "runtime.terminal",
    description: CODE_CAPABILITY_REFUSALS.terminal,
    refusal: CODE_CAPABILITY_REFUSALS.terminal,
    exposed: false,
  },
  {
    localId: "runtime.serverCompute",
    description: CODE_CAPABILITY_REFUSALS.serverCompute,
    refusal: CODE_CAPABILITY_REFUSALS.serverCompute,
    exposed: false,
  },

  {
    localId: "output.problems",
    description: "Open source-linked build and runtime problems.",
    exposed: false,
  },
  {
    localId: "output.console",
    description: "Open the bounded sanitized output trace.",
    manifest: "inspect_runtime",
    exposed: false,
  },
  {
    localId: "output.clear",
    description: "Clear transient output from the current view.",
    exposed: false,
  },
  {
    localId: "tests.run",
    description: "Run the declared checks in the same isolated runtime.",
    requires: "execute",
    manifest: "run_tests",
  },
  {
    localId: "diagnostics.check",
    description:
      "Build and inspect truthful TypeScript, bundler, and runtime diagnostics.",
    requires: "execute",
    manifest: "verify_output",
  },
  {
    localId: "diagnostics.accessibility",
    description: "Check the rendered output's accessibility structure.",
    requires: "execute",
    manifest: "check_accessibility",
  },
  {
    localId: "runs.history",
    description: "Inspect bounded reproducible run reports.",
    manifest: "inspect_runtime",
    exposed: false,
  },
  {
    localId: "runs.copyReport",
    description: "Copy a sanitized run report as Markdown.",
    params: runReportTarget,
    manifest: "share_run_result",
  },
  {
    localId: "runs.downloadReport",
    description: "Download a sanitized machine-readable run report.",
    params: runReportTarget,
    manifest: "share_run_result",
  },
  {
    localId: "runs.publicLink",
    description: CODE_CAPABILITY_REFUSALS.publicRunLink,
    params: runReportTarget,
    refusal: CODE_CAPABILITY_REFUSALS.publicRunLink,
    manifest: "share_run_result",
  },

  {
    localId: "notebook.cells",
    description:
      "Treat Python # %% sections as source cells without creating a second document model.",
    requires: "edit",
    manifest: "plan_files",
  },
  {
    localId: "notebook.runCell",
    description: "Run the Python cell containing the cursor.",
    requires: "execute",
    manifest: "run_cell",
  },
  {
    localId: "notebook.runAll",
    description: "Run Python cells in source order.",
    requires: "execute",
    manifest: "run",
  },
  {
    localId: "notebook.richOutputs",
    description: CODE_CAPABILITY_REFUSALS.richNotebook,
    refusal: CODE_CAPABILITY_REFUSALS.richNotebook,
    exposed: false,
  },
  {
    localId: "notebook.exportIpynb",
    description: CODE_CAPABILITY_REFUSALS.notebookExport,
    refusal: CODE_CAPABILITY_REFUSALS.notebookExport,
    exposed: false,
  },
  {
    localId: "notebook.remoteKernel",
    description: CODE_CAPABILITY_REFUSALS.remoteKernel,
    refusal: CODE_CAPABILITY_REFUSALS.remoteKernel,
    exposed: false,
  },

  {
    localId: "format.python",
    description: CODE_CAPABILITY_REFUSALS.pythonFormat,
    refusal: CODE_CAPABILITY_REFUSALS.pythonFormat,
    manifest: "format_source",
  },
  {
    localId: "lint.external",
    description: CODE_CAPABILITY_REFUSALS.externalLint,
    refusal: CODE_CAPABILITY_REFUSALS.externalLint,
    manifest: "verify_output",
  },
  {
    localId: "extensions.install",
    description: CODE_CAPABILITY_REFUSALS.extensions,
    refusal: CODE_CAPABILITY_REFUSALS.extensions,
    exposed: false,
  },
  {
    localId: "debug.breakpoints",
    description: CODE_CAPABILITY_REFUSALS.breakpoints,
    refusal: CODE_CAPABILITY_REFUSALS.breakpoints,
    manifest: "debug",
  },
  {
    localId: "debug.profiler",
    description: CODE_CAPABILITY_REFUSALS.profiler,
    refusal: CODE_CAPABILITY_REFUSALS.profiler,
    exposed: false,
  },
  {
    localId: "visualisation.fullscreen",
    description: "Open the successful output without editor chrome.",
    exposed: false,
  },
  {
    localId: "sourceControl.git",
    description:
      "Export source until the deferred GitHub connector program owns remote repository operations.",
    exposed: false,
    refusal:
      "Git source control is deferred to the Tier-2 GitHub connector program. Export the source archive to continue in a repository.",
  },
];

export const CODE_STUDIO_CAPABILITIES: readonly CapabilityDefinition[] =
  CODE_SPECS.map((spec) => {
    const id = stableCapabilityId("code", spec.localId);
    const requires = spec.requires === false ? undefined : spec.requires;
    return {
      id: id as CapabilityDefinition["id"],
      params: spec.params ?? none,
      scope: "artifact",
      availability: (ctx) => {
        if (requires && !ctx.can(requires)) return { state: "hidden" as const };
        if (spec.refusal)
          return { state: "disabled" as const, reason: spec.refusal };
        return { state: "enabled" as const };
      },
      execute: { editor: id },
      ai: {
        exposed: spec.exposed ?? Boolean(spec.manifest),
        description: spec.description,
        riskClass: spec.risk ?? "safe",
      },
      choreography: { target: "workbar-command", region: id },
      ...(spec.embed ? { embed: spec.embed } : {}),
      ...(requires ? { requires } : {}),
      ...(spec.manifest ? { manifestOperation: spec.manifest } : {}),
    } satisfies CapabilityDefinition;
  });
