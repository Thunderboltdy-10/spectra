# ARCHITECTURE — THE COMMAND SYSTEM

Durable reasoning for N2, consumed by N7 (editor depth) and N8 (AI plane). Evolves the existing `ArtifactWorkbar` + `StudioContract` + manifest-operations stack into one command registry that is simultaneously the human UI's and the AI's language (CANON D33/D34).

---

## 1. What exists and what converges

Today: one shared `ArtifactWorkbar` (priority-based shedding, `⋯` overflow) consumed by all 9 creatable studios; `useStudioContract` (capabilities, modes, density); manifest `operations` (AI semantic op name lists); `spectraToolRegistry` (typed AI tools); `spectraBus` commands for navigation/settings; per-studio ad-hoc `WorkbarActionSpec`s with local string ids. Convergence: **one `commands/` registry** becomes the source; `ArtifactWorkbar` becomes its renderer; studio ad-hoc specs migrate into registered commands; `blueprints/*` remnants and `artifact-card.tsx` blueprintMeta divergence get folded/deleted in the same mission (inherits M4-E10).

## 2. The command record

```
Command {
  id: string,                        // stable forever, namespaced: "document.insert.equation",
                                     // "sheets.format.cellColor", "app.library.newFolder"
  domain: "artifact:<type>" | "app:<surface>",
  title, icon, description,          // human face (renameable by the user; id never changes)
  params?: ZodSchema,                // typed arguments
  execute: semantic implementation   // exactly one — the same code path for human and AI
           (artifact commands resolve through the existing typed-operation/Yjs layer;
            app commands through Convex mutations / existing product actions),
  availability: (ctx) => enabled | disabled(reason) | hidden,
                                     // ctx: capabilities (workCan), compatibility profile,
                                     // fidelity map, selection, permissions
  presentation: {                    // per-control-kind density variants (§4)
    kind: "button"|"toggle"|"dropdown"|"field"|"segmented"|"color"|"numeric"|"menu",
    compact: spec, medium: spec, expanded?: spec },
  defaultPlacement: { tab, group, order },
  contextualTab?: string,            // §5
  shortcut?: default keybinding,
  risk: "safe" | "confirm" | "always-confirm" | "destructive",   // feeds ARCHITECTURE-AI §4
  undo: "yjs" | "operation-inverse" | "none(explain)",
  choreography?: hints for the AI performer (target primitive, region resolution)
}
```

**Invariant C1:** a command's `execute` is the only mutation path for that operation. Toolbar, menu, shortcut, context menu, and AI all call it. If a studio has a button that doesn't route through a command, N2 either registers it or deletes it.

**Invariant C2:** availability is computed from the same context the AI receives — the AI can never be offered a command the UI would refuse, and vice versa (feeds ARCHITECTURE-FIDELITY §2).

## 3. Tabs and taxonomy

Each artifact type declares a tab taxonomy (N2 sets initial ones; N7 refines with the depth work):

- Document: `General · Insert · Format · Layout · References`
- Sheets: `General · Insert · Format · Data · Formula · Review`
- Presentation: `General · Insert · Design · Arrange · Animate · Present`
- Others proportionally smaller (Quiz/Flashcards/Plan/Code/Whiteboard/Agent keep their current single-bar feel with `General` + 1–3 tabs only where real depth exists — do not inflate simple types).
- App surfaces (Library, Calendar…) get command *sets* (for AI + context menus + shortcuts), not necessarily tabs.

**General is the customizable favorites surface**: defaults chosen per type; users pin/remove/reorder freely.

The tab row is small, connected, Spectra-quiet — it replaces nothing visually violent (no ribbon clone, no second navbar, no stacked bars — D34). Collapsed height stays in the current workbar's family; the row of category tabs sits *within* the single workbar identity, not above it as a new chrome layer.

## 4. Densities and expansion

- **compact / medium** per command (`[Aa ▾]` vs `[ Inter ▾ ]`); control kinds define what each density means; some kinds may only have one honest form — don't force two.
- **Expanded mode:** the workbar can grow vertically into grouped, labeled command clusters (ribbon-functional, Spectra-visual). Per-user, per-type preference; persists via §6; default stays collapsed/minimal.
- Density shedding under width pressure keeps working exactly as today's priority system — it now reads priorities from placement + density prefs.

## 5. Contextual tabs

Selection/caret context can surface a temporary tab: `Equation`, `Table`, `Image`, `Chart`, `Transition`, `Formula`, `Shape`, `Code output`. Declared by commands (`contextualTab`), activated by the studio's selection model, dismissed when context leaves. This is the designated home for deep contextual options — the alternative to permanent inspectors/toolbars. Fullscreen inspectors (History/Comments/References/Details) remain; permanent tool clutter does not.

## 6. Customization and persistence

- User operations: pin/remove from General, move between valid tabs, reorder commands, reorder tabs, rename visible labels (id untouched), choose density per command, expanded on/off, reset-type-to-default. Presets (save/pick layouts) only if trivially cheap after the above — not a required N2 deliverable.
- Stored as **account-synced preferences**. N2 first migrates the whole settings system: new Convex `accountPreferences` (scoped: account / workspace / work-type / device-overlay, mirroring the existing `resolvePreferences` merge order), localStorage demoted to offline cache, `settings.changed` bus event preserved. Command-surface layout is one preference section within it.
- Live propagation: preference change → subscription → every open editor re-renders its workbar in place (D40; no remount). This is also what lets AI customize the toolbar (N8) through the same settings action with confirm-first semantics.

## 7. AI and choreography contract

- The AI resolves a command by **id**, executes semantically, and the choreography layer resolves *where that command currently visually lives* for the acting surface (tab, position, density, overflow state) via a registry lookup — never hardcoded coordinates, never an assumption that a control sits where it shipped. If the user moved Font into General, the AI cursor goes to the user's Font.
- Commands hidden by availability are not in the AI's offered set (C2). `risk` feeds the authority policy (ARCHITECTURE-AI §4).
- Manifest `operations` name-lists and `WorkbarActionSpec`s converge into command ids during N2; `spectraBus` product commands (`work.open`, `settings.*`) become registered app-domain commands in N8 (N2 must not break the bus in the meantime).

## 8. Non-goals

No kbar/command-palette rebuild (nice-to-have later, trivially derivable from the registry). No per-command plugin system. No theming of the workbar beyond existing tokens. No attempt to make Quiz look like Word.
