# Testing and Milestones

## Principle

Each implementation wave should stop at a meaningful test milestone.

Do not ask Pablo to test every tiny internal change. Stop after a wave has enough UI/backend behavior to inspect.

## First run

No implementation.

Expected output:

```txt
READY FOR HUMAN REVIEW — NO IMPLEMENTATION DONE.
```

The agent should produce audit/planning docs.

## Wave 0 test checklist

After foundation reset:

- app installs/builds
- dev server starts
- Convex dev/local setup works or clearly documented
- `/chat` route loads
- `/workspace` route loads new shell, not old WorkspaceV2
- `/artifacts` route loads new shell, not old artifact page
- old root markdown junk is removed/archived after extraction
- new source-of-truth docs remain
- no new Spectra modules import old workspace/artifact/orchestration paths

## Wave 1 test checklist

After core data model:

- can create workspace
- can create artifact
- can add artifact to workspace
- can remove workspace projection without deleting artifact
- artifact appears in library
- workspace cards view reads real data
- basic seed data appears

## Wave 2 test checklist

After blueprints/library:

- document artifact renders
- flashcard deck renders as deck, not markdown
- quiz renders as quiz, not markdown
- planner task renders as task
- thread reference card renders
- Add to workspace picker works
- unplaced artifacts have clear inbox/library status

## Wave 3 test checklist

After chat shared primitives:

- normal chat creates Thread and Messages
- AI response persists
- compact status replaces ugly thinking/tool trace
- created artifact from chat goes to library/inbox
- chat artifact card has Open / Add to workspace
- Add to workspace opens picker

## Wave 4 test checklist

After workspace command/result cards:

- command bar creates AIRun
- running result card appears
- result card updates to completed/failed
- hide button hides but does not delete
- hidden card can be found in right hub/activity
- opening result card can open artifact/thread/details
- simple artifact creation in workspace adds it to workspace by default

## Wave 5 test checklist

After right hub/threads:

- multiple runs visible in hub
- pinned threads visible
- thread can be projected into workspace as card
- opening thread sets command bar context
- continuing thread works
- result cards and threads do not clutter workspace automatically

## Wave 6 test checklist

After anti-clutter/polish:

- AI asks confirmation before creating new workspace
- AI asks confirmation before many visible objects
- 30 flashcards produce one deck artifact
- deleting requires confirmation
- microinteractions feel polished
- keyboard/focus states work
- UI feels consistent

## Regression tests to add

Add tests for:

```txt
operation validation
artifact blueprint validation
workspace projection logic
AIRun lifecycle
ResultCard hide/unhide behavior
chat-created artifact placement policy
workspace-created artifact placement policy
legacy import ban
```

## Manual feedback prompts for Pablo

After each wave, the agent should tell Pablo:

```txt
What changed
What to test
Expected behavior
What screenshots/feedback to send
Known limitations
Next proposed wave
```

## No slop rule

If the wave leaves broken UI, say so honestly.

Do not pretend scaffolds are finished.

Prefer fewer features that work and look intentional.
