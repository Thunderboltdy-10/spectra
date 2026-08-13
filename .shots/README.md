# Spectra screenshot archive

This folder is a visual inventory of the Spectra product captured from the running app. Screenshots are grouped first by surface, then by product area, and finally by the distinct UI state shown.

## Naming convention

`<order>_<surface>_<area>_<state>.png`

- `order` is a zero-padded capture sequence within the archive (`001`, `002`, …).
- `surface` is `landing` for the public site or `app` for the authenticated product.
- `area` names the route or major interface (`dashboard`, `projects`, `artifact-editor`, `settings`, etc.).
- `state` describes the meaningful interaction/view state (`default`, `empty`, `with-content`, `right-panel`, `fullscreen`, `modal-*`, `menu-open`, `error`, and so on).

## Folder layout

```text
.shots/
  README.md
  landing/
    001_landing_home_*.png
    ...
  app/
    010_app_dashboard_*.png
    projects/
    artifacts/
    settings/
    ...
```

The root sequence is the recommended way to review the product in traversal order. Folder names are the recommended way to locate one surface or feature quickly.

## Coverage rules

- Each image must show a complete, inspectable interface state, not an accidental crop or a blank loading screen.
- Capture every distinct route, window, panel, dialog, menu, editor mode, artifact type, and fullscreen state that changes what an agent can diagnose.
- Do not duplicate an image for a tiny scroll or incidental visibility change when the same capture already communicates the state.
- Content-bearing states use small representative data or a short AI task when an empty state would hide the interface's behavior.
- `landing` is captured from Chrome tab C. All authenticated product surfaces are captured from Chrome tab P.

## Review notes

When adding or auditing a screenshot, record enough context in the filename to answer: where am I, what is open, what content is present, and which interaction state is being demonstrated? Use the browser viewport as captured; do not resize it unless a responsive interface itself is the subject.

## Archive notes

- `landing/090` through `landing/119` are the slow-scroll continuity pass from the top of the public page through end-of-page stability checks. `landing/120` through `landing/122` cover the public authentication/request-access surfaces.
- `app/artifacts/` includes content-bearing document, quiz, task, and agent states, plus the workspace index and inspector states for decks, presentations, sheets, code/visualisations, whiteboards, and timetables.
- Files under `app/routes/` preserve the visible result of legacy-route checks; the filename records the resolved route when Spectra redirected to an existing surface.
- Later sequence numbers are supplemental coverage captured after the initial traversal; use the folder and descriptive state before relying on numeric order.
