# B-06 Workspace artifact opening restored

Date: 2026-07-24

## Code
- Workspace opens default to `openSplit`
- Studio renders for both split and tab presentations

## Chrome verification (Tab P, 1920×1080)
- From Workspace Home list, opened **Collaboration Acceptance – Document C**
- Artifact Studio opened as complementary **split** beside Mission Control
- Document editor visible (toolbar, content, Saved)
- Controls present: Share, Comments, Embedded artifacts, Open details, **Open as tab**, Version history, Close
- No dead-end (`studio.isOpen` with empty surface)

## Grade
**Pass** — split-by-default works; expand/return still needs fuller multi-view battery (List/Board/Timeline/Canvas) for Excellent.
