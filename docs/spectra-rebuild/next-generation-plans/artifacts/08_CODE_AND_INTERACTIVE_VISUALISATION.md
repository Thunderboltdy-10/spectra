# Code and interactive visualisation artifact plan

## Product and reference contract

This artifact inherits the standard and has two approachable faces: source workspace and rendered experience. Educational visualisations open rendered by default; programming work opens code by default. `17_code_visualisation_editor.png` is the executable specification for shell, source/preview balance, controls, details, linked work, and localized AI state. Implement every visible control plus file tree, problems, tests, console, dependencies/runtime, history, panel/card/embed, narrow/touch, accessibility, and reduced-motion states.

Code source may be any programming language. Execution support initially prioritizes browser HTML/CSS/JavaScript, React/TypeScript visualisations, and isolated Python. Other common interpreted languages may be added when practical and security/performance tests pass. Compiled-language execution is not required initially and must not create placeholder runtime choices.

Artifacts are private by default with read-only/modify sharing, workspace exceptions, and explicit publishing. Embedded/published runtimes never inherit ambient credentials or broaden source/resource access.

## Model and approachable editing

Content is a content-addressed file tree plus versioned manifest: purpose, entry point, language, runtime profile/version, dependencies/lockfile, build config, environment schema without values, network/tool policy, tests, preview, Sheets ranges/assets/resources, accessibility metadata, and publish settings. Stable file/range/symbol/visual-component/preview-property IDs define regions and history.

Provide file tree, code editor, search, problems, console, tests, source/preview split/orientation, runtime/dependency status, and version concepts without requiring Git expertise. Non-programmers get prompt, property/data controls, explanation, accessibility checks, and safe preview without navigating files. Advanced runtime/network/dependency settings live behind clear inspectors. Interactive outputs should remain focused educational tools rather than sprawling developer projects.

## Visualisation design skill and runtime safety

Load a dedicated on-demand Spectra visualisation design skill whenever AI creates or materially styles an interactive output. It defines typography, colour, spacing, layout, components, data graphics, responsive behavior, motion, reduced motion, accessibility, and embed integration using a versioned Spectra token/component/chart SDK. Generated work must look polished and native, not like an unstyled demo.

Browser preview runs in an opaque-origin sandboxed iframe with CSP, typed SDK bridge, no cookies/ambient secrets, no network by default, resource/time/output limits, dependency allowlist/scanning, and sanitized console. Python and later interpreted profiles run in isolated unprivileged disposable containers/microVMs with read-only base, ephemeral filesystem, egress allowlist, secret brokerage only when explicitly configured, cancellation, and metering. Nothing runs as arbitrary commands on the app server. Publishing pins runtime/dependencies and communicates only through the SDK.

## Collaboration, AI, effects, and history

Text CRDT per file plus transactional file-tree operations synchronize live through self-hosted Yjs. Binary/generated files are immutable assets. Stable file/range/symbol/component regions use exclusive active claims; non-overlapping files/ranges proceed concurrently, while conflicts pause/queue with resolution. Presence shows file/cursor/preview target; comments anchor to source or visual component. Network loss exposes reconnect/unsynchronized/recovery and does not accept offline edits.

The on-demand code artifact skill defines purpose/selection, regions, inspection, create/patch/build/test/debug/accessibility operations, preservation, approvals, runtime policy, related Sheets/assets, and effects. AI can plan files, create progressively, patch symbols/ranges, analyze runtime errors, run allowed build/tests, and connect stable Sheets ranges/charts. Newly generated privileged/network behavior never auto-runs without policy/approval. Broad rewrites use a proposal workspace.

Actual source and preview participate in effects: code forms/morphs in the targeted range while a corresponding chart/component materializes or transitions in preview. Independent operations can animate concurrently. All effects clear on terminal state, including runtime failure, cancellation, rejection, revocation, or navigation.

Human sessions and every coherent AI batch create distinct content-addressed history, with a user checkpoint before AI over live unversioned work. Historical source and safely rebuilt preview are compared side by side when dependencies remain available. Restore creates a new tree/manifest version.

## Import, export, failures, and migration

Import source folders and ZIP/TAR archives after path traversal/malware/dependency checks; single files for any language; HTML/CSS/JS bundles; React/TypeScript projects within supported build profiles; Jupyter notebooks and Python packages in staged form; and CodePen/StackBlitz-style exports where feasible. Export source archive, supported static web bundle, standalone HTML where safe, rendered image/PDF/video where applicable, and portable manifest. Reports cover unsupported runtime/build/native modules, dependency substitutions, network/secrets, large assets, notebook outputs, and preview fidelity; originals are recoverable.

Handle build/test timeout, dependency outage/malware, runtime crash, infinite output, inaccessible visualisation, unavailable profile, asset/source revocation, reconnect, occupied region, permission change, invalid SDK use, interrupted AI, and unrebuildable historical preview. Preserve source even when preview fails.

## Tasks

### CODE-01 Define file-tree/manifest/language/runtime/dependency/network/test/Sheets-resource/asset/publish schemas, stable regions, validation, and migrations

- [ ] Implemented
- [ ] Verified

### CODE-02 Build exact reference plus approachable source/rendered/non-programmer/editor/files/problems/tests/console/preview/card/embed/history/responsive representations with every control functional

- [ ] Implemented
- [ ] Verified

### CODE-03 Build and enforce on-demand Spectra visualisation design skill plus token/component/chart SDK, responsive/accessibility/motion conformance, and polished embed integration

- [ ] Implemented
- [ ] Verified

### CODE-04 Implement secure browser/React and isolated Python execution profiles, CSP/SDK bridge, dependency/egress/secrets/resource policy, cancellation, logs, and abuse controls

- [ ] Implemented
- [ ] Verified

### CODE-05 Implement live file collaboration, presence/comments, exclusive regions/conflicts, reconnect, proposal workspace, content-addressed history/checkpoints, comparison, and restore

- [ ] Implemented
- [ ] Verified

### CODE-06 Implement on-demand code skill, AI plan/create/patch/build/test/debug/accessibility/Sheets operations, real synchronized source/preview effects, approvals, cleanup, and reduced motion

- [ ] Implemented
- [ ] Verified

### CODE-07 Implement staged source/archive/web/React/notebook/Python import and source/static/render export with quarantine, security/fidelity/unsupported reports, recovery, and tests

- [ ] Implemented
- [ ] Verified

### CODE-08 Prove every UI control, isolation/resource limits, design quality, accessibility, reproducible rebuild, mixed collaboration/conflicts, history, embeds, revocation, and source preservation

- [ ] Implemented
- [ ] Verified

