# C-04 Document gutter alignment

**Date:** 2026-07-24  
**Grade:** pass (target: excellent after block-type matrix + scroll video)

## Repairs (this session)

- `drag-handle.ts`: on scroll (ProseMirror + nearest document scroll parent), reposition active gutter to block rect + first-line top instead of hiding.
- Existing logic: `firstLineTop`, horizontal `rect.left - CONTROL_WIDTH - GUTTER_GAP`, hidden `<768px`.

## Verification

- Split document **Collaboration Acceptance – Document C**: a11y exposes **Add block below** and **Drag block** beside editor content.
- List click opens split `ArtifactStudio` (supports gutter test surface).

## Not yet exercised

- Wrapped paragraph, H1, nested list, table row, callout, image, mid-document scroll hover fidelity.
