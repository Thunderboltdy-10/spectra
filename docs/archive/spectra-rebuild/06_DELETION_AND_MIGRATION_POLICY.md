# Deletion and Migration Policy

## Principle

Prefer clean rebuild over adaptation.

The cloned repo can be aggressively changed. Git history is the archive.

Do not preserve old code just because it exists.

## Temporary use of old code

Old code may be used for:

- understanding existing visual theme
- extracting useful types/ideas
- copying small reviewed UI primitives
- learning what not to repeat

Old code should not be used as the active foundation if it conflicts with the new architecture.

## Root Markdown cleanup

The repo likely contains many outdated root `.md` files from previous redesign attempts.

First-run agent should read them as historical evidence and extract useful ideas into:

```txt
docs/spectra-rebuild/generated/
```

Then, in the implementation wave after approval, delete or archive almost all old root `.md` files.

Recommended policy:

```txt
Keep:
  README.md if still useful
  docs/spectra-rebuild/**

Delete/archive:
  old redesign specs
  old audits
  old plans
  old root notes
  outdated implementation recipes
```

If unsure, move to:

```txt
docs/legacy-extracted/
```

But prefer deletion in cloned repo once extracted.

## Code deletion targets

Likely delete/disconnect:

```txt
old WorkspaceV2 implementation
old workspace-data API route
old artifact AI surface implementation
old artifacts page as primary UX
old workspace command result system
old ghost suggestion system if not reused
old multi-agent/task graph runtime as active foundation
old routing complexity from active path
old admin/analytics navigation
ManageBac/integration stubs if noisy
```

## Keep/adapt targets

Likely keep/adapt:

```txt
AppShell
theme system
sidebar/navigation shell
settings/theme UI feel
auth bootstrap if not blocking
Convex project setup
editor primitives if useful
markdown renderer if useful
basic chat UI primitives if useful
some old skill entries as inspiration
semantic zoom math as later inspiration
```

## Do not import old active paths

New Spectra modules should not import from old workspace/artifact/orchestrator modules.

Add a test or lint-like script if possible to prevent imports from known legacy directories.

Example policy:

```txt
src/features/spectra/** must not import from:
  src/components/workspace/**
  src/app/workspace/old/**
  src/lib/orchestrator/**
  src/lib/runtime-tools/**
  old artifact AI surfaces
```

Exact paths must be determined by audit.

## Migration policy

Because this is a cloned repo and clean rebuild is preferred, do not over-optimize data migrations unless necessary.

For local dev, it is acceptable to reset local Convex data.

If keeping production compatibility later, write migration scripts later.

## Convex policy

Keep Convex unless it becomes a blocker.

It is acceptable to drastically rewrite `convex/schema.ts`.

For local dev, the agent should inspect package scripts and Convex configuration before assuming commands. It should likely need to run local/dev Convex setup after schema changes, but must verify the repo's actual command/script.

## Admin policy

School-first does not mean admin-first.

Hide/deactivate admin pages if they distract from core rebuild.

Do not delete auth/org tables if they are needed for future school compatibility, but simplify usage.
