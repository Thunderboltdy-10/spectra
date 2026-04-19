# Spectra — Redesign Report

*v0.2 · after first iteration · markdown*

---

## 0 · Why this document exists

Spectra is not a canvas app. It's a student's **entire school-life operating system**, with the canvas as the surface. The canvas, zoom math, and data model are correct. What was breaking was the connective tissue — how you move, what you see at each scale, how AI meets the page, and whether you can actually *run your week* inside it.

This is my working diagnosis plus the direction V1 now takes. V2 is still pending.

---

## 1 · The hard truths about the original

1. **Zoom scaled glyphs, not information.** A bigger chip is still a chip. Tiers (glance / touch / deep-edit) never changed *kind*, only size.
2. **Navigation was invisible.** No map, no spatial memory. A student with 6 courses gets lost in 3 days.
3. **Deep Edit was a drawer.** Opening it replaced context. That's just a worse Notion.
4. **Quick Chat was a passive box.** No awareness of what's on screen. "Act on focused item" was the right instinct but went nowhere.
5. **Hub edges were unused real estate.** Four collapsible panels, no reason to ever open them.
6. **Trackpad was unusable.** Scroll didn't pan, `+`/`−` buttons are an insult on a touchpad.

---

## 2 · What we're actually trying to build

> A student wakes up Monday. They want to prep a Biology midterm (Thursday), finish a Calc problem set (Friday), revise an English essay draft (Monday next), cycle Spanish flashcards, and plan a three-day break around exams. **All of it, one tab.** Everything they need — notes, AI, timer, schedule, PDF, flashcards — is one gesture away. The spatial layout of their week is the same spatial layout as their canvas. Zooming out gives them a picture of their week no tab-based tool can give them.

Every decision downstream serves that wedge.

---

## 3 · Principles

| # | Principle | Implication |
|---|-----------|-------------|
| P-1 | **Zoom = detail, not size** | Font-size stays constant in screen pixels inside a tier. What changes is *what is rendered*. |
| P-2 | **The canvas never leaves** | Bloom happens in place. Non-focused items dim but stay in position. No drawer, no mode-switch. |
| P-3 | **Less box, more field** | Cards lose hard chrome. Typographic hierarchy and thin color rules do the work. Borders only for what you're touching. |
| P-4 | **Chat is spatially aware** | The command bar knows focus, selection, viewport. Suggestions mutate per context. Results land in-place with connector lines to their source. |
| P-5 | **Multi-select beats drag** | Lasso N items → they stack into a working tray. Original positions preserved. Operate as a group. |
| P-6 | **Navigation is always a map** | A persistent minimap with viewport lens. Hover to peek, click to fly. No forgetting where the essay went. |
| P-7 | **Trackpad-first** | Scroll = pan, pinch = zoom, keyboard cycles. No vertical-mouse-wheel assumptions. |
| P-8 | **AI is visible as it works** | When AI edits an item, the item glows. When it creates, a line traces from the command bar to the new item. Users *see* the system acting. |
| P-9 | **Ecosystem of tools on-demand** | Timer, planner, scratchpad, library are first-class widgets. Draggable. Can be summoned. Can be asked to participate. |
| P-10 | **Quick-start the whole day** | One prompt ("plan my exam week") spawns a multi-widget scaffold. The user edits the scaffold rather than building from nothing. |

---

## 4 · V1 — Frames

### 4.1 Navigation (fixed in v0.2)

- **Scroll = pan.** Works on trackpads without modifiers.
- **⌘/Ctrl-scroll = zoom toward cursor.** Pinch gestures map to the same.
- **Shift-scroll = horizontal pan** for mousewheel users.
- **Minimap lens** — drag to pan, **hover-teleport** with modifier (hold Shift), click a workspace to fly there.
- **Keyboard** — `Tab` / `Shift-Tab` cycles focus between items in reading order, with smooth pan. `[` / `]` jumps between workspaces. `+`/`−`/`0` zoom. `Space` blooms/collapses focused. `Esc` closes top-most modal surface. `⌘K` spotlight. `⌘1`–`⌘4` jump to workspace.
- **Right-click on canvas** opens a contextual create menu.
- **Flight feel** — zoom and pan tween with cubic-ease over 420ms for focus changes; no teleport jumps.

### 4.2 Semantic zoom

Three layers, but they *change content*, not size:

- **Glance (< 42%)** — title + kind glyph. Workspace titles appear large on the canvas itself.
- **Touch (42–92%)** — title + thin rule + preview + metadata + updated timestamp.
- **Bloom (Space or dbl-click on focused item)** — full editor in place. Non-bloomed items dim but remain spatially correct.

### 4.3 Multi-bloom · the "working set"

Biggest new idea. When an item is bloomed and you bloom another, **both stay open side-by-side**. Up to 3 items in a working set, laid out as a strip that grows from the original positions. Shared AI context across the set — the command bar shows "3 items in scope".

This replaces Deep Edit's replacement semantics. You can have the essay, the PDF you're citing from, and a discussion thread open simultaneously — all still anchored to the canvas.

### 4.4 Hub edges reborn as Hover-Peek widgets

The four original hubs come back, but reimagined:

- **Planner (left edge)** — week grid; drag items onto days; shows deadlines from schedule items.
- **Scratch (right edge)** — ephemeral notes you jot during study, not tied to a workspace.
- **Library (top edge)** — everything unplaced: imports, AI-generated artifacts, snippets.
- **Timeline (bottom edge, near tray)** — chronological view of recent activity.

Each is a **3px sliver** until you hover → it peeks (160px slide-in with blur). Click the pin icon to dock it permanently. Content in a docked hub can be dragged as a widget onto the canvas.

### 4.5 Widgets are first-class

- **Focus timer** — pomodoro with session log. Float it anywhere or dock to tray.
- **Stopwatch** — simple, dockable.
- **Quick notes** — a tiny sticky, right-click to create.
- **Countdown** — to deadlines from schedule items; clicking zooms to the relevant item.

Widgets have a drag handle, a collapse button, a pin-to-workspace button, and — critically — an **"Ask AI about this widget"** action.

### 4.6 View modes per workspace

A segmented toggle in the workspace breadcrumb area: **Canvas · Type · Topic · Timeline**.

- **Canvas** is the default spatial view.
- **Type** groups items by kind (all essays, all flashcards, all PSETs) with animated FLIP reflow.
- **Topic** groups by semantic cluster (`topicCluster` field). Cluster labels float above groups.
- **Timeline** lays items on a horizontal timeline by `updatedAt`, grouped by day.

Switching views is a 480ms cross-fade with positional interpolation so you see things *move* into their new place. Preserves the spatial metaphor even when "re-shuffling."

### 4.7 AI · from box to agent

- **Command bar** stays bottom-center but slim by default. Expands only when focused.
- **Context chips** above the input show what's in scope — focused item, selection count, active hub.
- **Suggestions mutate** per context and *breathe* (subtle 3s pulse).
- **Result islands** stack above the bar as answers stream in.
- **In-place edits glow** — when AI modifies an item, it flashes with a mint halo and a small "AI edit" chip appears. Undo in one click.
- **Connector trails** — when AI creates a new item, a faint line traces from the command bar to the new item's landing spot.
- **Quick-start prompts** on empty states:
  - "Plan my exam week"
  - "Start biology midterm prep"
  - "Build a study schedule around my deadlines"
  - "Cram session for tomorrow"
  - "Holiday planning — 3-day break"

Each quick-start spawns a **scaffold**: multiple widgets + seeded items + a starter plan, not a single note. The user edits the scaffold; AI nudges the rest.

### 4.8 Small things that matter

- Right-click anywhere → contextual create (new note, flashcards, thread, timer, sticky).
- Dragging an item onto the minimap's other-workspace tile **moves** it to that workspace.
- Dragging an item onto a docked hub **copies** it to the hub's list.
- Cmd-click an item in multi-bloom → promotes it to primary, others shrink to side-peek.
- Holding `Alt` while zoom-scrolling snaps to tier boundaries (42% / 70% / 95%).

---

## 5 · Ideas deferred (couldn't prototype without real AI)

These I think are right but need backend work:

- **Ambient presence.** When you open a workspace, AI silently prepares — summarizes any new reading, regenerates flashcards from new notes, pre-computes "what should I do first?" So when you arrive, answers are already waiting, not loading.
- **Spatial awareness during chat.** Voice mode should read what's visible. "Read me that paragraph" works because it knows what's on screen.
- **Study-buddy mode.** AI quizzes you through flashcards out loud; recognizes your speech; tracks confidence per card over sessions.
- **Cross-workspace synthesis.** "Tie my Biology and Spanish work together — any connections?" should actually find them (shared concepts, time pressures, similar deadlines).
- **Import-by-screenshot.** Paste a screenshot of a whiteboard or slide → AI creates flashcards / notes / problems from it.
- **Group sessions.** A workspace can be shared; each student's cursor is a different color; AI moderates discussion.
- **Spaced-repetition engine.** Flashcards feed a real FSRS / SM-2 scheduler; the Planner surfaces "10 cards due" each morning.
- **Voice-first quick-capture.** Hold a key, speak, → a widget appears with transcript + AI-generated structure.

---

## 6 · Open questions I still want your take on

- Is Space-to-bloom the right primary gesture, or should we reserve it for pan (which is the Figma convention)?
- Three items max in the working set, or more?
- Should the 4 edge hubs be toggleable (user chooses their favorites) or fixed?
- View-mode toggle — inline in the breadcrumb, or as a switcher in the tray?

---

*Next: V2 — Folio, built after V1 review.*
