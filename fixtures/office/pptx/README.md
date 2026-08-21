# PPTX N5 corpus

`transition-law.pptx` is authored and saved by desktop Microsoft PowerPoint, then checked into this corpus as the validity authority. It contains a native title placeholder, a subtitle text object, and PowerPoint's Fade transition (including its `mc:AlternateContent` Choice/Fallback wrapper). The harness applies title, unrelated text, and add-object mutations without regenerating or overwriting this source, and compares the transition XML after every mutation. `animation-timing.pptx` is a real Open XML animation corpus fixture with `p:timing` trees, a transition, layouts, and media; it asserts that a title edit preserves an unsupported timing tree.

Additional Microsoft Open XML SDK corpus files provide feature-level preservation coverage:

- `masters-media-preservation.pptx`: masters, many layouts, theme, images and SmartArt/diagram parts.
- `media-preservation.pptx`: embedded WAV media and image relationships.
- `chart-notes-preservation.pptx`: chart, embedded workbook, notes slide/master and animation timing.
- `typical-preservation.pptx`: fifteen slides, notes, media and embedded OLE objects.

Each receives an unrelated title edit and must retain the named preserved parts structurally identical. Synthetic `@ariadng/office` decks may be used only for narrow unit tests, never as Office-validity evidence. The generated performance case contains 120 slides. Sections, custom shows, grouped-shape/connectors, explicit hyperlinks and unknown extensions remain deliberately unpromoted until real fixtures and assertions are added.
