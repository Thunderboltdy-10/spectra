# Spectra Card System Language And Implementation Map

Generated after the card-improvement follow-up pass.

## Final Card Language

Spectra cards use a refined warm-paper language: ivory surfaces, thin warm borders, low shadows, clear hierarchy, and a faint bottom-right arc/noise/tile texture. The texture should read like worn material or missing paint, not like a decorative gradient or subject-specific illustration.

Cards should feel related across the product without becoming identical. The shared family comes from the same paper surface, border logic, texture placement, accent token usage, and borderless icon actions. Variation comes from texture opacity, accent color, elevation, density, and state treatment.

## Variants

- `artifact`: default artifact/list card language. Balanced paper surface, icon accent, tags, timestamp, and quiet actions.
- `inbox`: calmer unplaced-object surface. Lower contrast, quieter icons, softer texture.
- `workspace`: larger workspace cards with more visible bottom-right texture and summary metadata.
- `board`: dense kanban cards and board columns. Smaller radius, lower shadow, fast scanning.
- `pinned`: warm elevated card treatment with amber edge, star/pin cue, and subtle warm texture.
- `timeline`: stronger hierarchy for artifact, edit, run, thread, system, and important activity cards.
- `canvas`: spatial object cards/clusters. Same material, slightly stronger elevation, cluster-aware accent.
- `result`: compact run/thread/result/confirmation/chat runtime cards.
- `side`: small panels, side cards, option cards, and embedded controls.

## State Treatments

- `normal`: warm paper, soft border, subtle texture.
- `hover`: minor lift, warmer border, texture shifts slightly.
- `selected` / `focused`: green focus border, subtle active dot, stronger but restrained shadow.
- `context`: focus border plus small context dot for selected-context use.
- `pinned`: amber accent, warm inset edge, star/pin affordance.
- `continued`: violet/cyan active-thread edge with slow texture drift.
- `creating` / `updating`: cyan border plus low-opacity scan shimmer and drifting texture.
- `edited`: accent-driven edit trace for AI-modified or recently changed surfaces.
- `confirmation`: warm warning accent, used for review/confirm flows and clarification pickers.
- `failed`: red accent, restrained error paper instead of loud alert blocks.
- `disabled` / `archived`: desaturated, lower opacity, no shadow.

## Texture Rules

Use the shared `data-spectra-card` / `.spectra-card` treatment for any reusable card. Do not create new gradient backgrounds for individual subjects or content types. The bottom-right arc/noise texture should stay faint, clipped, and accent-driven. Increase texture opacity for workspace/timeline/pinned cards; reduce it for inbox/result cards.

## Action Rules

Small actions such as open, pin, unpin, retry, close, delete, accept, reject, add, more, settings, and header utilities should generally use `.spectra-icon-action` or `.spectra-header-action`. The card surface provides structure; actions should be borderless, icon-led, and tooltip/title accessible.

Text buttons remain appropriate for primary commands, destructive confirmations, and actions where the label is necessary for comprehension.

## Implementation Map

- Global tokens, variant styles, state styles, texture, skeletons, tabs, header actions, chat rows: `src/app/globals.css`
- Reusable Spectra card primitives: `src/features/spectra/components/card-system.tsx`
- Artifact/workspace/board/canvas/timeline usage: `src/features/spectra/components/*` and `src/features/spectra/pages/*`
- Shared tabs: `src/components/ui/tabs.tsx`
- Chat quick composer and attachment surface: `src/components/shared/quick-chat.tsx`
- Chat header actions and stream status: `src/components/chat/chat-header.tsx`
- Chat sidebar conversation rows and pinned rows: `src/components/chat/chat-sidebar.tsx`
- Runtime/run/result cards: `src/components/chat/ai-runtime-components.tsx`
- Clarification and choice pickers: `src/components/chat/clarification-card.tsx`
- Streaming/structured generation skeletons: `src/components/chat/chat-messages.tsx`
- Generic loading states: `src/components/loading-states.tsx`

Future waves should start from `SpectraCard`, `CardTypeIcon`, `IconAction`, `data-spectra-card`, `.spectra-icon-action`, `.spectra-header-action`, `.spectra-tabs-*`, `.spectra-chat-row`, and `.spectra-skeleton-*` before creating any new card-specific CSS.
