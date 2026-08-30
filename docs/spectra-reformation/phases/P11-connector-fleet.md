# P11 — The Connector Fleet

**Goal:** the Tier-1 industry-leader connectors (EXPANSION §2 matrix) built one unit per connector on the P10 seams, in parallel worktrees, each honest about exactly what it can and cannot sync (CANON R25). A connector unit is done when a real user can add the connection in Settings, see truthful health, work with linked artifacts, and remove the connection — with every failure state humanized and every fidelity boundary declared.

**Prerequisites:** **P10.V1 PASS (hard gate — no P11 merge before it).** OAuth credentials are Pablo-owned (QUESTIONS): every unit builds and tests against **recorded fixtures** first; live probes are its last leg and may complete after credentials arrive. **Architecture:** EXPANSION §2/§7, ARCHITECTURE-FIDELITY, ARCHITECTURE-TRUTH. **Findings absorbed:** provider API realities recorded in the matrix (Quizlet has no public API; Notion has no mergeable revision model; Google native files export/import through OOXML).

**Difficulty (PROCESS §4):** I1, I4 = Hard / xhigh. I2, I3 = MT / xhigh. I5, I6 = MT / high. V1 = Hard / **max**.

**Standing unit shape (every connector unit delivers all of):**

1. Provider descriptor + Convex action worker (family-appropriate: delta pull, push where supported, backoff, journaling).
2. Auth flow wired to the P10 connection model (tokens in secretStore; refresh; revoke).
3. Format path: lens, interchange shim, or projection — per family.
4. Connections-hub card with truthful states and R13 sentences (including the R25 scope sentence, e.g. "Import and export only — Quizlet does not offer live sync").
5. Fixture corpus `fixtures/<provider>/` + contract suite in the shared harness runner; recorded-fixture tests runnable without credentials.
6. AI exposure: linked artifacts readable/targetable through existing tools; connector-triggered refresh as an operation with authority gating.

Ownership: each unit owns only `src/features/spectra/connectors/<provider>/` + `fixtures/<provider>/` + its hub card. Registration points are merge-queue-managed (EXPANSION §5).

## P11.I1 — Google Drive + Docs/Sheets/Slides (H)

file-sync family. Drive API v3: `changes.list` delta with stored page tokens; `files.export` / import for native Google files through the **OOXML interchange shim** (existing docx/xlsx/pptx lenses — no Google-native lens in this program); binary Drive files as resources. `headRevisionId`/`version` as providerRevision. Google's OOXML conversion is the declared fidelity boundary: capability gating must reflect what survives the shim, not pretend native depth (R7). Multi-replica journeys (Drive + local copy of the same work) must resolve through `syncConflicts`, never silent last-write-wins.

## P11.I2 — Google Calendar (MT)

calendar family. Incremental sync tokens; events project to `calendarItems` with `sourceKey`/`sourceHash` (promoted ManageBac pattern); two-way for Spectra-authored events (create/update/delete with provider ids stored); recurring events expanded per the existing RRULE handling; timezone/timePrecision honesty. Dedup contract against other calendar sources (same event from MB and Google must not double-render — dedup by sourceKey family rules).

## P11.I3 — Outlook / Microsoft 365 Calendar + iCal feeds (MT)

calendar family. Graph delta queries for events, same two-way contract as I2 (shared calendar-connector core, not copy-paste — extract the common worker shape if I2 hasn't already). Plus **iCal feed subscribe**: URL-based read-only calendars, polled with conditional requests; UI says "subscribed calendar", never claims write.

## P11.I4 — Notion (H)

file-sync family, **linked import/export + one-way refresh** (R25): Notion's `last_edited_time` cannot support true merge, and the unit must not fake it. Pages → document artifacts (blocks → TipTap-compatible projection); databases → sheets or planner_task collections (user chooses at import); document → Notion page export. Linked mode: refresh detects remote change and offers re-import with a diff preview through the standard conflict surface; Spectra-side edits offer export-overwrite with explicit confirmation. Every claim in the UI matches this exactly.

## P11.I5 — Flashcards & quiz interop: Quizlet + Anki (MT)

import/export family, flashcard_deck + quiz. **Quizlet: no public API — file/paste import via its export text format, and export back; the UI states this** (R25). Anki: `.apkg` (SQLite+media) and `.txt` import/export for decks, preserving cloze; scheduling state imports where representable, declared where not. Quiz export to CSV and GIFT (Moodle) formats. These file formats may ride the Bridge for watched folders (they are just files) — no special transport.

## P11.I6 — Local formats: Markdown/Obsidian, CSV, PDF (MT)

file-sync via the existing Bridge (they are local files; the P10.I3 lenses do the work). Markdown/Obsidian: `md` as a first-class nativeFormat for documents — full replica truth, watcher, Keep-in-Spectra, conflicts; vault-specific constructs (wiki-links, frontmatter) preserved-not-interpreted and declared. CSV: sheets single-table replicas. PDF: **import-only** — resource + text extraction into a new document artifact; never claims round-trip. Format registry rows, discovery gates, and policy defaults for all three.

## P11.V1 — Fleet verification (H, max)

Fresh agent, local instance, own `local-deploy` lease; `bridge` lease for I6 legs; live credentials where available (recorded-fixture verdicts are explicitly labeled where not).

- Per-connector contract suites green; per-connector L3 journey: add connection → link/import real content → edit → external change → reconcile → remove connection (sequences, R11).
- **Cross-connector journeys:** the same document linked local + Drive; a calendar week fed by MB + Google + iCal with dedup holding; a deck imported from Anki and exported to Quizlet format.
- **Adversarial states:** token revoked mid-sync, provider 429/5xx storms (backoff honesty), connection removed with pending writes (compensating exits, R2), no unlabeled fidelity loss anywhere (R7/R25).
- Budget re-check (P9 baselines): connector idle cost must be near-zero; polling profiles within budget.

## Exit gate

Every Tier-1 connector: contract suite green, journey PASS, honest scope sentence in the UI, remove-connection clean. Tier-2 connectors (EXPANSION §2) remain Field Notes with named owners for a later wave. V1 PASS; Pablo pass.
