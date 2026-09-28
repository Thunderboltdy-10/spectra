# Migration ledger

> **Historical document.** Completion claims here are superseded.
> See `docs/spectra-hq/STATE.md` for current operational truth.

| Migration | Old path | Replacement | Dual-read/write policy | Removal target | Status |
|---|---|---|---|---|---|
| Collaboration transport | Hocuspocus gateway | Cloudflare Durable Object provider | Document/code and their AI actors use Cloudflare; Hocuspocus remains explicit rollback/unmigrated compatibility | Phase 12/16 | Active; native document/code migrated |
| Work model | Atomic JSON semantic regions | Fine-grained native Yjs structures | Idempotent converter, projection comparison, rollback snapshot; direct bindings for document/code | Phase 12/16 | Active; all native model/migration contracts pass |
| Routes | `/artifacts`, `/timetable`, `/memory` | `/library`, `/calendar`, `/settings` privacy/data | Lightweight redirects preserve canonical identity/query state | Keep redirects when product policy requires | Active; canonical routes own normal navigation |
| Workbench | Separate Library/Workspace grids and local panels | Shared Workbench V2 split tree/session | Existing studio/context state is reused; split layout persists through versioned session normalization | Phase 12/16 | Active; Workbench V2 owns multi-work layout |
| Sidebar | Separate expanded/collapsed desktop trees | One stateful sidebar DOM | Inactive legacy source branch retained only for Phase 12 cleanup; runtime uses the single stateful tree | Phase 12 | Active; single runtime DOM |
| Run events | Existing stream events | Action Protocol V2 | RunItem V2 is canonical and projects through a versioned legacy renderer/history envelope | Phase 12/16 | Active; V2 drives the route stream |
| Run tabs | `DurableRunTabs` shelf/auto-open behavior | Live Dock V2 | Old component name is a compatibility re-export only; persisted run tabs and history are unchanged | Phase 12/16 | Active; Live Dock V2 owns all current tabs |
| Tools | Embedded run-route schemas/dispatch | Tool Registry V2 | Registry generates provider schemas/policy and executes application reads; typed terminal/mutation handlers retain compatibility choreography | Phase 12/16 | Active; registry is source of truth |
| References | Generic preview adapter and separate embed language | Work-specific Reference V2 | Existing embed rows dual-read as Reference identity; native Tiptap insertion and work contracts own new behavior | Phase 12/16 | Active; V2 is source of truth |
| Rich content | Chat-only Markdown renderer | Incremental `SpectraRichContent` AST/adapters | Existing Markdown remains accepted and is parsed through the canonical adapter | Phase 12/16 | Active in chat and comments |
| Comment anchors | Region-only comment anchors | Versioned semantic anchors | Existing rows synthesize semantic anchors on read; new/re-anchored rows persist both during migration | Phase 12/16 | Active; semantic anchor is navigation source |
| Preferences | Theme drawer and scattered local state | Full scoped v2 Settings application | V1/legacy values migrate through product → account → workspace → work-type → device resolver; small drawer now delegates to the same store | Phase 16 | Active; v2 is source of truth |
| School normalization | ManageBac-specific shapes | SchoolSourceAdapter domain | Provider records normalize into explicit entity/time/freshness contracts; existing external records and projections remain readable | Phase 16 | Active; provider-neutral adapter is source of truth |
| Timetable data | Creatable timetable work | Calendar temporal records | New creation is impossible; legacy events migrate idempotently with partial status and retained source links; compatibility artifact reads remain for migration only | Phase 12/16 | Active; Calendar owns normal product flow |
| Agent creation | Fixed Agent Studio wizard | Dynamic Agent Foundry | Existing agents load through compiled package adapter | Phase 12/16 | Pending |

Every data migration must be idempotent, resumable, observable, fixture-tested, partial-failure aware, safe under concurrent use, and reversible where practical. Legacy data is retained until replacement projections validate.
