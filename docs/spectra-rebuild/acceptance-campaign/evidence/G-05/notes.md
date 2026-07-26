# G-05 AI across artifact types

Date: 2026-07-26. Status: pass; broader browser matrix remains.

## Central protocol coverage

`artifact-live-preview.test.ts` now exercises the same preview/patch contract
for all ten first-class shapes:

- document block;
- flashcard;
- quiz question;
- planner dropdown;
- agent field;
- timetable event;
- presentation slide;
- sheet cell;
- code file;
- whiteboard node.

String fields stream through bounded awareness frames. Enums/dropdowns and
structural additions remain atomic. Stable identity/type fields never stream.
Word replacements select complete tokens before typing, avoiding fragments
such as `ining` or `interping`.

## Presentation browser workflow

Profile P opened `Enzyme Inhibitors — Presentation` and asked its AI to change
only slide 1's title from `Enzyme Inhibitors` to
`Enzyme Inhibition Explained`.

Observed:

- named `P MD's AI` presence on an unshared artifact;
- native paths `/slides/0/title` and
  `/slides/0/objects/0/content/text`;
- three coordinated native regions: slide thumbnail, canvas title object, and
  the corresponding `Slide text` control;
- cursor moved from preparation to the thumbnail/title object;
- title streamed through readable partial states and settled once;
- no studio-wide wash or refresh;
- all AI presence/regions cleared and the presentation returned to
  `Saved` / `Auto-saved`; no failure.

The two profiles are members of different schools. The share dialog correctly
allows only school members, so a new cross-profile presentation share was not
created and the membership boundary was not bypassed.

Evidence:

- `presentation-ai-native-trace.png`
- `presentation-ai-stream-partial.png`
- `presentation-ai-clean-final.png`

Grade is Pass, not Excellent: all ten types have centralized contract coverage,
but the remaining non-document editors still require individual browser
workflows, and cross-profile testing requires fixtures already shared within an
authorized school boundary.

## Sheet, quiz, planner, and code browser workflows

Fresh P-profile runs verified the centralized behavior in four more native
editors:

- **Sheet B7:** `/sheets/0/cells/B7/value` streamed in-place over about 2.6 s.
  The AI cursor moved across B7, the cell used a restrained blue trace, and the
  final value remained durable with a clean teardown. A prior B6 run exposed a
  nested-cell canonicalization bug that blanked the cell; nested value paths
  now remain scalar and the regression is covered.
- **Quiz question 1:** the explanation textarea streamed in place with
  `P MD's AI`, exact question/field traces, cursor movement, and clean
  completion. The shared interpolator now delays punctuation-only suffixes
  until the sentence is complete, avoiding fragments such as `accelerat.`.
- **Planner status:** the Status combobox changed atomically from Todo to In
  progress. AI presence and cursor landed on the dropdown, and the subtle
  field trace cleared after completion.
- **Code:** a requested `index.html` heading change reached CodeMirror and
  completed correctly, but the initial preview briefly collapsed most source
  because the returned full-file string differed too broadly for character
  interpolation. The protocol now streams long source bodies only when edge
  retention proves the edit is localized; broad rewrites settle atomically.

The stream cadence is now 140 ms. Artifact Studio also reveals an off-screen
native AI region for an idle viewer, while suppressing that movement for 1.8 s
after manual pointer, keyboard, wheel, or touch interaction.

Additional evidence:

- `sheet-b7-native-trace.png`
- `sheet-b7-stream-partial.png`
- `sheet-b7-clean-final.png`
- `quiz-ai-native-trace.png`
- `quiz-ai-stream-partial.png`
- `quiz-ai-clean-final.png`
- `planner-dropdown-ai-trace.png`
- `planner-dropdown-clean-final.png`
- `code-ai-broad-preview-defect.png`
- `code-ai-clean-final.png`

### Repaired Code rerun

A fresh `index.html` h1-only edit proved the repaired source path at 300–500 ms
sampling:

- CodeMirror remained at 22 lines through every captured frame; no source
  collapse, blank editor, or file-level refresh occurred.
- The h1 streamed through readable partials and settled once.
- The AI's planned `code_line` region is now folded into the centralized
  highlight-path resolver. CodeMirror materializes that semantic path as a
  native line decoration (`data-ai-code-line="17"`), so both the restrained
  trace and `P MD's AI` cursor physically land on line 17 rather than hovering
  near the top of the editor.
- Presence appeared at 13.2 s, source streaming ran from roughly 14.1–15.0 s,
  the durable-settle trace stayed continuous, and every region/presence marker
  cleared by 18.3 s. There was no second pulse or catch-up replay.

Evidence:

- `code-ai-exact-line-trace.png`
- `code-ai-exact-line-clean-final.png`

The Code sub-run is Excellent. Overall status remains Pass pending the
whiteboard/deck/timetable/agent browser runs and the
open/close/reconnect/permission combinations.

### Whiteboard native-card repair and rerun

The first Whiteboard run exposed that AI-created rich cards stored
`content.header` / `content.body` and content-local visual tokens, while the
editor rendered only generic `text` / `title` / `label`. This made four
information-rich inhibitor cards appear as blank white rectangles. The
Whiteboard editor now renders first-class editable card headers and bodies,
honours content-local fill/stroke/text/font alignment tokens, and exposes the
same fields to manual editing, AI context, patch resolution, export, and
accessibility.

The AI-region marker also moved from a zero-size wrapper onto the actual
positioned board node. This lets the shared cursor resolver anchor without
Whiteboard-specific coordinates. A fresh Competitive-card body edit proved:

- two visible `P MD's AI` instances (presence pill plus floating cursor);
- the cursor and low-opacity trace physically inside the edited card;
- readable word streaming in the native body field;
- every other card, connector, position, and style preserved;
- clean teardown with zero regions/presence by 16.2 s.

The shared interpolator now supplies a temporary visual separator when a new
word streams before a preserved word suffix, eliminating intermediate
`dwith` / `directlywith` joins. The focused preview suite is 16/16 green.

Evidence:

- `whiteboard-rich-card-rendering.png`
- `whiteboard-card-ai-native-trace.png`
- `whiteboard-card-ai-clean-final.png`

The Whiteboard AI-native sub-run is Excellent.

### Flashcard-deck rerun

Card 1's Back answer was edited surgically through
`/cards/0/back`. The first run exposed parent+leaf over-highlighting (seven
regions) because the semantic card region and exact field preview were both
retained. The centralized resolver now removes any broad path when a deeper
live target is available. A fresh rerun showed only the answer textarea plus
its card-list representation (two intentional surfaces), with the named
floating cursor physically on the answer line.

The answer streamed in place, Front/hint/tags/other cards remained unchanged,
and both regions cleared by 15.3 s with no second pulse.

Evidence:

- `deck-card-back-ai-trace.png`
- `deck-card-back-ai-clean-final.png`

The Flashcard AI-native sub-run is Excellent.

### Timetable verification repair and rerun

The first timetable add durably created and rendered its event, but the run
falsely reported a partial failure. The shared patch verifier had only allowed
normalize-added defaults for `/-` appends; a valid first-item write at
`/events/0` was compared exactly after timetable normalization canonicalized
its dates, layer, id, status, and availability. Numeric array-object writes now
use the same authored-field subset verification, ISO strings compare by
instant, and timetable events are verified after the same shared-content
normalization used on save. Focused patch-verification coverage is 8/8 green.

The live timetable editor also now:

- follows the exact AI-targeted event when it is outside the current week;
- computes Upcoming from the calendar rather than the current viewport;
- keeps the owner-named AI presence immediate when a very short preview beats
  the separate awareness connection;
- streams and traces the exact event card, with no page wash or refresh.

A fresh add completed truthfully. Two subsequent surgical title edits proved
the repaired interaction at the native event card. The final run showed
`P MD's AI` in the presence pill and a floating cursor directly on the 10:00
event while its title streamed through a readable partial; the exact card
pulsed at low opacity, the editor automatically displayed 27 July–2 August,
and all presence/regions cleared after one durable completion. The final title
remained present, with no new error or warning beyond Clerk's development-key
notice.

Evidence:

- `timetable-durable-edit-false-failure-recovery.png`
- `timetable-ai-rerun-4s.png`
- `timetable-title-edit-2.3s.png`
- `timetable-human-stream-named-ai.png`
- `timetable-human-stream-clean-final.png`

The Timetable AI-native sub-run is Excellent. Overall G-05 remains Pass
pending the Agent editor browser run and combined lifecycle/collaboration
variants.
