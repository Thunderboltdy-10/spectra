# Spectra Live Perfection Campaign

**Purpose:** Directly test, repair and elevate the current Spectra application until it behaves and feels like a genuinely top-tier production product.

This is a **new live-testing campaign** for the post-transformation Spectra codebase.  
Do not treat the older acceptance campaign as the product specification. It is only historical inspiration for the idea of systematic live testing.

The authoritative context for this campaign is:

- `SPECTRA_DEFINITIVE_TRANSFORMATION_PLAN.md` — especially the parts describing the final intended behavior of the systems being tested.
- `docs/spectra-definitive/07_GOAL_CHECKLIST.md` — useful coverage inventory, but not proof that anything works.
- `docs/spectra-definitive/08_CODE_VERIFIED_AUDIT.md` — known gaps and suspicious areas to fix as they are encountered.
- `docs/spectra-landing/` — source of truth for the new Spectra visual identity introduced after the transformation plan, especially the **dot-field system** and the **new Spectra icon/prism identity**.
- `frontend-design` skill.
- `design-taste-frontend` skill.

The landing page itself is **out of scope**. It has been implemented separately.  
Do not spend campaign time testing or redesigning the landing page.

Mobile is also **out of scope** for this campaign. Focus on the desktop product and all of its narrow/tiled/side-panel states.

---

# 1. Core attitude

Do not begin with a long preflight, inventory, report, or documentation exercise.

**Start using Spectra almost immediately.**

Open the real app, interact with it like an extremely demanding user, and test the actual product.

When something is wrong:

1. understand it;
2. inspect the relevant code/state if necessary;
3. fix it;
4. continue testing.

Do not spend time proving that every old checklist entry exists before touching the UI. The application itself is now the primary test surface.

The existing verified audit is there so known problems are not forgotten, but this campaign must discover substantially more than the audit did.

Do not want each surface to have its own approaches for the same components/buttons. Think globally and standardise across multiple interfaces where possible.

---

# 2. Definition of quality

A feature is not successful because:

- the click handler fires;
- the request returns 200;
- the final screenshot looks acceptable;
- an old test passes;
- the checklist says complete;
- the feature eventually loads;
- there is technically a fallback.

Spectra is intended for real schools, teams and serious individual use.

The standard is:

## Functional excellence

- every visible control works;
- state is preserved correctly;
- no hidden data corruption;
- no confusing dead ends;
- no accidental duplicated behavior;
- permissions are real;
- saves never interfere with interaction;
- AI operations actually achieve what the UI says;
- collaboration converges;
- loading and failure states tell the truth.

## UX excellence

- the next action is obvious;
- advanced power is available without cluttering the default view;
- navigation feels natural;
- related controls are grouped;
- unrelated controls are visually distinct;
- the product never feels like several applications stitched together;
- side panels and tiles feel intentionally designed, not compressed desktop pages;
- users should not need to understand Spectra's architecture to use it.

## Visual excellence

- strong typography;
- deliberate spacing;
- clear hierarchy;
- excellent density;
- subtle but meaningful surfaces;
- no generic AI-dashboard aesthetic;
- no unnecessary cards-within-cards;
- no tiny gray text used merely to fit things;
- no random gradients, pills or glowing boxes;
- no duplicated rails;
- no awkward hard borders revealing squeezed layouts;
- no controls that all look equally important;
- no unconsidered empty/loading/error states.

## Motion excellence

- changes do not snap when they should transition;
- layout movement has continuity;
- AI actions feel physically connected to what they change;
- streaming/reveal effects are smooth;
- hover/focus/pressed/selected states transition coherently;
- opening, closing, resizing and transferring surfaces feels intentional;
- animations communicate cause/state rather than decorate;
- effects never make the app sluggish.

## Performance excellence

On the current secondary development computer, Spectra must remain comfortable to use.

Slow hardware is not an excuse for:

- multi-second UI reactions;
- repeated blank loading;
- frozen editors;
- heavy transitions;
- unnecessary remounts;
- duplicate fetches;
- huge synchronous serialization;
- main-thread local work that should be deferred or removed.

If an expensive effect or implementation hurts real use, simplify the implementation rather than accepting poor performance.

---

# 3. Visual identity introduced after the transformation plan

Two additions made after the main plan are now core Spectra identity:

## 3.1 Dot field

The dot-field system is a recurring environmental texture for Spectra.

Read `docs/spectra-landing/` before judging or changing it.

During the campaign, look for places where the dot field:

- should subtly connect a surface to the Spectra identity;
- is missing from a surface that should use it;
- is too visible and competes with content;
- causes contrast/readability issues;
- behaves inconsistently between related surfaces;
- causes unnecessary rendering cost;
- should react gently to important AI/collaboration activity.

It should feel like part of Spectra's visual atmosphere, not like a wallpaper pasted everywhere.

## 3.2 Spectra icon / prism identity

The new Spectra icon is another defining visual signature.

Audit the live application for:

- sidebar/product identity;
- AI presence;
- AI run states;
- loading/working states where appropriate;
- agent/product references;
- empty or branded states;
- other natural identity moments.

Do not mechanically put it everywhere. Use it where product identity or Spectra-as-an-actor is being communicated.

The icon must remain visually consistent in angle, proportions, surface treatment and sizing.

---

# 4. Profiles P and C

Use the two real Chrome profiles for multiplayer testing.

## Profile P

**Chrome account:** `pablo.martinez.dovale@gmail.com`  
**Spectra account:** `[school-account-email]`  
**ManageBac:** connected

This is the primary account for school-data testing.

## Profile C

**Chrome account:** `carlos.martinez.mozo@gmail.com`  
**Spectra account:** `pablo.martinez.dovale@gmail.com`

This is the second real Spectra user for collaboration, sharing and permission tests.

The Chrome identity and Spectra identity are intentionally different. Do not confuse them when attributing presence, AI ownership, comments, shares or permissions.

---

# 5. How to work through the campaign

This campaign has two major rounds.

## ROUND ONE — Explore, test and repair everything

Move through the entire application systematically.

For each feature/surface:

1. enter it in a realistic state;
2. exercise it thoroughly;
3. capture the important states;
4. inspect the screenshot(s) carefully once;
5. identify all functional, UX, visual, motion and performance problems visible from that pass;
6. fix them;
7. move forward.

Do **not** repeatedly screenshot the same corrected state after each tiny edit.

The goal of Round One is breadth plus depth: touch the complete product while improving aggressively.

A targeted immediate retest is appropriate when:

- the fix is uncertain;
- data integrity is involved;
- collaboration correctness is involved;
- permissions are involved;
- a shared foundation was changed;
- the app previously crashed or became stuck.

Otherwise, continue the campaign and let Round Two provide the full fresh verification.

## ROUND TWO — Full fresh verification

Only after the first complete campaign sweep:

- reset/reopen realistic states;
- repeat all core workflows from scratch;
- capture final visual evidence;
- run collaboration again;
- run AI × collaboration again;
- re-check performance;
- identify regressions introduced by fixes;
- repair anything remaining.

Round Two is where the product must finally prove itself.

---

# 6. Screenshot discipline

Screenshots are a major diagnostic tool, not just proof.

## 6.1 What to capture

For an ordinary interaction, useful captures include:

- stable starting state;
- hover/focus/menu-open state if meaningful;
- one or more important intermediate states;
- final state.

For AI/collaboration/motion work, intermediate states matter especially:

- title/summary streaming;
- Live Dock updates;
- required-input expansion;
- AI cursor movement;
- AI opening/selecting controls;
- human/AI wait state;
- human ownership state;
- drag/resize in progress;
- panel opening;
- side panel → fullscreen transition;
- reference expansion;
- reconnect/recovery;
- completion effects.

Do not create dozens of nearly identical images.

One good screenshot should be inspected deeply once.

## 6.2 What to look for in every screenshot

Even if the screenshot was taken for another purpose, inspect the whole visible application.

Ask:

- What feels unfinished?
- What feels generic?
- What looks crowded?
- What looks empty for no reason?
- Is anything misaligned?
- Are there visual discontinuities?
- Are there duplicate rails/toolbars?
- Is the hierarchy obvious?
- Are important controls buried?
- Are secondary controls too strong?
- Is any text too small?
- Is any text wrapping awkwardly?
- Do borders expose that a panel is being crushed?
- Do panels have realistic minimum widths?
- Is a work editor still useful in the space available?
- Are hover/focus/selected states beautiful and clear?
- Does the dot field help rather than distract?
- Is the Spectra icon used appropriately?
- Is the same interaction styled differently elsewhere?
- Is an animation halfway through ugly even though its final state looks fine?

If the screenshot reveals an unrelated weakness, fix it too or add it to the active queue.

---

# 7. Use more than screenshots

Screenshots cannot tell you everything.

When behavior is suspicious, use the browser tools to inspect:

- DOM/accessibility tree;
- bounding rectangles;
- overflow;
- computed style;
- console;
- network;
- performance trace;
- active animations;
- request timing;
- React/render behavior where observable.

Examples:

### A panel looks too narrow
Inspect actual geometry and container constraints rather than guessing from pixels.

### An AI edit looks correct
Check the actual underlying work state/history, not just the visible result.

### Collaboration appears synchronized
Compare the resulting data on P and C.

### Loading is slow
Inspect network/main-thread/render work rather than accepting a spinner.

### An animation appears to snap
Inspect the intermediate geometry/active animation and find the exact state transition.

---

# 8. Start with the core product shell

Begin actual live testing here. Do not spend hours on preliminary infrastructure work first.

## 8.1 Sidebar

Test:

- expanded;
- collapsed;
- switching states repeatedly;
- workspace items;
- active route;
- global search;
- account/settings area;
- long names;
- navigation while work is open.

Look especially for:

- layout movement;
- duplicate content;
- inconsistent icon sizing;
- weak active-state indication;
- tooltip quality;
- vertical jumps;
- tiny labels;
- icon/prism identity usage.

## 8.2 Library

Test:

- initial load;
- create work;
- unplaced work;
- placed work visibility behavior;
- received/shared work;
- searching;
- filtering;
- sorting;
- collections/favorites if present;
- multi-select;
- moving to Workspace;
- sharing;
- delete/archive;
- opening;
- tiling;
- Inspector;
- empty and dense states.

Library must not feel like Workspace with a different heading.

## 8.3 Workspace

Test:

- placement;
- organization;
- opening work;
- search/filter;
- multi-select;
- members/collaboration;
- sharing;
- references/sources/context if surfaced;
- pins;
- delete/archive/move;
- open work + thread combinations.

Workspace should feel contextual and focused on the chosen workspace.

## 8.4 Shared Library/Workspace rail and session

Test repeatedly switching between Library and Workspace while:

- one work is open;
- several work tabs are open;
- tiles are open;
- a thread is open;
- AI is running;
- Inspector is open.

State should persist naturally.

## 8.5 Multi-select / tiling

Test:

- two;
- three;
- four work items;
- add one;
- remove one;
- resize split;
- maximize one;
- restore;
- mix different work types;
- add auxiliary thread.

The layout should behave like an intelligent window manager.

No work should be squeezed into an unusable strip.

---

# 9. Quick Chat, Live Dock, `/chat` and right panel

These surfaces are central to Spectra and deserve disproportionate attention.

## 9.1 Quick Chat

Test:

- ordinary send;
- continue current thread default;
- explicit new thread;
- context picker;
- viewport context selection;
- file attach;
- multiple attachments;
- autocomplete;
- focused work edit;
- cross-work question;
- no work focused;
- several concurrent threads.

Check the composer in:

- full workspace;
- narrow panel;
- tile-heavy layouts;
- while Live Dock has several runs.

## 9.2 Live Dock

The intended behavior is deliberately simple:

### Idle
Shows:

- title;
- status;
- semantic step.

### Hover
Shows only the **important additional context** needed to understand the run.

Do not let hover become a small version of the right panel.

### Click
Immediately opens the full conversation/right panel.

### Required input
Questions, approvals, accept/reject or other time-sensitive actions may expand the tab automatically.

Test:

- one run;
- several runs;
- long title;
- long semantic summary;
- required input;
- attachments;
- completion;
- failure/recovery;
- hover while another tab is selected;
- route changes;
- click/open;
- closed run tab while process continues if supported.

The semantic summary must say something useful rather than repeating the title.

## 9.3 Streaming

Inspect:

- generated titles;
- run summaries;
- normal chat;
- right panel;
- document generation;
- presentation text;
- cards/questions;
- other AI-created text.

The animation should feel controlled and readable.

The display rate may be slower in work creation than the raw provider stream, but must never feel artificially sluggish.

## 9.4 Steering

While a run is active:

- give a small refinement;
- redirect the next step;
- materially change the goal;
- steer while a tool is running;
- steer while AI is waiting on collaboration.

It must affect the current durable run at the correct safe boundary.

## 9.5 Multiple active conversations

Start several.

Switch between:

- threads;
- routes;
- work tabs;
- Library/Workspace.

No run should stop merely because it is no longer selected.

---

# 10. Inspector, comments, history, references and sources

## 10.1 Overview

Test usefulness, not existence.

It should make sense of:

- description;
- placement/workspaces;
- collaborators/sharing;
- linked/embedded work;
- backlinks;
- sources/freshness where relevant;
- meaningful recent information.

## 10.2 Comments

Test:

- general comment;
- selection-anchored comment;
- reply;
- mention;
- resolve;
- re-open;
- edit surrounding content;
- click comment after layout/viewport changes.

Clicking must reveal the correct semantic target.

## 10.3 History

Create a real sequence:

- human edit;
- AI edit;
- collaborator edit;
- structural action;
- restore.

The story should be understandable and correctly attributed.

## 10.4 References

The user-facing model is simple:

- collapsed;
- expanded.

Test:

- same reference toggling states;
- resize expanded reference;
- live update;
- pinned version;
- missing permission;
- broken/deleted source;
- a specific section/range/slide/object;
- references in all intended host work types.

Do not make references feel like a separate mini-product.

## 10.5 Context picking

From Quick Chat:

- pick work/card/block from viewport;
- nested targets;
- cancel;
- multiple selected context items;
- change route while picker is active.

The highlight should make the exact selectable target obvious.

## 10.6 Sources

Test manual and AI-created citations in every surface that supports rich text or evidence.

Verify:

- citations render;
- click/hover works;
- references survive work conversion where intended;
- bibliography/source list is coherent;
- source provenance is real;
- no invented source links.

---

# 11. Every work type gets a deep product pass

Do not skim these.

For each work type, spend enough time to understand the interface, use the primary workflows, then probe edge states.

Common expectations:

- creation;
- realistic populated content;
- empty state;
- all meaningful controls;
- advanced controls;
- mode switching;
- keyboard flow;
- read-only;
- AI reading;
- AI editing;
- comments;
- history;
- reference/source behavior;
- side panel;
- tiles;
- dense content;
- loading/error state;
- collaboration later.

---

## 11.1 Document

Test deeply:

- writing;
- rich formatting;
- headings;
- lists;
- tasks;
- quotes;
- callouts;
- equations;
- links;
- images/media;
- tables;
- slash menu;
- selection toolbar;
- drag/gutter behavior;
- outline;
- find/replace;
- focus/read mode;
- comments;
- citations;
- references;
- autocomplete;
- AI streamed writing;
- long document.

Look for editor chrome duplication and awkward narrow layouts.

---

## 11.2 Flashcards

Test:

- Build;
- Browse;
- Study;
- Progress;
- sections;
- tags;
- reorder;
- duplicate/delete;
- card variants;
- image/occlusion if available;
- keyboard study flow;
- reveal/rating animation;
- personal study progress;
- shared read-only deck;
- AI additions/rewrites;
- source citations.

Study and editing should feel like distinct experiences.

---

## 11.3 Quiz

Test:

- Build;
- Preview;
- Practice/Attempt;
- Responses;
- Results;
- every supported question type;
- settings;
- timing;
- attempts;
- answer reveal rules;
- resume;
- read-only learner state;
- teacher/owner state;
- AI generation/editing;
- versioning.

The UI should adapt to what the user is currently doing rather than exposing authoring controls during an attempt.

---

## 11.4 Code

Test:

- Source;
- Preview;
- Split;
- file tree;
- create/rename/delete;
- JS/TS/React;
- Python;
- run/stop;
- diagnostics;
- error state;
- local build/runtime;
- sandbox;
- source references;
- AI edit;
- AI generation;
- compact panel;
- performance during rebuild.

Split view must stay genuinely useful, not merely show two cramped columns.

---

## 11.5 Presentation

Test:

- slide rail;
- create;
- reorder;
- duplicate/delete;
- text;
- shapes;
- media;
- charts;
- references;
- selection;
- move/resize;
- notes;
- citations;
- present;
- follow;
- 20+ slides;
- AI actions;
- compact/tiled layouts.

Aggressively inspect duplicate toolbars and menu density.

---

## 11.6 Sheets

Test:

- cell editing;
- formulas;
- formula bar;
- formatting;
- row/column operations;
- sort/filter;
- validation;
- named ranges;
- freeze;
- charts;
- resize/move charts **inside the sheet**;
- import;
- source/provenance;
- comments;
- AI cell/range actions;
- large data.

There should not be a separate bottom "graphs area" that makes charts feel detached from the sheet.

---

## 11.7 Board

Test:

- pan/zoom;
- select;
- text;
- sticky;
- shape;
- connector;
- frame;
- card;
- table;
- reference/embed;
- image;
- move/resize;
- grouping;
- arrangement;
- capture-reference;
- follow/presenter;
- large board.

Selection/gesture states need exceptional clarity.

---

## 11.8 Plan

Test:

- creation from Library/Workspace;
- List;
- Board;
- Timeline;
- tasks;
- milestones/goals;
- steps;
- dependencies;
- priority/status;
- assignees;
- dates;
- estimated work;
- scheduled work blocks;
- references;
- source-linked tasks;
- Calendar synchronization;
- AI scheduling/editing.

It should flex naturally without visibly hard-coding "school planner" concepts.

---

## 11.9 Agent

Test Agent as both a work type and a product flow.

Create multiple agents with different purposes.

The Foundry begins around:

1. what the agent should do, described in depth;
2. how it should feel to interact with.

After that, Spectra should adapt the process.

Test generated:

- text fields;
- choices;
- files;
- references;
- examples;
- evidence;
- permissions;
- evaluations;
- skills.

Test:

- remove a generated section;
- restore/history;
- manually ask the creator for more;
- Continue building;
- sufficiency stop;
- publish;
- evaluate;
- use;
- improve;
- release;
- rollback.

The interface should feel like Spectra is **building the agent with the user**, not walking through a hard-coded wizard.

---

# 12. Calendar, School, Settings, Agents pages and operational surfaces

## 12.1 Calendar

Remember: Calendar is a unique application surface, not a creatable work type.

Test:

- views;
- layers;
- classes;
- official deadlines;
- tasks;
- scheduled work blocks;
- personal events;
- dragging;
- resizing;
- unscheduled lane;
- Plan links;
- open work side panel;
- fullscreen transfer;
- AI adding/resizing work through human-like interaction.

Official deadlines must never move merely because a study block moves.

## 12.2 School / ManageBac

Profile P has ManageBac.

Test what the integration actually makes available:

- classes;
- current tasks/deadlines;
- timetable;
- resources;
- CAS;
- any other supported data.

Test:

- manual sync;
- freshness;
- partial failures;
- missing capability;
- stale data;
- source links.

A screen that simply says unavailable for most content is not acceptable if the backend can provide the information.

## 12.3 Settings

Go through every visible setting.

Change it and verify that the corresponding behavior changes in the real app.

Especially:

- Quick Chat behavior;
- continuation;
- Live Dock;
- auto-routing;
- autocomplete;
- collaboration;
- appearance;
- motion;
- text size/density;
- compute;
- notifications;
- accessibility;
- integrations.

An attractive setting with no runtime effect is worse than no setting.

## 12.4 Agents catalog

Test:

- Discover;
- Installed;
- Yours;
- Shared;
- install/add to Library;
- sharing;
- public agent details;
- opening an Agent;
- using one.

## 12.5 Admin / Superadmin / Analytics

These currently need serious attention.

Do not merely click through.

For each tab:

- understand what the metric/action claims to mean;
- verify it has real data;
- interact with it;
- inspect empty/unavailable states;
- test filters;
- test permissions;
- inspect tables/charts;
- improve layout/readability.

"Unavailable" everywhere is not a finished analytics product.

---

# 13. AI quality campaign

After work surfaces are understood, test Spectra AI across the product.

## 13.1 Ordinary conversation

Use a varied battery:

- factual;
- explanatory;
- analytical;
- equation-heavy;
- structured Markdown;
- multilingual;
- ambiguous;
- multi-turn;
- context-dependent.

Inspect both content and rendering.

## 13.2 Research

Test:

### Simple
One current question that should need a quick search.

### Verified
A question requiring several sources and cross-checking.

### Deep
A serious Extended Essay / research-style question.

Evaluate:

- query quality;
- number of searches;
- source diversity;
- authority;
- full-source use;
- citations;
- contradictory evidence;
- inline source interaction;
- final synthesis.

"PhD-level research" requires more than a long answer.

## 13.3 Attachments

Use real:

- PDF;
- image;
- DOCX;
- PPTX;
- XLSX;
- multiple files.

Test both correct parsing and what happens when something is hard to parse.

## 13.4 Create every work type with AI

Ask for genuinely useful output, not a toy fixture.

Open the result and judge it as though the AI were the product's main selling point.

## 13.5 Edit every work type with AI

Use:

- localized edits;
- structural edits;
- multi-step edits;
- direct manipulation;
- source-backed edits.

AI should preserve unrelated work.

## 13.6 Cross-work reasoning

Ask AI to combine:

- Document + Sheet;
- Document + Quiz;
- multiple workspace items;
- School data + Plan + Calendar;
- source research + existing work.

## 13.7 Questions/approvals

Exercise every interactive AI question style that exists.

It should appear in the right place and never create unnecessary full conversation UI.

## 13.8 Stop/retry

Interrupt the AI at different stages.

No stale effect, claim, pending work or false "running" state can remain.

## 13.9 Failure recovery

When possible, induce recoverable failures.

The user should see a calm continuation rather than raw infrastructure failure whenever Spectra can safely recover.

---

# 14. Collaboration — Profiles P and C

Now deeply test real multiplayer behavior.

Do not limit this to Documents.

## 14.1 Sharing

P → C:

- private;
- Read-only;
- Edit;
- revoke;
- downgrade while open;
- workspace access;
- public share if applicable.

Read-only must affect every editing path, including AI mutation.

## 14.2 Presence

Test:

- join;
- leave;
- switch targets;
- selection;
- refresh;
- idle;
- reconnect.

Presence should feel alive but never noisy.

## 14.3 Documents and Code: true merge

Both users type concurrently in:

- different areas;
- same paragraph/file around each other.

This should merge naturally.

## 14.4 Leased controls

Test both directions:

- dropdown;
- date/time picker;
- scalar setting;
- drag;
- resize;
- reorder where lease-based.

A second user must not accidentally collapse or reverse an active interaction.

## 14.5 Every work type

For:

- Document;
- Flashcards;
- Quiz;
- Code;
- Presentation;
- Sheets;
- Board;
- Plan;
- Agent;

perform at least:

- simultaneous edits to different targets;
- same-target contention appropriate to the type;
- one undo each;
- refresh;
- final convergence.

If a work type "collaborates" by constantly replacing a whole JSON document, it is not acceptable merely because the final state eventually matches.

## 14.6 Comments/references/history

Test collaborative edits around anchored objects.

They must follow the work.

## 14.7 Workspace multiplayer

P and C concurrently:

- create;
- place/move;
- open;
- pin;
- archive;
- delete;
- multi-select.

No stale cards or layout desynchronization.

## 14.8 Reconnect

Temporarily interrupt C.

After reconnect:

- local state is safe;
- remote state converges;
- no duplicate presence;
- no permanent reconnect badge.

---

# 15. AI × collaboration

This is one of Spectra's defining experiences.

Spend substantial time here.

## 15.1 P AI visible to C

P launches AI work in shared content.

C should see the AI as **P's Spectra**, not as a generic human and not as their own AI.

Repeat C → P.

## 15.2 Different targets

AI and human edit different targets at once.

Neither should unnecessarily block the other.

## 15.3 AI waits for human

C actively holds a target.

P asks AI to work there.

AI should:

- recognize the contention;
- show a calm waiting semantic step;
- remain alive;
- resume after C finishes;
- re-resolve the target;
- reconsider if the human changed the relevant content.

## 15.4 Human encounters AI ownership

While AI:

- chooses a dropdown;
- edits a scalar;
- drags/resizes;
- reorders;

the peer tries to interfere.

The conflicting action should be locally blocked without freezing the rest of the app.

## 15.5 Two AIs

P and C each run Spectra on the same shared work.

Test:

- different targets;
- overlapping targets;
- completion;
- attribution.

## 15.6 Steering while collaborating

Steer an AI that is:

- actively editing;
- waiting for another user;
- between tool calls.

It must continue coherently.

## 15.7 Permission change mid-run

Remove/downgrade access while a user's AI is working.

No forbidden write may land afterward.

## 15.8 Refresh/reconnect mid-run

The run should remain a durable fact independent of one browser tab.

---

# 16. Performance campaign throughout all of the above

Do not wait until the end to notice that everything is slow.

Whenever a surface or interaction feels sluggish, investigate immediately.

Focus especially on:

- initial Library load;
- Workspace load;
- opening work;
- switching tabs;
- mounting a side panel;
- work + thread combination;
- multi-tile layouts;
- Live Dock updates;
- rich streaming;
- Documents;
- Sheets;
- Presentations;
- Boards;
- presence;
- AI effects;
- dot field;
- icon animations;
- local autocomplete;
- code preview/build;
- school data;
- analytics.

Look for:

- redundant data requests;
- eager imports;
- editor remounts;
- giant client components;
- unnecessary state duplication;
- whole-work serialization;
- over-frequent projection;
- unnecessary React renders;
- layout thrashing;
- costly box-shadow/filter/backdrop effects;
- animation running while invisible;
- dot-field work where it is not visible;
- WebGL or canvas work outside relevant surfaces.

The app should feel immediate on the secondary computer.

---

# 17. Desktop stress states

No mobile testing is required.

Instead test the desktop product under the situations that currently expose weak responsive design:

- 1920×1080;
- 1366×768;
- narrow side panel;
- two tiles;
- three tiles;
- work + thread;
- work + thread + Inspector;
- several Live Dock tabs;
- long work title;
- long workspace title;
- many collaborators;
- dense comments;
- dense Library;
- very large work content.

The goal is not to support absurd sizes. The goal is for Spectra to choose a sane layout rather than rendering a broken one.

---

# 18. Frontend/design pass while testing

Always keep both design skills active:

- `frontend-design`;
- `design-taste-frontend`.

This is not a separate final reskin.

Whenever testing reveals that a surface is weak, redesign it enough to become excellent.

Prefer:

- better hierarchy;
- fewer stronger controls;
- contextual disclosure;
- proper spacing;
- meaningful motion;
- coherent iconography;
- better layouts;

over merely:

- adding gradients;
- adding shadows;
- making cards rounder;
- adding decorative animation.

Use shared primitives when the same design intention repeats.

Do not generalize so aggressively that every work type loses its purpose-built interface.

---

# 19. Round Two — final fresh retest

After Round One has covered and repaired the whole app, begin from the start again.

This time the objective is verification rather than exploration.

Repeat:

- shell;
- Library;
- Workspace;
- Workbench;
- Quick Chat;
- Live Dock;
- `/chat`;
- right panel;
- Inspector;
- references;
- comments;
- sources;
- every work type;
- Calendar;
- School;
- Settings;
- Agents;
- Admin;
- Superadmin;
- Analytics;
- AI;
- research;
- Profiles P/C collaboration;
- AI × collaboration;
- large/dense states;
- performance.

Do not test the landing page.

Capture final screenshots of each major surface and compare them side by side for product coherence.

Any regression reopens the owning area.

---

# 20. Final marathons

## 20.1 General project

Create a new workspace.

Research a serious topic, create:

- Document;
- Sheet;
- Presentation;
- Plan;

connect them with references, involve C, and use both human and AI collaboration.

## 20.2 School workflow

Using P's real ManageBac data:

- inspect current work;
- create/update Plan;
- schedule real work;
- open relevant school context;
- create study material;
- use Quiz/Flashcards;
- have AI reason over results.

## 20.3 Agent workflow

Create a specialist Agent from scratch, attach evidence, improve it, publish it, use it from both accounts and route to it automatically.

## 20.4 Collaboration stress

P + C + at least one AI:

- shared work;
- simultaneous edits;
- one lease conflict;
- one AI wait;
- one steer;
- one refresh;
- one permission change.

End with correct history and no stale presence.

## 20.5 Free-use session

Spend a substantial uninterrupted session simply using Spectra rather than following test steps.

Try to notice the things a checklist misses:

- hesitation;
- unnecessary clicks;
- confusing hierarchy;
- strange loading;
- ugly intermediate states;
- inconsistent animation;
- surprising routing;
- poor keyboard flow;
- awkward panel behavior;
- performance cliffs.

If something feels wrong, improve it.

---

# 21. Completion standard

The campaign is finished only when the final fresh Round Two and marathons show that:

- there are no known broken controls;
- no known critical audit issue remains;
- every major route feels intentionally designed;
- every work type is genuinely strong;
- Quick Chat and Live Dock feel effortless;
- the right panel and `/chat` remain excellent at their different widths;
- references, sources, comments and history feel native;
- AI reliably understands, edits and manipulates work;
- steering and recovery feel intelligent;
- human collaboration works across all relevant work types;
- AI × collaboration feels like a defining Spectra capability;
- Profile P and C attribution/permissions are correct;
- ManageBac is actually useful to P;
- Agent Foundry can build excellent real agents;
- Settings controls are not decorative;
- admin/superadmin/analytics surfaces are useful and truthful;
- no common desktop layout looks squeezed or accidental;
- dot-field and Spectra icon identity are integrated coherently throughout the product;
- motion is refined without hurting performance;
- the constrained secondary computer remains comfortable in normal use;
- screenshots of intermediate states are as considered as the final states;
- the final product is something you would be confident demonstrating live in a school.

Do not stop because there is "nothing obviously broken."  
There is always another level of clarity, cohesion, responsiveness or polish to inspect until the entire application survives the final fresh pass.
