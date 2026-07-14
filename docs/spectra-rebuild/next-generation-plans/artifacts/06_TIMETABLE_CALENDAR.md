# Timetable and calendar artifact plan

## Purpose and data model

This artifact inherits the standard and unifies a user’s academic time without pretending all events have the same authority. Content contains calendars/layers, local event series and occurrences, study sessions, availability, display preferences, and links. External class/timetable/assignment/assessment records remain immutable sources projected into layers. Personal overlays store color, note, reminder, hidden state, alternative target, and links.

Events preserve UTC instant, IANA timezone, local start/end intent, all-day dates, recurrence rule, exceptions, source, status, location/video, participants/audience, availability, and linked tasks/artifacts. Series edits distinguish occurrence/future/all. Imported source changes retain overlays and expose diff/rebase. Calendar artifact sharing does not automatically expose private source layers.

## Experience and collaboration

Week/day/month/agenda, timetable grid, task/deadline sidebar, plan recommendations, full/panel/card/embed/history, print/export, and accessible agenda are first-class. Preserve the reference’s week/day/agenda hierarchy and mixed event language; add source/overlay badges, timezone, recurrence, conflict, free/busy, and approval states.

Collaboration applies to shared local calendars and study plans. External or private layers are filtered per viewer. Presence is useful for co-planning but cursor-heavy realtime is unnecessary; transactional event edits with live reactive updates suffice. Comments anchor to event/series. History renders the visible range and records local changes/source refresh manifests separately.

AI can inspect permitted deadlines, availability, preferences, task estimates, and existing schedule; propose study blocks, replan after changes, link materials, and explain tradeoffs. Creating/moving/deleting shared events, overriding external dates, or bulk plans requires preview. Hard constraints, sleep hours, accommodations, and locked events outrank optimization.

## Interoperability, failure, migration

Support ICS import/export/subscription with explicit fidelity; Google/Microsoft connectors are later adapters. Handle DST gaps/folds, organizer changes, revoked participants, duplicate feeds, stale source, notification failure, offline edits, and conflicting series changes. Large ranges load by window.

Initial migration imports valid planner dates and separately verified ManageBac source records. Ambiguous/no-timezone events remain flagged; never normalize silently. The old ManageBac-derived artifacts are not treated as canonical calendar history.

## Tasks

### CAL-01 Define layers, sources, series/occurrences, timezone, availability, overlays, reminders, and links

- [ ] Implemented
- [ ] Independently verified

### CAL-02 Build week/day/month/agenda/timetable, card/embed/history, print, and accessible agenda

- [ ] Implemented
- [ ] Independently verified

### CAL-03 Implement recurrence/DST, occurrence edits, conflicts, free/busy, notification, and range loading

- [ ] Implemented
- [ ] Independently verified

### CAL-04 Implement permission-filtered shared/private/external layers, comments, and collaborative planning

- [ ] Implemented
- [ ] Independently verified

### CAL-05 Implement ManageBac projections, source overlays, refresh, rebase, detach, and deletion behavior

- [ ] Implemented
- [ ] Independently verified

### CAL-06 Implement AI planning/replanning with constraints, explanations, previews, and approvals

- [ ] Implemented
- [ ] Independently verified

### CAL-07 Implement ICS interoperability and document connector fidelity/limitations

- [ ] Implemented
- [ ] Independently verified

### CAL-08 Migrate dated work and prove DST, recurrence, privacy, stale source, restore, and offline recovery

- [ ] Implemented
- [ ] Independently verified

