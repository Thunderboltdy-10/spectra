# Code Capability Inventory

**Unit:** P12.I4
**Leaders compared:** Visual Studio Code, Replit, JupyterLab
**Inventory date:** 2026-08-30
**IR baseline before P12.I4:** 17 `code.*` definitions
**IR baseline after P12.I4:** 54 `code.*` definitions
**Closure rule:** every row below resolves through a `CapabilityDefinition` as `SHIP`, `REFUSE-HONESTLY`, or `DEFER-WITH-OWNER`. A UI-only command or runtime side channel is not closure.

## 1. Product boundary

Spectra Code is a collaborative, browser-isolated project and visualisation studio. It is not a local VS Code replacement, a hosted Linux machine, or a full Jupyter kernel service. Its serious lane is bounded multi-file authoring, deterministic browser and React builds, isolated Pyodide Python, explicit tests and diagnostics, durable published visualisations, and portable source.

The comparison targets the first-hour workflows students and teachers actually miss: navigating a project, running it, understanding a failure, using a small approved package set, working in notebook-shaped Python, checking source, producing a rich result, and sharing evidence. Extensions, shell access, arbitrary native packages, Git hosting, and breakpoint debuggers remain outside that containment boundary and must say so before an attempted mutation.

## 2. Inventory matrix

### 2.1 Project and file ergonomics

| Leader capability                                      | Spectra resolution   | Capability IR                             | Product contract and evidence target                                                                                                  |
| ------------------------------------------------------ | -------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-file project tree                                | **SHIP**             | `code.files`                              | One stable file tree, active-file selector, and Yjs file identities. No single-file flattening.                                       |
| Create a file or nested path                           | **SHIP**             | `code.files.create`                       | Validate the path inside the artifact root; preserve every unrelated file.                                                            |
| Rename a file                                          | **SHIP**             | `code.files.rename`                       | Reject duplicate or escaping paths; keep the stable file id.                                                                          |
| Duplicate a file                                       | **SHIP**             | `code.files.duplicate`                    | Generate a unique sibling path and new line identities.                                                                               |
| Delete a file                                          | **SHIP**             | `code.files.delete`                       | Confirm, retain history, and refuse deletion of the only file.                                                                        |
| Choose the project entry file                          | **SHIP**             | `code.files.setEntry`                     | Entry identity must reference a real file and survive reload.                                                                         |
| Search file paths                                      | **SHIP**             | `code.files.searchProject`                | Bounded, keyboard-reachable filtering in the shared file rail.                                                                        |
| Search source across the project                       | **SHIP**             | `code.files.searchProject`                | Return bounded file, line, column, and snippet results; selecting one focuses the exact source location.                              |
| Import files, folders, ZIP, TAR, and adapted notebooks | **SHIP**             | `code.import.files`, `code.import.folder` | Retain the exact original privately; quarantine secrets, binaries, unsafe paths, and oversized entries.                               |
| Export the complete source project                     | **SHIP**             | `code.export.archive`                     | ZIP includes source, approved runtime declarations, and verified runtime assets.                                                      |
| Git branches, commits, pull requests, and remote sync  | **DEFER-WITH-OWNER** | `code.sourceControl.git`                  | Owner: Tier-2 GitHub connector program named in EXPANSION §2. Until then, export a real archive; do not imply a repository is linked. |

### 2.2 Runtime and package management

| Leader capability                                      | Spectra resolution  | Capability IR                          | Product contract and evidence target                                                                                                  |
| ------------------------------------------------------ | ------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Run HTML, CSS, and JavaScript                          | **SHIP**            | `code.runtime.run`                     | Server build applies loop guards, then runs in the existing opaque-origin sandbox.                                                    |
| Build and run React + TypeScript                       | **SHIP**            | `code.runtime.run`                     | Strict TypeScript check, bounded esbuild bundle, declared imports only.                                                               |
| Run Python locally                                     | **SHIP**            | `code.runtime.run`                     | Pyodide worker, no network, bounded time/source/output, explicit run only.                                                            |
| Stop an active run                                     | **SHIP**            | `code.runtime.stop`                    | Terminate the Python worker or invalidate the active browser build sequence without changing source.                                  |
| Repeat the latest run                                  | **SHIP**            | `code.runtime.rerun`                   | Reuse the same declared runtime and current source, creating a distinct run report.                                                   |
| Curated Python scientific packages                     | **SHIP**            | `code.runtime.packages`                | Author can select only NumPy, pandas, Matplotlib, SciPy, scikit-learn, and SymPy. Versions come from the pinned Pyodide distribution. |
| Curated React packages                                 | **SHIP**            | `code.runtime.packages`                | React core plus pinned Recharts, D3, Lucide, and date-fns declarations.                                                               |
| Arbitrary pip, conda, npm, apt, or package scripts     | **REFUSE-HONESTLY** | `code.runtime.installArbitraryPackage` | “Spectra does not install arbitrary packages or run package scripts. Choose an approved local package or export the project.”         |
| Integrated terminal or shell process                   | **REFUSE-HONESTLY** | `code.runtime.terminal`                | “This browser-isolated artifact has no terminal or operating-system shell. Export the project to use local tools.”                    |
| Long-running server, GPU, or background worker hosting | **REFUSE-HONESTLY** | `code.runtime.serverCompute`           | “Runs are bounded browser sessions, not hosted servers or background jobs.”                                                           |
| Edit an unsupported language                           | **SHIP**            | `code.runtime.sourceOnly`              | Source remains editable, collaborative, searchable, and exportable with a visible Source-only runtime state.                          |

### 2.3 Diagnostics, testing, and debugging

| Leader capability                                                        | Spectra resolution  | Capability IR                              | Product contract and evidence target                                                                                     |
| ------------------------------------------------------------------------ | ------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Problems list with source locations                                      | **SHIP**            | `code.output.problems`                     | Build/runtime problems project into CodeMirror lint marks and focus the exact file and line where truthful.              |
| Console and stdout/stderr trace                                          | **SHIP**            | `code.output.console`                      | Sanitized bounded trace with explicit log level and no invented file attribution.                                        |
| Declared project tests                                                   | **SHIP**            | `code.tests.run`                           | Browser/React tests execute inside the same sandbox; Python tests run in the isolated worker.                            |
| Static TypeScript diagnostics                                            | **SHIP**            | `code.diagnostics.check`                   | Strict TypeScript diagnostics and build warnings, not a claim of full ESLint parity.                                     |
| Run timeline and exact result summary                                    | **SHIP**            | `code.runs.history`                        | Persist a bounded result record with runtime, status, duration, source fingerprint, output excerpt, problems, and tests. |
| Breakpoint-free output tracing                                           | **SHIP**            | `code.runs.history`, `code.output.console` | Each run has ordered lifecycle events and output; failures link back to truthful source locations.                       |
| Breakpoints, watches, call-stack stepping, and debug console             | **REFUSE-HONESTLY** | `code.debug.breakpoints`                   | “Spectra records output and source-linked failures, but it does not pause execution or step through a call stack.”       |
| CPU or memory profiler                                                   | **REFUSE-HONESTLY** | `code.debug.profiler`                      | Runtime budgets are enforced, but no profiler measurements are claimed.                                                  |
| Arbitrary language servers, formatter extensions, or debugger extensions | **REFUSE-HONESTLY** | `code.extensions.install`                  | The browser artifact cannot install editor extensions; supported checks are named in Settings.                           |

### 2.4 Notebook-shaped Python

| Leader capability                                                        | Spectra resolution  | Capability IR                | Product contract and evidence target                                                                                            |
| ------------------------------------------------------------------------ | ------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `# %%` Python cell boundaries                                            | **SHIP**            | `code.notebook.cells`        | Stable cell discovery in the active Python entry file with no second document model.                                            |
| Run the current cell                                                     | **SHIP**            | `code.notebook.runCell`      | Execute the cell containing the cursor in the same isolated Python profile and record a run result.                             |
| Run all cells                                                            | **SHIP**            | `code.notebook.runAll`       | Execute cells in source order; ordinary project Run remains equivalent to run-all.                                              |
| Import `.ipynb` code cells                                               | **SHIP** (adapted)  | `code.import.files`          | Convert code cells to `# %%` Python while explicitly reporting that outputs and rich notebook metadata were not imported.       |
| Rich per-cell MIME bundles, markdown cells, widgets, and kernel metadata | **REFUSE-HONESTLY** | `code.notebook.richOutputs`  | “Notebook cells run as Python source. Spectra does not preserve Jupyter widgets, rich MIME output bundles, or kernel metadata.” |
| Export a fidelity-preserving `.ipynb`                                    | **REFUSE-HONESTLY** | `code.notebook.exportIpynb`  | Export `.py` or the full source archive; do not manufacture notebook metadata Spectra does not own.                             |
| Remote kernels and persistent server sessions                            | **REFUSE-HONESTLY** | `code.notebook.remoteKernel` | Cell state is bounded to the local worker lifecycle and is never presented as a durable remote kernel.                          |

### 2.5 Formatting and linting

| Leader capability                                            | Spectra resolution  | Capability IR            | Product contract and evidence target                                                                 |
| ------------------------------------------------------------ | ------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Format JavaScript, TypeScript, JSON, HTML, CSS, and Markdown | **SHIP**            | `code.format`            | Lazy Prettier standalone with the parser named by the active file; one undoable source update.       |
| Format Python                                                | **REFUSE-HONESTLY** | `code.format.python`     | “Python formatting is not bundled in this offline runtime. Source stays unchanged.”                  |
| Lint React/TypeScript project structure                      | **SHIP**            | `code.diagnostics.check` | TypeScript and bundler diagnostics cover imports, types, paths, and build validity.                  |
| ESLint, Ruff, Pylint, or project-defined lint scripts        | **REFUSE-HONESTLY** | `code.lint.external`     | “Spectra does not execute project scripts or download linters. Export the project for those checks.” |

### 2.6 Visualisation output and accessibility

| Leader capability                                   | Spectra resolution | Capability IR                                                               | Product contract and evidence target                                                              |
| --------------------------------------------------- | ------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Live browser or React preview                       | **SHIP**           | `code.runtime.interact`                                                     | Stable isolated render target with Source, Visualisation, and Both modes.                         |
| Python HTML output                                  | **SHIP**           | `code.runtime.interact`                                                     | `spectra.render()` accepts bounded HTML which still passes through the sandbox document.          |
| Python charts                                       | **SHIP**           | `code.runtime.interact`                                                     | `spectra.chart()` renders accessible bar, line, or scatter SVG from bounded JSON.                 |
| Viewer-facing parameters                            | **SHIP**           | `code.controls`                                                             | Stable typed parameters update the isolated output without source mutation.                       |
| Permissioned artifact and Sheets data               | **SHIP**           | `code.settings`                                                             | Explicit bounded bindings only; no ambient workspace access.                                      |
| Fullscreen output                                   | **SHIP**           | `code.visualisation.fullscreen`                                             | Visual-only frame with the same run status and no duplicate editor chrome.                        |
| Export isolated HTML                                | **SHIP**           | `code.export.html`                                                          | Current successful sandbox document only.                                                         |
| Export rendered SVG, PNG, PDF, or short canvas WebM | **SHIP**           | `code.export.svg`, `code.export.png`, `code.export.pdf`, `code.export.webm` | Each exporter refuses when the active output cannot honestly produce that format.                 |
| Output accessibility audit                          | **SHIP**           | `code.diagnostics.accessibility`                                            | Title, landmarks, headings, labels, image alt text, graphics labels, duplicate ids, and language. |

### 2.7 Sharing and reproducibility

| Leader capability                           | Spectra resolution  | Capability IR              | Product contract and evidence target                                                                                  |
| ------------------------------------------- | ------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Publish a retained runnable result          | **SHIP**            | `code.publish`             | Publish only a current successful, accessible, synchronized build pinned to an artifact checkpoint.                   |
| Unpublish without breaking pinned history   | **SHIP**            | `code.unpublish`           | Remove the live build; existing pinned embeds keep their checkpoint.                                                  |
| Copy a run result for a teacher or teammate | **SHIP**            | `code.runs.copyReport`     | Copy a bounded Markdown report with status, source fingerprint, tests, problems, and output excerpt.                  |
| Download a machine-readable run result      | **SHIP**            | `code.runs.downloadReport` | Export one bounded JSON report; never include secrets, private resources, or runtime asset bytes.                     |
| Public permalink for an ephemeral run       | **REFUSE-HONESTLY** | `code.runs.publicLink`     | “Individual run traces are private artifact history. Publish the verified build to share a runnable link.”            |
| Collaborative source editing                | **SHIP**            | `code.files`               | File-scoped Yjs text, stable line identities, focus-aware AI targeting, and no whole-project overwrite per keystroke. |

## 3. Honest runtime limits shown in the product

- Python: local Pyodide worker; 12-second default run limit; 1.5 MB source runtime ceiling; at most 120 runtime files; 120,000 output characters; no network; six approved scientific packages; no arbitrary wheels.
- React and browser: 900 KB live artifact source; bounded build output; imports restricted to project files, the Spectra SDK, and declared approved packages; package scripts are preserved as source and never run.
- Imports: unsafe paths, secret-bearing files, executables, unsupported binaries, excessive expansion, and oversized assets are quarantined with a readable report. The original selected material is retained separately for recovery.
- Runs: result history is bounded and sanitized. Publishing is a separate checkpointed action, not a synonym for “the last run looked fine.”

## 4. Close-out evidence required by P12.V2

1. Inventory-to-product walk for every `SHIP` row and every visible refusal sentence.
2. Human and AI symmetry for file edits, package selection, run/check/test, notebook cell execution, and run-result reporting.
3. Schema v1 to v2 migration test plus reload-safe normalization.
4. Capability conformance and work-kernel suites, with code definitions no longer sourced from the legacy multi-studio file.
5. Keyboard coverage for run, run cell, format, search, problems, console, and tests.
6. Narrow-width workbar proof: actions shed deterministically to the shared overflow; no capability is deleted for fit.
