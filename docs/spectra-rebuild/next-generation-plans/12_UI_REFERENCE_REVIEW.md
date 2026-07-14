# UI reference review

## Shared visual language

Preserve warm ivory surfaces, restrained blue action/working color, editorial typography, dense but calm information hierarchy, thin borders, consistent left navigation, central work surface, and purposeful right-side intelligence. Use one shell and component/token system. Operational/admin screens should not inherit artifact actions merely for visual consistency; consistency comes from navigation, spacing, type, controls, states, and motion grammar.

All future references need wide, narrow/panel, keyboard-focus, empty, loading, error, offline, no-access, and destructive-confirmation variants. Working blue must always map to real state and respect reduced motion.

## Per-image review

| Reference | Preserve | Change |
|---|---|---|
| Mission control | workspace cards, Inbox, recent/all-work hierarchy, bottom composer | role-aware nav, shared/no-access/source badges, runs/approvals, narrow layout, no table overload on mobile |
| Superadmin | metric/health/incident/school density | operator-session banner, freshness, cost drill-down, queues/requests, remove Share/star, safe destructive workflows |
| School admin | member/invite/usage/adoption tabs | capability roles, groups/classes, messaging, governance, privacy thresholds, integration/audit depth |
| ManageBac | overview/import/sync/settings organization | capability manifest, secret fingerprint/rotation, identity queue, quarantine, stale source/overlay language |
| Agent library | approachable cards, categories, creator/usage signals | audience/use-right, privacy and version health, explicit Use/Add, revoked/deprecated states |
| Agent studio | knowledge/behavior/permission/test organization | guided training and eval flow, release/version review, resource rights, privacy-safe analytics |
| Presentation | slide rail, spacious canvas, notes/details | layout/theme/media panels, comments/presence/history, present/export, responsive modes |
| Code/visualization | files/code and live-preview duality | runtime/sandbox/dependency status, React/TS default, console/test/accessibility, non-programmer controls |
| Whiteboard | spatial canvas, frames/stickies/connectors, compact toolbars | layers/minimap, AI target regions, large-board loading, keyboard/spatial accessibility, conflict states |
| Timetable | week/day/agenda, mixed event types, plan recommendations | source/overlay badges, timezone/recurrence, approval, conflicts, availability and accessible agenda |
| Document/deck/quiz | artifact-specific density and right details | common collaboration/history/embed/export states and responsive/tiled variants |
| Planner task | domain fields/subtasks/attachments | replace legacy shell, align with current artifact navigation, recurrence/reminders/source overlays |

## References to generate before implementation

1. Shared permission dialog: direct, class/group, school, public, inherited audience, source of access, impact preview.
2. Full history: right timeline and one left historical rendering for document, quiz, canvas, and code.
3. Human/AI collaboration: presence, region trace, conflict compare, partial failure, approval.
4. Embeds: compact/expanded/edit, pinned/live, loading/error/deleted/no-access across thread/document.
5. Memory controls: why remembered, evidence, correct/dispute/delete, scope and pause.
6. ManageBac: capability/credential, identity review, quarantine, source change/rebase.
7. Agent guided training: intent, resources, behaviors, skills, eval cases, publish review.
8. Dataset and portfolio full-screen plus card/embed states.
9. Mobile/narrow/tiled versions of every artifact and admin core surface.
10. Offline/reconnect/permission-revoked and storage/retention limit states.

## UI tasks

### UI-01 Approve shared tokens, shell, motion/state grammar, density, and responsive primitives

- [ ] Implemented
- [ ] Independently verified

### UI-02 Regenerate the code, planner, permission, history, embed, conflict, and memory references

- [ ] Implemented
- [ ] Independently verified

### UI-03 Generate ManageBac identity/quarantine, agent training, dataset, and portfolio references

- [ ] Implemented
- [ ] Independently verified

### UI-04 Generate narrow, tiled, empty, loading, error, offline, and no-access variants

- [ ] Implemented
- [ ] Independently verified

### UI-05 Use frontend-design during implementation and validate cross-product visual coherence

- [ ] Implemented
- [ ] Independently verified

### UI-06 Run keyboard, screen-reader, 200% zoom, contrast, touch, and reduced-motion acceptance

- [ ] Implemented
- [ ] Independently verified

