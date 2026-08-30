export const body = `# Diagram guidance

- Build around information hierarchy, not decoration.
- Keep each diagram focused on one concept. Split dense diagrams into smaller linked views.
- Use semantic groups and stable ids so later edits can target regions safely.
- Prefer concise, human-readable labels and explicit directional connectors.
- Show causality and decision branches with short edge labels.
- Use consistent naming and group related nodes when the structure has clear modules.
- Keep node and edge density readable at default zoom.
- Never rely on color alone. Pair color with text, line style, or position.
- For Mermaid, validate syntax and choose left-to-right flow unless time order reads better vertically.
- For SVG, use viewBox scaling, title and description elements, and shared text styles.
- Preserve existing regions during edits instead of redrawing the whole diagram.
- Add a short reading guide when the visual needs interpretation.`;
