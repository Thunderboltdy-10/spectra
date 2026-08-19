# SPECTRA CANON — Nova edition

**Binding. Short on purpose. If any instruction anywhere conflicts with this document, this document wins. If you believe the canon itself is wrong, stop and ask Pablo — do not silently deviate.**

## 0. Relationship to the HQ canon

Decisions **D1–D23** in `docs/spectra-hq/CANON.md` remain fully binding and are incorporated here by reference, with these amendments:

- **D7 (amended).** Library and Workspace remain one navigation system and one session — and are now also **one organizational world**: the same node tree, viewed globally (Library) or scoped to a context (Workspace). One shell implementation is mandatory, not aspirational.
- **D17–D19 (unchanged but re-scoped).** The field, prism and landing must ultimately express the *Nova* product (files, replicas, AI plane), not the pre-Nova one. Owned by N11.
- **D20 (extended).** "Typing never waits" now explicitly includes native files and the Bridge: no keystroke, drag, or realtime broadcast ever waits on a local disk write, a native-format serialization, or a cloud replica commit.
- **D23 (extended by D31/D33 below).** The AI operating plane is now a primary product pillar with its own architecture doc, not a future note.

## 1. What Spectra is (updated)

Spectra is **one live surface where people and AI do real work together** — and that work no longer has to begin or end inside Spectra-owned cloud data. Users point Spectra at the files and folders they already own; the work appears, stays theirs, remains real files, can synchronize to Spectra Cloud exactly as much as they choose, and gains Spectra's collaboration, organization and AI on top. Spectra's own artifact system remains the primary editing experience; native formats are first-class citizens underneath it, never casualties of it.

First audience unchanged: schools (ManageBac-connected), releasable, trustworthy, no developer build on screen.

The defining experiences, in order:

1. **You can always work.** Instant local interaction, never blocked by sync, disk, AI, or collaborators.
2. **Your files remain yours.** Real files stay real files. Spectra never silently destroys, converts, or withholds what it does not understand.
3. **AI is a colleague in the whole product.** It edits work, organizes the Library, changes settings you approve, navigates visibly — under your authority, attributable, reversible where possible.
4. **Everything is connected and truthful.** Storage states, sync states, capabilities, counts: all real.
5. **The workspace feels alive.** Quiet by default, responsive when things happen.

## 2. New binding decisions (D24–D40)

### Identity, replicas and truth

- **D24. One logical work identity; replicas beneath it.** A piece of work is one identity that may have a browser/Yjs representation, a Spectra Cloud replica, and/or a local file replica. Changing storage strategy (adding/removing replicas) never creates a duplicate work item, never changes the work's ID, and never closes open surfaces. Local-only, cloud-only, both, and link-without-modifying are all legitimate configurations.
- **D25. The preservation law.** If Spectra does not understand something well enough to safely rewrite it, that thing must survive unrelated edits untouched. Native packages are mutated at the part/feature level; regenerating a whole native file from a lossy Spectra model is forbidden. A PPTX transition Spectra cannot play still exists after Spectra edits the slide's title.
- **D26. Sync states tell the truth or say nothing.** "Saved locally" means the bytes are verified on disk. "Synced" means replicas verifiably agree at a known revision. A failed local write may never be masked by a healthy browser state. Conflicts are shown precisely; last-write-wins on conflicting work is forbidden.
- **D27. Logical placement and physical location are independent.** Where work lives in Spectra's tree and where its file lives on disk are separate facts, coupled only when a mirroring policy explicitly couples them. Physical file operations happen only when policy says so, with the confirmation semantics of ARCHITECTURE-AI §4 when AI initiates them.
- **D28. External edits are transactions, not keystrokes.** A Word/Excel/PowerPoint save enters Spectra as one attributed semantic transaction reconciled at a revision boundary. Word and Spectra are never mutually exclusive. Spectra does not fake keystroke-level Office collaboration.

### Organization

- **D29. The Library is Spectra's filesystem.** One primary hierarchical visualization with real folders, drag/move/rename, and the behaviors of a serious file manager in Spectra's visual language. Ordinary files (PDFs, images, unknown types) exist in the Library as real resources without being faked into artifact JSON.
- **D30. Workspace has exactly two views: List and Board.** Canvas as an organization mode is removed. List reflects the workspace's real hierarchy; Board is the visual cross-hierarchy view (grouped by workspace at root, filterable/groupable inside one). Artifact type is a filter dimension, never a third navigation universe.
- **D31. Nothing is ever "Unplaced."** Work created in a workspace lands there; work AI can confidently classify lands in the right workspace; everything else lands in **General**. Threads participate in placement. The first AI run in a new conversation establishes placement.
- **D32. Nested workspaces stay independent.** A workspace shown inside another's hierarchy is an entry/shortcut; opening it enters its own context. Parents never recursively absorb children's contents or context.

### Commands and configuration

- **D33. One command registry is the product's and the AI's shared language.** Toolbar controls, menus, shortcuts, context menus, AI operations, permission checks, availability, and choreography targets all resolve through the same stable command identities. No duplicate "human path" and "AI path" for the same operation. No page-local AI shortcuts (reaffirms D23).
- **D34. One customizable command surface per artifact.** Small connected category tabs (General/Insert/…), contextual tabs for selected objects, per-command compact/medium density, optional expanded mode. User customization is an account-synced preference; the semantic command ID never changes when its visual position does. No ribbons cloned, no stacked toolbars, no second navbar.
- **D35. Preferences live with the account.** Settings and customizations sync via Convex with a device-level overlay. AI may change them only through the same settings actions humans use, under D37's confirmation rule.

### Compatibility and safety

- **D36. Compatibility profiles, preservation by default.** Existing native files open in a strict native-compatible profile: only operations representable safely in the backing format are enabled. Enhanced (Spectra features with defined native fallbacks) and Spectra-native profiles are explicit choices. Spectra never quietly converts someone's dissertation into a proprietary object.
- **D37. AI authority policy.** AI capability never exceeds the signed-in user's authority, Bridge grants, and provider scopes. By default: reversible content work proceeds under the established artifact model; navigation/read is free; **settings changes always ask**; destructive resource actions ask; real local-filesystem mutations (move/delete/overwrite originals, mount or sync-direction changes) ask. A permissive mode exists behind an explicit, well-explained opt-in; truly catastrophic account/security operations stay non-bypassable.
- **D38. Follow AI is single and consensual.** At most one AI is followed at a time; following may carry the viewport across routes smoothly. A non-followed AI never scrolls the user, changes their route, or steals focus — the Live Dock tells its story instead. Multiple AI actors coexist through the claims system.
- **D39. Storage locality ≠ processing locality.** Product language never implies "stored on this device" means "contents never leave this device" while cloud AI can read them. Privacy boundaries for local-only resources are explicit.

### Continuity

- **D40. Migrate, never reset.** Existing artifacts, placements, threads, history, embeds, permissions, settings and share links survive every Nova mission. Existing cloud work becomes the "cloud-only replica" case of the new model. Live surfaces update in place when identity-stable things change (extends D24): no remount, no lost scroll, no broken splits when work is renamed, moved, re-policied, or edited elsewhere.

## 3. How Spectra must feel (unchanged core, one addition)

Immediate. Calm. Honest. Alive, not busy. One product. **And now: trustworthy with other people's file formats** — a user who points Spectra at a decade of schoolwork must never regret it.
