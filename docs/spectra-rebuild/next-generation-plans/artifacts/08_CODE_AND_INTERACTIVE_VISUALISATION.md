# Code and interactive visualisation artifact plan

## Product boundary

This artifact inherits the standard and has two purposeful faces: source workspace and rendered experience. Educational visualizations open rendered by default; programming exercises open code by default. Non-programmers get prompt, property/data controls, explanation, accessibility checker, and safe preview without needing the file tree.

Content is a content-addressed file tree plus manifest: artifact purpose, entry point, runtime profile/version, dependencies/lockfile, build config, environment schema without secret values, network policy, test commands, preview settings, datasets/assets, accessibility metadata, and publish settings. Stable file/symbol/visual-component IDs support AI regions and history.

## Runtime choice and security

Recommend browser React/TypeScript with a versioned Spectra component/tokens SDK and scoped Tailwind-compatible utilities for interactive visualizations. Vanilla web is importable. Python is the second isolated runtime. Compiled languages use remote disposable sandboxes only when profiles are approved. Broad language support means versioned execution profiles, not executing arbitrary commands on the app server.

Preview runs in a sandboxed opaque-origin iframe with CSP, typed SDK bridge, no cookies/ambient credentials, no network by default, resource/time limits, dependency allowlist/scanning, and sanitized console. Remote builds/runs use microVM/container isolation, unprivileged user, read-only base, ephemeral filesystem, egress allowlist, secret brokerage, quotas, cancellation, and output limits. Publishing/URLs remain D-15.

## Editing, collaboration, AI, history

Provide file tree, Monaco-like editor, search, problems, console, tests, preview, split orientation, runtime/dependency status, version control concepts without exposing Git complexity, and full/panel/embed/history. Collaboration uses text CRDT per file and transactional file-tree operations; presence shows file/cursor. Binary/generated files are not collaboratively edited.

AI can plan files, create progressively, patch symbols/ranges, run build/test/accessibility, inspect runtime errors, and connect datasets. It uses a design-generation standard for spacing/type/color/components/motion and provides a natural-language change summary. Never auto-run newly generated privileged/network code without policy/approval. Conflicts pause by file/region; a proposal workspace supports broad rewrites.

History stores content-addressed trees and build/runtime manifest, renders historical source and a safely rebuilt snapshot when dependencies remain available. Restore creates a new tree. Embeds pin runtime/dependencies and communicate only through the SDK.

## Failures and migration

Handle build timeout, dependency outage/malware, runtime crash, infinite output, inaccessible visualization, unavailable compiler, asset loss, offline source changes, and revoked publish permission. Preserve source even when preview fails. There is no current conforming code artifact to migrate; any legacy generic artifacts import through quarantine and user review.

## Tasks

### CODE-01 Define file-tree, manifest, runtime/dependency, network, test, dataset, asset, and publish schemas

- [ ] Implemented
- [ ] Verified

### CODE-02 Build source/rendered/non-programmer views, editor/files/problems/tests/console/preview, card/embed/history

- [ ] Implemented
- [ ] Verified

### CODE-03 Build Spectra visualization SDK/tokens and accessible generation/design conformance checks

- [ ] Implemented
- [ ] Verified

### CODE-04 Implement browser sandbox/CSP/SDK bridge and isolated remote execution profiles

- [ ] Implemented
- [ ] Verified

### CODE-05 Implement file collaboration, presence, comments, proposal workspace, content-addressed history, and restore

- [ ] Implemented
- [ ] Verified

### CODE-06 Implement AI plan/create/patch/build/test/debug/accessibility with progressive traces and approvals

- [ ] Implemented
- [ ] Verified

### CODE-07 Implement dependency scanning, quotas, egress, secrets, cancellation, logs, and abuse controls

- [ ] Implemented
- [ ] Verified

### CODE-08 Prove isolation, resource limits, accessibility, reproducible rebuild, conflicts, and source preservation

- [ ] Implemented
- [ ] Verified
