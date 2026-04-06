# Area: Wave 2 Interaction

## Assertions

### VAL-W2-001: Note Touch editing activates on single click

When a Note item is visible at Touch tier and the user single-clicks it, a cyan focus ring (2px solid, 2px offset) appears around the item and the cursor is placed inside the content area so that typing immediately modifies the note text. No panel opens. No additional click or mode-switch is required.

**PASS:** Focus ring visible, cursor active, next keystroke appends to note content inline.
**FAIL:** Panel slides open, focus ring absent, or a second click is required before text input is accepted.

Tool: agent-browser
Evidence: Screenshot showing cyan focus ring on Note after single click; subsequent keystrokes visible in note body without panel.

---

### VAL-W2-002: Note Touch editing is limited to basic formatting only

While a Note is focused at Touch tier, the available formatting controls are restricted to bold, italic, headings, and basic lists. No slash-command menu appears on `/` keystroke. No tables, embeds, or block-level slash commands are accessible.

**PASS:** Typing `/` produces a literal `/` character; toolbar (if shown) contains only bold/italic/heading/list controls.
**FAIL:** A slash-command popover appears, or an extended block-editor toolbar with tables/embeds is visible.

Tool: agent-browser
Evidence: Screen recording of `/` keystroke producing no command menu; toolbar inspection showing only basic formatting options.

---

### VAL-W2-003: Note Touch editing exits cleanly on Escape

While a Note is focused at Touch tier, pressing Escape removes the cyan focus ring and returns keyboard input to canvas navigation (pan/zoom). The note content reflects all edits made during the session.

**PASS:** Focus ring disappears after Escape; subsequent arrow-key or scroll input pans the canvas, not the note.
**FAIL:** Focus ring persists after Escape, or canvas navigation remains captured.

Tool: agent-browser
Evidence: Before/after screenshots of focus ring state; pan event fires after Escape.

---

### VAL-W2-004: Code Touch editing activates with syntax highlighting

When a Code item is visible at Touch tier and the user single-clicks it, a cyan focus ring appears and the code editor activates with syntax highlighting for the detected language. Basic text editing (add/delete/modify lines) is possible. No run button, terminal, or AI-suggest inline control is present.

**PASS:** Focus ring visible, syntax-highlighted code editor active, edits persist on click-away; no run/AI-suggest controls rendered.
**FAIL:** Panel opens instead of inline edit, syntax highlighting absent, or run button is visible within the node.

Tool: agent-browser
Evidence: Screenshot of inline code editor with syntax coloring and no execution controls.

---

### VAL-W2-005: Code Touch editing exits without execution tooling

While a Code item is focused at Touch tier, pressing Escape or clicking outside exits the editor without triggering code execution, output rendering, or AI suggestion flow.

**PASS:** Escape closes editor; no output panel, terminal, or suggestion popover opens.
**FAIL:** Code runs on editor blur, or an AI-suggest popover appears on Escape.

Tool: agent-browser
Evidence: Network log showing no execution request fired; screen shows clean exit to canvas navigation.

---

### VAL-W2-006: Focus ownership is exclusive — only one item focused at a time

Clicking a second item while a first item is already focused at Touch tier transfers the focus ring to the second item and removes it from the first. Keyboard input routes to the newly focused item.

**PASS:** First item loses focus ring immediately; second item gains focus ring; next keystroke modifies second item only.
**FAIL:** Both items show a focus ring simultaneously, or keyboard events reach the previously focused item.

Tool: agent-browser
Evidence: Screenshot showing single focus ring after clicking second item while first was active.

---

### VAL-W2-007: Escape hierarchy — nested focus escapes to item, then canvas

When a user is editing text inside a Note at Touch tier, pressing Escape once exits inline editing (removes text cursor, focus ring stays briefly then clears) and returns to canvas navigation. A second Escape press while in canvas navigation has no destructive effect (no workspace exit, no modal close).

**PASS:** First Escape exits editor; second Escape is a no-op at canvas level (or dismisses tooltip/overlay if one is open).
**FAIL:** First Escape exits the entire workspace, or two successive Escapes are required to exit inline editing.

Tool: agent-browser
Evidence: Annotated screen recording showing state transitions: editing → canvas-nav → no-op on second Escape.

---

### VAL-W2-008: Right-click on empty canvas shows creation menu

When the user right-clicks on an area of the canvas that contains no item, group, or hub element, a context menu appears with options: New note, New thread, New diagram, New code, New planner task, and Paste from clipboard (below a separator).

**PASS:** Context menu renders all listed items; clicking "New note" creates a Note item at the click position.
**FAIL:** Menu is absent, contains different items than specified, or "New note" does nothing.

Tool: agent-browser
Evidence: Screenshot of right-click menu on empty canvas; subsequent screenshot showing newly created Note node.

---

### VAL-W2-009: Right-click on an item shows item action menu

When the user right-clicks on any canvas item, a context menu appears with: Open in editor, Edit with AI…, Duplicate, (separator), Move to workspace…, (separator), Pin to top, Version history, Archive.

**PASS:** All nine entries present in the listed order; each clickable entry is not greyed out.
**FAIL:** Menu is missing entries, order differs from spec, or entries appear but are disabled/non-functional stubs.

Tool: agent-browser
Evidence: Screenshot of item context menu; DOM inspection confirming no entries are disabled.

---

### VAL-W2-010: Right-click on a group zone shows group action menu

When the user right-clicks inside a group's tint zone (not on a specific item), a context menu appears with: Add item to group, Rename group, Sort by…, (separator), Collapse group, Open all in editor, AI: Summarize group, Merge with….

**PASS:** All eight entries present; "Rename group" produces an inline text input; "Collapse group" collapses the group.
**FAIL:** Item-level menu appears instead of group menu, or fewer than eight entries are rendered.

Tool: agent-browser
Evidence: Screenshot of group context menu triggered from tint zone background; separate screenshot of rename flow.

---

### VAL-W2-011: Overflow group shows first 5 items and a "+N more" pill

When a group contains more than 6 items, the canvas renders the first 5 items and a "+N more" pill at the bottom of the group, where N equals the hidden count. Items 6+ are not rendered or accessible until the pill is clicked.

**PASS:** Exactly 5 items visible; pill reads "+N more" with the correct count; items beyond 5 are absent from the DOM.
**FAIL:** All items rendered regardless of count, pill is missing, or N is incorrect.

Tool: agent-browser
Evidence: Screenshot of group with 8 items showing "+3 more" pill; DOM item count = 5.

---

### VAL-W2-012: Overflow expansion is animated and does not trap content

Clicking the "+N more" pill expands the group with an animation, revealing all hidden items. Other groups on the canvas adjust their positions to accommodate the expanded group. After expansion, all items are reachable without a scroll trap or dead zone.

**PASS:** Animation plays; hidden items appear; adjacent groups shift; no scroll lock or trapped region visible.
**FAIL:** Items appear without animation, other groups overlap after expansion, or some items remain invisible/unreachable.

Tool: agent-browser
Evidence: Screen recording of expansion animation; post-expansion screenshot showing all items and no overlap.

---

### VAL-W2-013: Move-to-workspace flow changes item workspace assignment

From an item's right-click menu, choosing "Move to workspace…" opens a workspace picker with a search field. Selecting a destination workspace and confirming moves the item: it disappears from the current workspace and appears in the destination workspace.

**PASS:** Item absent from source workspace after move; item present in destination workspace; no duplicate exists.
**FAIL:** Item remains in source after confirmation, appears in both workspaces, or picker closes without performing the move.

Tool: agent-browser
Evidence: Before/after screenshots of source and destination workspaces; network response showing updated workspace assignment.

---

### VAL-W2-014: Move-to-workspace is undoable via Cmd+Z

After moving an item to a different workspace via the context menu flow, pressing Cmd+Z reverses the move: the item reappears in the original workspace and is removed from the destination.

**PASS:** Item returns to source workspace after Cmd+Z; destination workspace no longer shows the item.
**FAIL:** Cmd+Z has no effect, item remains in destination, or a duplicate appears.

Tool: agent-browser
Evidence: Screen recording showing move then Cmd+Z; final state matches pre-move workspace contents.

---

### VAL-W2-015: Cmd+K opens global command palette from anywhere

Pressing Cmd+K from any location — empty canvas, within an item editor, or while a context menu is open — opens the command palette overlay. Any open context menu is dismissed first.

**PASS:** Palette opens within one frame regardless of current focus state; context menu (if open) is closed before palette appears.
**FAIL:** Palette fails to open from within an item editor, or both context menu and palette are visible simultaneously.

Tool: agent-browser
Evidence: Screenshots of palette opening from three distinct UI states.

---

### VAL-W2-016: Cmd+K search returns cross-workspace results

Typing a query into the Cmd+K palette returns results from all workspaces, not just the currently visible one. Each result displays a workspace badge and a type icon.

**PASS:** Results include items from at least two workspaces; each result card shows workspace name badge and artifact type icon.
**FAIL:** Results scoped to current workspace only, or workspace badge is missing from result cards.

Tool: agent-browser
Evidence: Search result list screenshot with items from multiple workspaces highlighted.

---

### VAL-W2-017: Cmd+K with empty query shows commands, not search results

Opening the Cmd+K palette and submitting an empty query (or immediately after opening with no text entered) shows a list of quick commands ("New note", "New workspace", "Switch to…") rather than a blank results list or an error state.

**PASS:** Command suggestions visible with no query text; no "no results" message shown for empty input.
**FAIL:** Empty query produces a blank list, spinner, or error message.

Tool: agent-browser
Evidence: Screenshot of palette open with empty input showing command suggestions.

---

### VAL-W2-018: Cmd+K navigation pans and highlights target item

Selecting a result in the Cmd+K palette navigates the canvas: it pans and zooms to the workspace containing the target item, and the target item is visually highlighted (focus ring or transient highlight pulse).

**PASS:** Canvas viewport transitions to target workspace; target item shows highlight immediately after navigation.
**FAIL:** Palette closes but canvas does not move, or target item is not distinguishable from surrounding items after navigation.

Tool: agent-browser
Evidence: Screen recording of result selection → canvas pan/zoom → highlighted target item in destination workspace.
