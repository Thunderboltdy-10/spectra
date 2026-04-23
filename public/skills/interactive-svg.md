# Interactive SVG Creation

- Build SVG with semantic groups (`<g>`) and stable ids for future edits.
- Use viewBox-driven scaling so diagrams remain readable on mobile and desktop.
- Prefer explicit labels and legends over color-only encoding.
- Keep animated interactions subtle and informative, not decorative.
- Ensure enough contrast for annotations and axis text.
- Keep text styles in a shared `<style>` block instead of repeating inline attributes.
- Expose simple interaction hooks (`data-node`, `data-edge`) so future edits can target elements safely.
- Preserve whitespace and indentation so the SVG remains hand-editable.
- Add title/desc accessibility tags for screen-reader compatibility.
- If interactivity is requested, include minimal vanilla JS and avoid external dependencies.
