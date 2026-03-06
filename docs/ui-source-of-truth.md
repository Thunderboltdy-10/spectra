# AI School UI Source Of Truth

Last updated: 2026-03-06
Derived from: `src/app/globals.css`, `src/app/layout.tsx`, `src/components/layout/app-shell.tsx`, `src/components/chat/chat-layout.tsx`, `src/components/chat/chat-sidebar.tsx`, `src/components/chat/chat-settings-drawer.tsx`, `src/components/ui/button.tsx`, `src/components/ui/input.tsx`, `src/components/ui/tabs.tsx`, `src/components/ui/right-panel-surface.ts`

## Purpose

This document records the current UI system as it exists in code. It is not an aspirational redesign brief. Future conversations should treat this as the baseline for palette, typography, spacing, panel treatment, motion, and navigation unless a deliberate redesign is requested.

## Product Visual Direction

- Overall tone: warm academic workspace, not cold enterprise SaaS
- Base theme: paper-like neutral surfaces with cyan and teal brand energy
- Light mode is the default presentation
- Dark mode exists, but keeps the same structure and component language
- Core visual identity mixes editorial typography with practical workspace chrome

## Typography

- Body font: `Manrope` via `--font-manrope`
- Display font: `Fraunces` via `--font-fraunces`
- Monospace: `IBM Plex Mono` via `--font-plex-mono`
- Default body size: `15px`
- Default body line-height: `1.6`
- Default letter-spacing: `0.01em`
- Display usage:
  - Section and page titles often use `font-display`
  - Stats and numerals may use Fraunces through `.stat-number`
- Product implication: retain the Manrope/Fraunces/Plex trio unless there is an explicit design migration

## Color System

### Light mode tokens

- `--brand-primary`: `#0e8ee8`
- `--brand-accent`: `#20b8b2`
- `--bg-primary`: `#f5f3ef`
- `--bg-secondary`: `#ede9e3`
- `--bg-tertiary`: `#e3ddd5`
- `--bg-sidebar`: `#f0ede7`
- `--bg-user-bubble`: `#e1f0ff`
- `--bg-elevated`: `#ffffff`
- `--bg-hover`: `#e8e3db`
- `--bg-code`: `#0f1724`
- `--text-primary`: `#1a1510`
- `--text-secondary`: `#6b5f52`
- `--text-tertiary`: `#9e9082`
- `--border-default`: `#ddd8cf`
- `--danger`: `#d33a4a`
- `--success`: `#148f5d`
- `--warning`: `#b67616`

### Dark mode tokens

- `--brand-primary`: `#45bfff`
- `--brand-accent`: `#38d6a0`
- `--bg-primary`: `#13111a`
- `--bg-secondary`: `#1e1b2b`
- `--bg-tertiary`: `#241f33`
- `--bg-sidebar`: `#17151f`
- `--bg-user-bubble`: `#1e2a3a`
- `--bg-elevated`: `#211e2e`
- `--bg-hover`: `#2a273a`
- `--bg-code`: `#0a0910`
- `--text-primary`: `#edf4ff`
- `--text-secondary`: `#a09598`
- `--text-tertiary`: `#6b6478`
- `--border-default`: `#342f46`
- `--danger`: `#ff7f8a`
- `--success`: `#43d097`
- `--warning`: `#f4ba54`

### Derived accents and gradients

- `--accent` and `--accent-cyan` resolve to brand primary
- Accent mixes:
  - `--accent-orange`
  - `--accent-coral`
  - `--accent-mint`
- Brand gradient:
  - `linear-gradient(132deg, var(--brand-primary) 0%, var(--brand-accent) 52%, #ff8751 100%)`
- Surface gradient:
  - light: bright glass-like white blend
  - dark: deeper violet-black blend

### Mode colors

- `tutor`: `#0e8ee8`
- `marker`: `#f59f0a`
- `exam`: `#e05137`
- `draft_coach`: `#ba4f26`
- `quiz`: `#158f72`
- `flashcard`: `#1f9fb2`
- `research`: `#0f6fa7`
- `explain`: `#ff6f45`
- `general`: `#637083`
- `image`: `#ec4899`

## Surfaces, Radius, Borders, Shadows

- Container radius: `18px`
- Input radius: `12px`
- Pill radius: `999px`
- Sidebar width token: `clamp(220px, 18vw, 280px)`
- Borders are thin and neutral, usually `1px solid var(--border-default)`
- Surface hierarchy:
  - app background uses `--bg-primary`
  - muted surfaces use `--bg-secondary`
  - elevated cards and drawers use `--bg-elevated`
- Shadow language:
  - `--shadow-soft`: large but diffused shell shadow
  - `--shadow-card`: modest card lift
  - `--shadow-hover`: slightly stronger hover emphasis

## Background Treatment

- The app does not use a flat background
- `body` uses two low-opacity radial gradients over the base background
- Dark mode keeps the same radial treatment with lower, moodier contrast
- This means new full-page screens should usually sit on the same atmospheric canvas instead of introducing unrelated backgrounds

## Layout Rules

- Shell is sidebar + main workspace
- Desktop sidebar:
  - expanded width matches `clamp(220px, 18vw, 280px)`
  - collapsed width is `64px`
- Main content:
  - `AppShell` pages default to `max-w-6xl`
  - chat workspace uses full-height split layout
- Mobile behavior:
  - sidebar becomes an overlay sheet
  - right-side utility panels collapse into floating sheet behavior

## Sidebar Pattern

- Sidebar background is `--bg-sidebar`
- Sidebar uses a hard border-right, not a detached floating rail
- Expanded sidebar still carries some decorative traits:
  - gradient org mark fallback
  - uppercase micro-labels like `studio`, `Navigation`, `Pinned`
  - thin activity progress bar using the brand gradient
- Navigation:
  - simple vertical links
  - active state uses left border plus soft cyan-tinted background
  - collapsed state uses icon-only buttons with a small active dot

## Core Component Patterns

### Buttons

- Shape: rounded input radius, not sharp rectangles
- Default button: filled accent background with inverse text
- Secondary button: muted surface + border
- Ghost button: low-chrome text action
- Destructive button: danger fill
- Buttons do not use heavy transforms by default

### Inputs

- Inputs use `--bg-primary`, not pure white
- Rounded corners follow `--radius-input`
- Focus treatment is border-color change, not large glow rings

### Tabs

- Tabs are pill-based
- Tab list uses border + muted background
- Active tab becomes elevated against the list background

### Cards

- Cards use elevated background, border, and rounded container radius
- Current primitive references `shadow-[var(--shadow-lg)]`, which does not match the declared tokens in `globals.css`
- Practical guidance: treat `--shadow-card` and `--shadow-soft` as the intended active shadow vocabulary

### Right Panels and Drawers

- Right panels share a common surface helper in `src/components/ui/right-panel-surface.ts`
- Surface mix:
  - softened border
  - blend of `--bg-primary` and `--bg-elevated`
- Motion:
  - docked desktop panels slide in from the right
  - compact/mobile panels rise from the bottom-right sheet position
- Current chat settings width:
  - docked max width `448px`
  - compact view uses rounded floating sheet

## Motion Rules

- Motion tokens:
  - fast `120ms`
  - base `220ms`
  - slow `360ms`
- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` or similar soft deceleration curves
- Common animation patterns:
  - fade-up for content reveal
  - card entrance with slight translate and scale
  - right-panel slide/settle entrance
  - subtle pulse for refreshed states
  - stream cursor blink
- Current app still uses some transform-based motion on hover and reveal

## Content Styling

- Chat markdown is generous and readable
- Headings inside responses are bold, compact, and slightly tightened
- Tables are fully bordered and zebra-striped on even rows
- Blockquotes use a cyan-tinted left rule on a muted background
- Code blocks use the dark code surface regardless of theme
- User bubbles use `--bg-user-bubble`

## Current Product Personality To Preserve

- Warm, scholarly, slightly polished
- More “study studio” than “admin console”
- Uses editorial accents, especially Fraunces, to avoid generic app chrome
- Keeps brand cyan present in routing, highlights, and active states

## Current Deviations Worth Knowing

- The repo-level `SKILL.md` pushes toward stricter, more “normal” UI with fewer gradients and less decorative copy
- The implemented app is more expressive than that guidance:
  - radial page backgrounds
  - gradient brand mark
  - uppercase micro-labels
  - pill tabs
  - animated panel entrances
- Future work should preserve consistency first, then normalize selectively rather than mixing two competing styles screen by screen

## Guardrails For Future UI Changes

- Reuse existing CSS variables before introducing new hardcoded colors
- Keep Manrope as the body default and Fraunces as the display accent unless a global typography pass is intended
- Match existing radii:
  - `18px` for containers
  - `12px` for inputs and most buttons
- Keep sidebar and right-panel behavior consistent with current shell patterns
- Prefer `--bg-primary`, `--bg-secondary`, and `--bg-elevated` for new surfaces
- Keep cyan/teal as the primary interaction signal
- If a redesign aims to align more closely with repo `SKILL.md`, do it as a coordinated system pass, not by changing isolated screens
