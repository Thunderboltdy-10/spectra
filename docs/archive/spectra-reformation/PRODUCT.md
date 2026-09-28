# PRODUCT — what Spectra is and how it must behave

This is the product context every implementation agent needs and no mission prompt should have to repeat. It compresses five generations of vision documents into current truth. Where it conflicts with older vision docs, this wins (under CANON).

## 1. The product in one paragraph

Spectra is one live workspace where students, teachers, and AI do real work together — on Spectra's own artifacts *and* on files people already own. A user points Spectra at their existing folders; their Word documents, spreadsheets, and presentations appear in the Library as first-class citizens that remain real files on disk, editable in Word one hour and in Spectra the next, synchronized safely in whichever direction the user chose with a simple toggle. On top of that foundation sits the reason to stay: an AI that can genuinely operate the workspace — create and edit artifacts well, organize the Library, find things, change settings with permission, and show its work — plus real-time collaboration, embeds, and a coherent, calm, honest interface.

## 2. The two pillars

- **The Bridge lowers the barrier in.** Nobody migrates a decade of schoolwork into a proprietary format. Files stay files (CANON D25, R1). This only matters if it is *boringly reliable* — a Bridge that corrupts one essay has negative value. Reliability standard: a school pilot with real children's coursework.
- **The AI is the reason to stay.** Not a chatbot beside the editor — an operator across the workspace whose output quality exceeds what the user would produce alone: presentations with actual design, analysis with actual formulas and charts, edits that respect structure and intent, organization that shows judgment. Tool access without intelligence is explicitly a non-goal (owner's brief, §8).

## 3. Users and launch scope

First audience: schools (students, teachers; ManageBac-connected), releasable, no developer chrome. **This program's launch scope excludes** class-scoped assignment, grading queues, and timetable retirement. ManageBac onboarding class choice moved into launch scope by decision 2026-09-03: because the provider retains old and irrelevant classes, Spectra never imports every candidate by default. A person explicitly chooses what appears, may skip when the provider is unavailable, and can revise the selection later from School or ManageBac without losing work. Every other first-run choice has one editable home in Settings. The launch bar is: a new person reaches useful work naturally, and the core workspace, Bridge, artifacts, AI, and collaboration are production-real for individual and shared work.

## 4. The artifact world

Ten blueprint types exist; nine creatable (timetable is legacy, retired from creation): **document, sheets, presentation** (the Office trio, lens-backed for mounted files), **quiz, flashcard deck, code/visualization, whiteboard, planner task, agent**, plus threads and generic resources (PDFs, images, unknown files) as real Library citizens. Non-Office studios are healthier than the Office trio today (see compendium) and must be brought onto the operation IR in P3 without regressing.

## 5. The experience laws (operationalizing CANON R13–R16)

These are the rules that keep agents from re-inventing interaction patterns:

1. **Storage is three toggles, not a policy editor.** Per item or folder: *Keep on this computer* / *Keep in Spectra* / *Both (recommended)* — each with a one-line consequence sentence ("Edits made here will also update the file on your PC"). Protected-original ("look, don't touch") is an advanced switch on the mount, phrased plainly ("Spectra can read these files but will never change them"). The engine's four strategies and timing modes remain underneath; the mapping is fixed in ARCHITECTURE-TRUTH §6 and never leaks vocabulary upward.
2. **The Bridge disappears.** When healthy: no periodic churn, no status noise, files just work. When absent: everything non-local works fully, and local items say plainly "This file lives on your PC. Open Spectra Bridge on that computer to use it here." When broken: one honest sentence, one action ("Reconnect" / "Update Bridge"), never a reinstall instruction, never a raw error string.
3. **States are visible in place.** The file row shows its own sync chip. The save indicator on the studio shows saving/saved/conflict truthfully (fed by the *one* status presenter, ARCHITECTURE-TRUTH §5). Conflicts appear where the work is and in the Library — never only inside an open artifact. Offline is a product-wide truth, not an artifact-local secret.
4. **Every dead end has a door.** No state may trap the user (the blank-title close trap, unresolvable conflicts, eternal "Saving…"). Close always works (with an explicit choice when work would be lost — a discard path exists). Errors always name a next step. Empty states teach.
5. **AI work is legible.** The dock names the real target of every operation ("Editing *Pendulum Lab Report*", never "the focused artifact"), shows what changed, and offers revert at run level. When Follow AI is on, the user sees navigation, cursor, and edits happen; when off, background work stays background but leaves honest traces.
6. **Nothing lies, including copy.** "Archive" must not permanently delete. "Search everywhere" must search everywhere or say what it searches. A count is a real count. A disabled control states why in a tooltip-length sentence.
7. **The viewport is a shared resource.** Dock, composer, panels, inspectors, comments, embeds, workbars, and content participate in one layout budget. Final content can always scroll clear; auxiliary panes do not make the work unreadable by covering or blurring it; overflow is intentional; one corner does not carry competing controls for the same moment.
8. **Simple fidelity is the canary.** A font name, size, bold state, highlight, or region effect shown by a control must agree with what is rendered, saved, reloaded, and written natively. A visually present control is not proof that its style exists.

## 6. What "production-ready" means here (acceptance vocabulary)

From the owner's brief, binding for P8's verdict: extremely reliable; safe with user files; recoverable when failures occur; honest about its state; performant on modest hardware; efficient in backend cost; polished; understandable; genuinely useful. Corruption, silent data loss, false sync claims, AI success reports for unpersisted changes, Bridge reinstall-to-recover, and collaboration truth divergence are each individually disqualifying.

## 7. Landing (P7 intent, preserved)

Keep the reveal concept: the landing page is itself a Spectra surface, built by visible collaborators/cursors, ending in a real shell reveal. Re-narrate for the current product (your files, the Bridge, the AI plane). It must remain a *landing page*: intuitive scrolling, comfortable pacing, explains and sells the product — exceptional and original without becoming an award-site chore. It ships late, after the product it reveals is real.

## 8. Future connectors (architecture requirement, not scope)

Google Workspace, Notion, Quizlet come later. The requirement *now* is architectural: after P3, "add a connector" must mean writing an adapter (a lens + capability mappings + sync policy entries), not redesigning Spectra. P8 includes a paper exercise validating this claim against the Google Docs case before the program closes.
