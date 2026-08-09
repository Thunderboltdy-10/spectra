# CONTEXT C — Shell, Tokens, Calendar, Foundry

## 0. Enforced gates — DO NOT VIOLATE

Scripts in `package.json`: `check:design-tokens`, `check:copy`, `check:architecture`. Not run by `next build`; separate npm scripts.

### `scripts/check-design-tokens.mjs` — HARD FAILURES
1. `src/app/globals.css` must contain **exactly one** top-level `:root {` block (regex `^[ \t]*:root\s*\{`). `:root[data-theme="dark"] .foo` selectors are fine.
2. String `data-theme-palette` must not appear in globals.css.
3. Any `.ts`/`.tsx` under `src/` using `text-[Npx]` where **N < 11** → fail ("use text-micro").
4. Any `.css` under `src/` with `font-size: Npx` where **N < 11**, unless the line contains `spectra-token-allow`.
5. `--brand-primary:` declared more than **2** times in globals.css.

### WARNINGS ONLY (exit 0)
- `className="…#rrggbb…"` — 6-digit hex inside a **double-quoted `className` attribute** → `console.warn`.
- `text-[Npx]` where N ≥ 11 → not flagged.

**Raw hex is not actually blocked** except that narrow warn. Hex in `style={{}}`, template literals, `cn(...)` calls, or CSS is invisible to the checker. Existing code already ships raw hex (`app-shell.tsx` `workspacePalette`, globals.css shadows). Treat the warning as policy.

### Adding a token legally
1. Custom property inside the single canonical `:root` at `src/app/globals.css:4272–4421`.
2. Dark override inside `.dark { … }` at `:4423–4498`.
3. Tailwind utility → `@theme inline` at `:23–64` using v4 namespace prefixes (`--color-*`, `--text-*`, `--shadow-*`, `--radius-*`, `--ease-*`, `--animate-*`, `--font-*`).
4. Never re-declare `--brand-primary` outside those two blocks.

### `scripts/check-user-facing-copy.mjs` — HARD FAILURES
Scans only: `pages/{artifacts-shell,workspace-shell,timetable-page-shell}.tsx`, `components/layout/app-shell.tsx`, `src/app/layout.tsx`.
Banned there: `"Artifacts"`, `"Artifact details"`, `"New artifact"`, `"Search artifacts"`, `"Artifact type"`, `"Timetable"`/`"Timetable Items"`, `>Artifacts<`, `>Timetable<`, `No artifacts`, `Select multiple artifacts`. Approved vocabulary: **Library**, **Calendar**.
Landing files are NOT scanned — but `src/app/layout.tsx` is.

### `scripts/check-spectra-architecture.mjs` — HARD FAILURES
- Every `new CustomEvent("name")` / `new Event("name")` in `src/**` must appear in `docs/spectra-definitive/generated/baseline-inventory.json` → `customEvents`. Exempt: `events/legacy-window-bridge.ts`. **A new global custom event will fail unless you regenerate (`npm run inventory:spectra`).**
- `src/app/api/spectra/run/route.ts` must not exceed 11 embedded tool-definition `name:` literals.

---

## 1. Design tokens

Single source `src/app/globals.css` (18,220 lines). `:root` at **4272**, `.dark` at **4423**, `@theme inline` at **23**. Tailwind v4 via `@tailwindcss/postcss`; **no `tailwind.config.js`** — CSS-first theming.

### Colour tokens
| Category | Token | Light | Dark |
|---|---|---|---|
| surface | `--bg-primary` | `#fbfaf8` | `#121211` |
| | `--bg-secondary` | `#f6f4f0` | `#1a1a19` |
| | `--bg-tertiary` | `#efede8` | `#222221` |
| | `--bg-sidebar` | `#fcfbf9` | `#0e0e0d` |
| | `--bg-elevated` | `#fffefd` | `#1e1e24` |
| | `--bg-elevated-rgb` | `255, 254, 253` | `30, 30, 36` |
| | `--bg-hover` | `#f1efeb` | `#1c1d25` |
| | `--bg-overlay` | `rgba(12,18,28,.22)` | `rgba(0,0,0,.72)` |
| | `--bg-code` / `--bg-code-editor` | `#f2f0ec` / `#2a2a3c` | `#0a0a0c` / `#1e1e2e` |
| | `--bg-user-bubble` | `#f3efff` | `#1e2530` |
| paper | `--card-paper` | `#fffefd` | `#1e1e1d` |
| | `--card-paper-quiet` | `#faf9f6` | `#191918` |
| ink | `--text-primary` | `#211f1c` | `#eeebe7` |
| | `--text-secondary` | `#716d67` | `#b5afa8` |
| | `--text-tertiary` | `#9b9690` | `#817b74` |
| | `--text-placeholder` | `#aaa59e` | `#817b74` |
| | `--text-inverse` | `#f8fafc` | `#1a1816` |
| border | `--border-default` | `#e5e2dc` | `#33312e` |
| | `--border-subtle` | `#efede8` | `color-mix(… 72%, transparent)` |
| | `--border-strong` | `#d4d0c8` | `color-mix(…)` |
| | `--card-border` / `--card-border-soft` | `#e7e4de` / `#efede8` | `color-mix(#cfc1ac 22%/13%)` |
| violet | `--accent-violet`, `--brand-primary`, `--accent` | `#7b5cf5` | `#9a87ff` |
| cyan | `--accent-cyan`, `--status-info` | `#2e8fd4` | `#45bfff` |
| teal | *no teal token* → `--brand-accent` | `#159b76` | `#38d6a0` |
| | `--accent-mint` | `#159b76` | `color-mix(brand-accent 86%, #25bc89)` |
| green | `--success` | `#148f5d` | `#43d097` |
| amber | *no amber token* → `--accent-gold` | `#d89a28` | `#e5b24e` |
| | `--warning` | `#b67616` | `#f4ba54` |
| danger | `--danger` | `#d33a4a` | `#ff7f8a` |
| extra | `--accent-orange` | `#e8703c` | `color-mix(…)` |
| extra | `--accent-coral` | `#ef684f` | `color-mix(…)` |

Also: `--mode-document` `#159b76`, `--mode-quiz` `#7b5cf5`, `--presence-1..8` (`#7c3aed,#159b76,#2e8fd4,#d89a28,#ef684f,#8b5cf6,#0f766e,#c2410c`), `--ownership-human` (=cyan) / `--ownership-ai` (=brand), `--focus-ring-color`, `--focus-ring: 2px solid …`, `--selection-bg`, `--card-focus`, `--card-pinned`, `--sheet-column-header`, `--sheet-row-header`.
Gradients: `--gradient-brand: linear-gradient(132deg, var(--brand-primary) 0%, var(--brand-accent) 52%, #ff8751 100%)`, `--gradient-surface`.

**NOTE: the brief's target palette is essentially already the shipped one** (violet `#7b5cf5`, cyan `#2e8fd4`, teal `#159b76`, green `#148f5d`, amber, coral danger). Brief surfaces (`#F8F7F4` / `#FCFBF8` / `#F4F4F8` / `#171615` / `#74706B` / `#E7E2DA` / `#D8D1C8`) are marginally cooler/lighter than shipped (`#fbfaf8` / `#fffefd` / `#211f1c` / `#716d67` / `#e5e2dc` / `#d4d0c8`). **Use the shipped tokens — do not fork the palette.**

### Typography
`src/app/layout.tsx` loads **Manrope** → `--font-manrope` and **IBM Plex Mono** → `--font-plex-mono` (`next/font/google`).
`--font-sans: var(--font-manrope), ui-sans-serif, system-ui, sans-serif`; `--font-serif` and `--font-display` are **aliased to Manrope** (no real serif installed); `--font-mono: var(--font-plex-mono), ui-monospace, monospace`.

Scale (all have utilities + baked line-heights): `--text-micro` 11/1.35 · `--text-caption` 12/1.4 · `--text-ui` 13/1.45 · `--text-body` 14/1.55 · `--text-editor` 16/1.65 · `--text-title` 17/1.35 · `--text-display` 30/1.15. `body` = 15px/1.6/.01em (`:4517`).
**11px is the hard floor.** Landing hero exceeds `--text-display`; raw `text-[clamp(...)]` is legal (only sub-11px arbitrary sizes fail).

### Radii
`--radius-sm` 6 · `--radius-md` 8 · `--radius-lg` 12 · `--radius-xl` 16 · `--radius-container` 12 · `--radius-input` 10 · `--radius-pill` 999 · `--card-radius` 10 (→ `rounded-card`).

### Shadows
`--shadow-sm` `0 1px 2px rgba(41,34,27,.045)` · `--shadow-card` → `shadow-card` `0 8px 24px -20px rgba(41,34,27,.2)` · `--shadow-soft` → `shadow-soft` `0 18px 42px -30px rgba(41,34,27,.25)` · `--shadow-hover` → `shadow-hover` `0 20px 40px -28px rgba(7,20,35,.18)` · `--shadow-lg` two-layer · `--card-shadow`/`--card-shadow-hover` · `--glass-blur: blur(24px)`.

### Motion
`--motion-fast` 120ms · `--motion-base` 220ms · `--motion-slow` 360ms · `--ease-standard` `cubic-bezier(.22,1,.36,1)` → `ease-standard` · `--ease-out-expo` `cubic-bezier(.16,1,.3,1)` → `ease-out-expo` · `--ease-in-out` `cubic-bezier(.65,0,.35,1)`.
JS mirror `features/spectra/motion/tokens.ts` (seconds). Also `motion/grammar.ts`, `motion/motion-primitives.tsx`, `motion/motion-level.ts`.
**Runtime kill-switches already in CSS**: `html[data-spectra-motion="reduced"]` and `="none"` blanket-disable animations (globals.css:17880+). **Respect these.** 87 `@keyframes` already exist — check name collisions.

### Layout dimensions
`--header-height` 44px · `--sidebar-width` 240px · `--details-rail-width` 292px · `--composer-max-width` 880px.

### Utilities generated by `@theme inline`
`font-sans` `font-mono` · `text-micro…text-display` · `text-brand bg-brand border-brand` · `*-mint *-cyan *-violet *-gold *-orange *-coral *-danger *-success *-warning` · `shadow-soft shadow-card shadow-hover` · `rounded-card` · `ease-standard ease-out-expo` · `animate-surface-in` (`spectra-surface-in 420ms`) · `animate-fade-in` (`chat-fade-in 240ms`) · `grid-cols-14`, `grid-cols-24`.

---

## 2. Build constraints

| File | Constraint |
|---|---|
| `tsconfig.json` | `strict: true`, `target ES2017`, `moduleResolution bundler`, `isolatedModules`, `jsx react-jsx`. **Single alias `@/*` → `./src/*`.** |
| `eslint.config.mjs` | `eslint-config-next/core-web-vitals` + `/typescript`. `react-hooks/set-state-in-effect: off`; `@typescript-eslint/no-unused-vars` → warn with `^_` ignore. |
| `package.json` | `"lint": "eslint . --max-warnings=0"` — **warnings fail lint.** |
| `next.config.ts` | `transpilePackages: ["@lobehub/icons","@lobehub/ui","es-toolkit"]`; `serverExternalPackages: ["pdfjs-dist","@napi-rs/canvas","esbuild"]`; `turbopack.root` pinned; `images.remotePatterns` allows any https host. |
| headers | `X-Frame-Options: DENY` on `/(.*)`; `Permissions-Policy: camera=(), microphone=(self), geolocation=()` |

Rules that bite: `no-explicit-any` (error), `react-hooks/exhaustive-deps` (warn → fails), `@next/next/no-img-element`, `react/no-unescaped-entities`, `react-hooks/immutability` (PrismCanvas disables file-wide for R3F).
Runtime: Next **16.2.9**, React **19.2.3** (pinned exact), Turbopack.

---

## 3. Animation / 3D deps

| Package | Installed | Version |
|---|---|---|
| `framer-motion` | YES | `^12.38.0` |
| `motion` (renamed pkg) | **NO** — import from `framer-motion` | — |
| `three` | YES | `^0.182.0` (+ `@types/three`) |
| `@react-three/fiber` | YES | `^9.7.0` |
| `@react-three/drei` | YES | `^10.7.7` |
| `gsap` | **NO** | — |

Others: `lucide-react ^0.563.0`, `clsx` + `tailwind-merge` (`cn` in `@/lib/utils`), `class-variance-authority`, `sonner`, `kbar`, `recharts`, `d3`, `@xyflow/react`.

---

## 4. App shell

**Exactly one `<AppShell>`**: `src/components/layout/app-shell.tsx` (1,313 lines, `"use client"`).
```ts
type AppShellProps = { children: ReactNode; fullBleed?: boolean; noScroll?: boolean; contentClassName?: string }
```
Composition (`AppShell`, :1231): root `min-h-dvh bg-[var(--bg-primary)]` with `md:pl-[76px]` collapsed / `md:pl-[240px]` expanded → `<KeyboardShortcutsRegistrar>` → `<ShellNavigation/>` (sidebar, internal, **not exported**, :152) → `<main>` with optional 44px top rail `<header>` containing `#spectra-shell-tab-slot` (only on `/workspace*` and `/library*`; else a hidden div with same id) → `.spectra-global-stage` → `{children}` + `<RouteSidePanelHost/>` + `<ViewportContextPicker/>`.

Sidebar state: `localStorage["spectra:sidebar-collapsed"]` + window `CustomEvent("spectra:sidebar-layout", {detail:{collapsed}})`. Collapsed 76px, expanded 240px.

`ShellNavigation` internals: `usePathname`, `useSearchParams`, `useClerk().openUserProfile`, 12 `useState`s. Nav destinations:
```ts
const ordinaryDestinations = [
  { href: "/chat", label: "Chat", icon: MessageSquareText },
  { href: "/workspace", label: "Home", icon: LayoutGrid },
  { href: "/library", label: "Library", icon: LibraryBig },
  { href: "/calendar", label: "Calendar", icon: CalendarClock },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/school", label: "School", icon: School },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
] as const;
```
Plus conditional `/admin`, `/superadmin`. Helpers: `RailTooltip`, `ActiveRailMarker`, `workspaceIcon`, `workspaceColor`, `workspaceHref`, `workspacePalette`.

### Root layout & providers
- `src/app/layout.tsx` (74) — Manrope + IBM Plex Mono, `<ClerkProvider>` (skipped without key), skip-link, `#main-content`, `<Providers>`. Metadata title `"Spectra — The AI School Platform"`.
- `src/components/providers.tsx` — `GlobalErrorBoundary → ThemeProvider → (ConvexProviderWithClerk if key) → children + DynamicFavicon + GlobalSettingsDrawer + LocalComputeCacheController + CookieConsentManager + <Toaster>`.
- `src/components/theme-provider.tsx` → `ThemeProvider` + `useTheme`; dark mode = `.dark` class on root.
- Brand: `src/components/spectra-logo.tsx` → `SpectraLogo({size})` + `DynamicFavicon`; `src/components/spectra-mark.tsx`.

### Page shells (all `<AppShell fullBleed noScroll contentClassName="!p-0">`)
`/workspace` `WorkspaceShell` 6460 · `/library` `ArtifactsShell` 2992 · `/superadmin` 2694 · `/admin` 2579 · `/managebac` 2103 · `/memory` 1320 · `/agents` `AgentLibraryShell` 1203 · `/chat` `ChatShell` 936 · `/public/*` 594 · `/school` 358 · `/analytics` 295 · orphan `TimetablePageShell` 151 · `/calendar` `CalendarApplication` 369.
All route pages `export const dynamic = "force-dynamic"`.

---

## 5. Landing route — current state

| Path | Role |
|---|---|
| **`src/app/page.tsx`** | **The real landing entry.** Server component. If `hasClerkServerConfig()` and `auth().userId` → `redirect("/workspace" + querystring)`. Else `<LandingClient/>`. Own metadata (`"Spectra — Connected learning work"`). |
| `src/app/landing/page.tsx` | 5 lines — `redirect("/")`. Vestigial. |
| `src/app/landing/landing-client.tsx` | 228 lines composition root |

`LandingClient` order: `<Navbar>` (local, fixed, shadow at `scrollY>24`, links `#scenes #capabilities #agents #proof #pricing`, Sign in + Get started) → `<LandingNarrative/>` → `#capabilities` → `#agents` → `#proof` → inline `#pricing` wrapping `<PricingSection/>` → `<ContactSection/>` → inline closing CTA → `<footer>`.
Reveal: one `IntersectionObserver` over `[data-reveal]`, `.is-visible` after `data-delay` ms, threshold .1, `rootMargin: 0px 0px -40px 0px`, unobserve on first hit.

Section files: `sections/narrative.tsx` 383 · `capabilities.tsx` 107 · `agents.tsx` 97 · `proof.tsx` 113 · `contact.tsx` 194 (posts `/api/contact`) · `pricing-section.tsx` 167 · `demo/live-work-demo.tsx` 126 · `demo/real-surfaces.tsx` 238.
Prism files: see CONTEXT-A §3.

**Keep:** the `prism-stage` progressive-enhancement pattern, `heroState` ref-driven frame loop, reduced-motion freeze (`heroState.fixedTime = 12.6`).

---

## 6. Calendar / Plan / Timetable / Integrations

| Module | Path | Lines | Props | Verdict |
|---|---|---|---|---|
| `CalendarApplication` | `calendar/ui/calendar-application.tsx` | 369 | **none** | **HEAVY** |
| `CalendarItemPanel` | same :347, not exported | | `{item, timezone, onClose, onCommit}` | NEEDS-SPLIT |
| `CalendarComposer` | same :363, not exported | | `{timezone, onClose, onCreated}` | NEEDS-SPLIT |
| calendar `domain/model.ts` | | 200 | pure TS | **PROPS-READY** |
| calendar `domain/actions.ts` | | 81 | pure TS | **PROPS-READY** |
| `PlanStudio` | `components/plan-studio.tsx` | 1131 | `{mode, title, content, onChange, readOnly, onOpenArtifact?}` | **NEEDS-SPLIT** |
| plan `projections.ts` | | 732 | pure TS | **PROPS-READY** |
| plan `model.ts` | | 213 | pure TS | **PROPS-READY** |
| `TimetablePageShell` | `pages/timetable-page-shell.tsx` | 151 | none | HEAVY (orphan) |
| timetable `model.ts`/`io.ts` | | 1003/281 | pure TS | PROPS-READY (no UI consumers) |
| `CapabilityTruthBadge`, `capabilityStateLabel` | `integrations/status/capability-truth.tsx` | 133 | `{state: CapabilityState, className?}` | **PROPS-READY** |
| `SchoolSourceAdapter` + `assertSchoolAdapterContract` | `integrations/school/adapter.ts` | 117 | pure contract | server |
| `ManageBacSchoolSourceAdapter` | `integrations/school/managebac-adapter.ts` | 134 | class | server-only |
| `ManageBacIntegrationShell` | `pages/managebac-integration-shell.tsx` | 2103 | none | HEAVY |

`CalendarApplication` is HEAVY: zero props, 8 `useState`s (`anchor, overview, loading, refreshing, error, selected, composerOpen, visibleLayers: Set<CalendarLayerKey>`), `dragRef`, `useMemo` week derivation, module-local `calendarPost()` → `POST /api/spectra/calendar`, `spectraBus`, sonner. **Build a story-state view instead.**

`PlanStudio` is content-in/`onChange`-out (`normalizePlanContent(content)`), so a landing demo *can* feed a literal plan with a no-op `onChange` and `readOnly` — but it's 1131 lines with 11 `useState`s and a 60s `setInterval`.

Calendar vocabulary for copy: `CALENDAR_ITEM_KINDS`, `CALENDAR_LAYERS` keys `classes|deadlines|work|personal|tasks`; item kinds `official_event`→classes, `official_deadline`→deadlines, `scheduled_work_block`→work, `personal_event`→personal, else tasks.

---

## 7. Agent Foundry

| Module | Path | Lines | Verdict |
|---|---|---|---|
| `AgentFoundry` | `components/agent-foundry.tsx` | 1685 | **HEAVY** |
| `CompetenceLedger` | same :117, not exported | | NEEDS-SPLIT |
| `SectionEditor` | same :253, not exported | | NEEDS-SPLIT |
| `CompilerTrace` | same :545, not exported | | NEEDS-SPLIT |
| `AgentLibraryShell` | `pages/agent-library-shell.tsx` | 1203 | **HEAVY** |
| `AgentCard`, `LibrarySectionBlock`, `LibraryAvatar` | same, not exported | | NEEDS-SPLIT |
| `agents/foundry/*` (13 files) | | 4758 | **pure TS, PROPS-READY** |
| `blueprints/*` (6 files) | | 802 | pure registry, PROPS-READY |

```ts
// AgentFoundry props (:621)
{ artifactId; artifactTitle; mode: "split"|"tab"; artifacts: SpectraArtifact[];
  content: unknown; onChange: (content) => void; aiChangedPaths?: string[];
  readOnly?: boolean; canPublish?: boolean; onActiveRegionChange?: (regionId) => void }
```
Looks props-driven but **self-fetches on mount** regardless: `getSpectraAgentReleases(artifactId)`, and when `!readOnly` also `getSpectraAgentEvalRuns` + `getSpectraFoundryCompilerJob`. 15 `useState`s. Mirrors `content` into local state. Root class `spectra-agent-foundry is-${mode}` (+ `is-foundation`), styled at `globals.css:9865`.

### Adaptive-section logic — the good part, pure
`agents/foundry/sections.ts` (328) — framework-free state machine:
`FoundryState`, `createFoundryState()`, `addSection`, `answerSection`, `dismissSection`, `restoreSection`, `activeSections(state)`, `dismissedSections(state)`, `coveredFacets(state) → Set<FoundryFacet>`, `isEmptyValue(value)`; types `FoundrySectionKind`, `FoundrySectionOption`, `FoundryExamplePair`, `FoundrySectionValue`, `FoundrySection`, `FoundryHistoryEntry`; `FOUNDRY_FACETS` (:86).
`agents/foundry/adaptive.ts` (413) — `MissionArchetype`, `inferArchetypes(mission)`, `FacetPlan`, `planFacetWeights`, `nextFacetPlan`, `SufficiencyReport`, `assessSufficiency`.
Rest of `foundry/`: `mission.ts` 96, `evidence.ts` 496, `skills.ts` 367, `evaluation.ts` 658, `routing.ts` 337, `improvement.ts` 446, `runtime-package.ts` 433, `compiler.ts` 371, `foundry-document.ts` 487 (`normalizeFoundryContent`). All re-exported from `foundry/index.ts`. **All pure — safe to import for honest example data.**
`blueprints/registry.ts` 238 + `quiz.ts`, `planner-task.ts`, `flashcard-deck.ts`, `document.ts`.

---

## 8. Implications for the rebuild

1. **Route target is `src/app/page.tsx`.** Keep the signed-in `redirect("/workspace")` + `toQueryString` passthrough.
2. **Landing must not render `<AppShell>`** (Clerk, Convex, 12 subscriptions). Build the final-reveal shell from a story-state view.
3. **Do not import `CalendarApplication`, `AgentFoundry`, `AgentLibraryShell`, or any `pages/*-shell.tsx`.** Seed views from the pure domain modules so the content stays honest.
4. **Token discipline**: consume `var(--*)` or `@theme` utilities. New tokens → the one `:root` + `.dark` + `@theme inline`.
5. **Never emit `text-[10px]` or smaller.** `text-micro` (11px) is the floor.
6. **No new `new CustomEvent(...)` names** without regenerating the architecture baseline.
7. **`--max-warnings=0`**: clean `exhaustive-deps`, no unused vars (or `_` prefix), no `any`, use `next/image`.
8. `framer-motion@12`, `three@0.182`, `@react-three/fiber@9`, `@react-three/drei@10` available. **`gsap` and `motion` are NOT installed.**
9. Honour `html[data-spectra-motion="reduced"|"none"]` and `useReducedMotion()`.
10. `X-Frame-Options: DENY` global — no iframe embedding.
