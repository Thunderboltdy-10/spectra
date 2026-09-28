# Research and selected alternatives

Research checked for this planning pass on 2026-07-14. Primary and official documentation is preferred. Product references establish proven interaction expectations; Spectra still owns its architecture, event protocol, visual language, and security model.

## Memory, context, and progress events

| Source | Evidence | Spectra consequence |
|---|---|---|
| [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state) | Conversation continuity is distinct from external knowledge retrieval. | Keep thread state separate from long-term memory and artifact search. |
| [OpenAI file search](https://developers.openai.com/api/docs/guides/tools-file-search) | Bounded semantic and keyword retrieval can complement model context. | Retrieve permission-filtered evidence on demand; never treat embeddings as canonical truth. |
| [OpenAI streaming responses](https://developers.openai.com/api/docs/guides/streaming-responses) | Responses expose typed semantic streaming events rather than one undifferentiated text stream. | Use native typed Spectra run events synchronized across UI, persistence, recovery, and audit. |
| Current official Codex manual, fetched 2026-07-14 | Thread, turn, item, item-progress, plan, tool, and completion events make real work observable without a fixed checklist. | The active model emits hidden, operation-specific Spectra progress tags; the runtime validates, persists, broadcasts, and removes them from response text. Do not copy Codex implementation details or use a naming model. |
| [OpenAI data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint) | Provider and endpoint retention behavior matters. | Every model route has an explicit data policy and excludes secrets. |
| [Anthropic context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows) | Long context still benefits from curation and compaction. | Start with a concise memory capsule around 1,000 tokens, then expand or retrieve deeper evidence when usefulness tests justify it. |

Selected memory design: permission-scoped structured claims plus evidence, typed relations, concise generated startup capsules, and lexical/vector retrieval. Memory is enabled by default and maintained in background. Rejected: full-history injection, startup injection of every agent or artifact guide, autonomous append-only memory, token minimization that harms usefulness, and memory-maintenance progress messages.

## Collaboration, live persistence, and permissions

| Source | Evidence | Spectra consequence |
|---|---|---|
| [Convex realtime](https://docs.convex.dev/realtime) | Dependency-based reactive query subscriptions fit metadata and authority state. | Use for grants, comments, activity, runs, sync manifests, usage, and derived views. |
| [Convex optimistic updates](https://docs.convex.dev/client/react/optimistic-updates) | Local projections can improve bounded mutation responsiveness. | Use for reversible domain mutations; never substitute them for concurrency control. |
| [Yjs collaborative editor](https://docs.yjs.dev/getting-started/a-collaborative-editor) | CRDT bindings suit rich collaborative editing. | Use typed Yjs documents/subdocuments behind artifact adapters. |
| [Yjs awareness](https://docs.yjs.dev/getting-started/adding-awareness) | Awareness is ephemeral and intentionally not persisted. | Keep presence separate from durable activity and history. |
| [Yjs y-websocket](https://docs.yjs.dev/ecosystem/connection-provider/y-websocket) | An extensible self-hosted server supports authorization, awareness, persistence hooks, reconnect, and later scaling. | Select self-hosted Yjs now behind a transport interface; authenticate every room and keep migration to managed transport possible. |
| [Notion sharing and permissions](https://www.notion.com/help/sharing-and-permissions) | Direct, group, workspace, and link access must have legible provenance. | Show why a viewer has access and allow per-artifact removal from workspace-projected access. |

Selected design: Convex authority/metadata plus self-hosted Yjs content transport, stable semantic-region claims, and live persistence. Spectra is online-first: it reconnects and exposes unsynchronized/recovery states but does not accept offline edits or maintain offline mutation queues. Same-region edits queue or pause with an explicit resolution experience; non-overlapping regions proceed concurrently.

Rejected for this release: managed collaboration as a dependency, offline-first/local-first editing, silent last-write-wins for semantic regions, and a product-wide custom OT engine. A transport benchmark remains an implementation validation task, not an unresolved product choice.

## Sheets and structured analysis

| Source | Evidence | Spectra consequence |
|---|---|---|
| [Google Sheets and Excel comparison](https://support.google.com/docs/answer/9331278) | Real-time collaboration, automatic saving, versions, formulas, filters, and script/automation are baseline spreadsheet expectations. | Sheets is a workbook product, not a styled table. |
| [Google Sheets function list](https://support.google.com/docs/table/25273) | Users expect broad familiar formula coverage. | Implement a deterministic, versioned formula engine with compatibility and unsupported-function reporting. |
| [Google Sheets analysis and linked charts](https://support.google.com/docs/answer/9330962) | Charts can remain linked when embedded in documents or presentations. | Treat ranges and charts as stable embeddable regions with live or pinned source versions. |
| [Google version history](https://support.google.com/docs/answer/190843) | Workbook versions and cell edit history are important but do not always cover every object type. | Spectra history must cover cells, formulas, formatting, tables, charts, structure, imports, and AI batches coherently. |
| [Excel coauthoring](https://support.microsoft.com/en-US/Excel/get-started/collaborate-on-excel-workbooks-at-the-same-time-with-co-authoring) | Autosave, presence, colored selections, rapid coauthor updates, and version history are expected. | Live synchronized cell/range collaboration and presence are first-class. |
| [Excel Show Changes](https://support.microsoft.com/en-US/Excel/get-help-with-show-changes-in-excel) | Change inspection can be scoped to cells, ranges, sheets, or workbooks. | Provide type-aware activity/history filters and preserve coverage beyond cell values. |

Selected Sheets design: workbooks/sheets, typed cells and ranges, deterministic formulas, formatting, tables, filter/sort, charts, comments, history, AI analysis/editing, linked cross-artifact charts, and staged CSV/TSV/XLSX/ODS import/export with fidelity reports. Spreadsheet range claims prevent overlapping human/AI edits. External-data functions require explicit permission, safe connectors, and metering; arbitrary URL fetches are not ambient formula behavior.

## School data, privacy, and analytics

| Source | Evidence | Spectra consequence |
|---|---|---|
| [ManageBac Public API](https://help.managebac.com/hc/en-us/articles/360018226931-Enabling-ManageBac-Public-API-for-Integrations) | Tokens are school-managed, permissioned by function; tenant reference/changelog and rate/update/filter behavior matter. | Archive the tenant API Manager/reference, discover every readable permission category and route, build a verified manifest, and never infer contracts from old code. |
| [ManageBac Data Exchange](https://help.managebac.com/hc/en-us/articles/42614157701913-Data-Exchange-User-Guide) | OneRoster 1.2 CSV is an exchange route. | Retain controlled roster import as fallback, not as live personal-data resolution. |
| [GDPR Article 5](https://eur-lex.europa.eu/eli/reg/2016/679/art_5/oj/eng) | Purpose limitation, minimization, accuracy, storage limitation, and security apply. | Purpose-code reads; minimize, correct, expire, and delete derived state. |
| [US Department of Education FERPA guidance](https://studentprivacy.ed.gov/faq/what-must-educational-agencies-or-institutions-do-ensure-only-school-officials-legitimate) | School officials should receive only records needed for legitimate educational interest. | Management analytics never become a browser for private prompts, threads, memory, or unrelated artifacts. |

Selected integration: server-side read-only school token; exact identity resolution by the signed-in user’s verified school email; stored server-resolved external user ID; automatic idempotent first sync; later hash/version reconciliation with overlays, provenance, tombstones, detach, safe updates, and explicit consequential-conflict review. The client never supplies a different external user ID. Analytics are not suppressed for small cohorts, but their schemas exclude private content and teachers receive only purpose-bound agent/assigned-experience aggregates.

## Documents, presentations, calendar, and canvas

| Source | Evidence | Spectra consequence |
|---|---|---|
| [Google Calendar Help](https://support.google.com/calendar/) | Events, tasks, recurrence, calendars, sharing, and invitations form one coherent time model. | Use typed source layers, series/occurrences, overlays, accessible agenda, and approval for consequential AI moves. |
| [PowerPoint collaboration](https://support.microsoft.com/en-us/office/work-together-on-powerpoint-presentations-0c30ee3f-8674-4f0e-97be-89cf2892a34d) | Coauthoring, comments, and revision history are baseline. | Collaborate on native scene objects, comments, versions, and pinned presenter state. |
| [Miro board access rights](https://help.miro.com/hc/en-us/articles/360017572194-Board-access-rights) | Canvas view/comment/edit distinctions and object locks matter. | Map simple read-only/modify sharing onto board actions while keeping extensible capabilities internally. |
| [Miro comments](https://help.miro.com/hc/en-us/articles/360017730873-Comments) | Spatial comments need object/location anchors. | Anchor by node/coordinate with fallback recovery. |

Spectra-native quality remains canonical. Major migration formats are staged with fidelity reporting and quarantine: DOCX/ODT/Markdown/HTML/PDF extraction for documents; PPTX/ODP and controlled Google Slides export ingestion for presentations; ICS for time; SVG/PDF/images and safe structured interchange for whiteboards. Imported work remains editable and exportable; unsupported features are never silently dropped.

## Code and interactive visualisations

| Source | Evidence | Spectra consequence |
|---|---|---|
| [OWASP prompt-injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) | Untrusted content can manipulate model/tool behavior. | Separate data from instructions, allowlist tools/network, validate outputs, and test indirect injection. |
| [Anthropic Artifacts](https://claude.com/blog/build-artifacts) | Interactive generated work can remain alongside conversation. | Provide first-class expanded and embedded rendered experiences with source identity. |

Code source may use any programming language. Initial execution is deliberately narrower: browser HTML/CSS/JavaScript, React/TypeScript visualisations, and isolated Python. Other common interpreted profiles may be added after sandbox validation; compiled execution is not required initially. Interactive visualisations use an on-demand Spectra visual-design skill and token/component SDK so approachable outputs share the product’s typography, colour, motion, layout, accessibility, and embed behavior. No ambient secrets or network access.

## Research and validation tasks

### RES-01 Archive the tenant-specific ManageBac API Manager/reference and changelog; inventory and contract-test every readable permission category and route

- [ ] Implemented
- [ ] Verified

### RES-02 Validate self-hosted Yjs authorization, persistence, reconnect, recovery, scale, and transport replacement against representative artifact fixtures

- [ ] Implemented
- [ ] Verified

### RES-03 Validate default-on memory scoping, contamination resistance, usefulness, background maintenance, and adaptive token budgets with representative roles/tasks

- [ ] Implemented
- [ ] Verified

### RES-04 Complete child-data/privacy, retention, analytics, safeguarding, and purpose-access review

- [ ] Implemented
- [ ] Verified

### RES-05 Prototype and fidelity-test DOCX/ODT, PPTX/ODP, XLSX/ODS, ICS, whiteboard interchange, large-board sync, and sandboxed browser/Python runtimes

- [ ] Implemented
- [ ] Verified

### RES-06 Validate native Spectra progress tags/events against durable run recovery, cancellation, parallel operations, UI synchronization, and response-text stripping

- [ ] Implemented
- [ ] Verified

### RES-07 Re-check cited primary documentation at each relevant implementation start and record material changes in the implementation ledger

- [ ] Implemented
- [ ] Verified

