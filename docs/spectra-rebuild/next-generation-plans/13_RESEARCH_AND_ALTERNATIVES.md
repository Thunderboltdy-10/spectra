# Research and alternatives

Research checked for this planning pass on 2026-07-14. Primary/official documentation is preferred. Product references inform interaction principles; they are not feature checklists to clone.

## Memory and context

| Source | Useful evidence | Spectra consequence |
|---|---|---|
| [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state) | conversation state can be managed independently from external knowledge retrieval | keep thread continuity distinct from long-term memory and search |
| [OpenAI file search](https://developers.openai.com/api/docs/guides/tools-file-search) | semantic/keyword retrieval over bounded stores | use hybrid retrieval as a secondary layer with source/version policy |
| [OpenAI data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint) | endpoint/provider retention choices matter | model calls need declared provider/data policy, not generic “AI” consent |
| [Anthropic context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows) | long context still needs curation and compaction | cap initial memory and retrieve deeper evidence only on demand |
| [Hermes Agent memory](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md) | small frozen startup files provide compact orientation | generate capped capsules, but do not use files as canonical truth |
| [OpenClaw memory](https://docs.openclaw.ai/concepts/memory) | curated memory plus daily evidence and hybrid search | retain evidence/events and promote high-value claims through policy |

Rejected extremes: entire history in every prompt, fully autonomous append-only memory, embeddings as truth, or a universal knowledge graph before claim quality is proven. Recommended hybrid is structured claims + evidence + typed relations + capped generated capsules + permission-first lexical/vector retrieval.

## Collaboration and permissions

| Source | Useful evidence | Spectra consequence |
|---|---|---|
| [Convex realtime](https://docs.convex.dev/realtime) | dependency-based query subscriptions | replace polling for metadata, grants, comments, activity, run state |
| [Convex optimistic updates](https://docs.convex.dev/client/react/optimistic-updates) | local optimistic projections integrate with reactive results | use for bounded domain mutations, not as a concurrency algorithm |
| [Yjs collaborative editor](https://docs.yjs.dev/getting-started/a-collaborative-editor) | CRDT bindings suit rich collaborative editors | preferred live-content adapter, especially Tiptap/ProseMirror |
| [Yjs awareness](https://docs.yjs.dev/getting-started/adding-awareness) | awareness is intentionally not persisted | separate ephemeral presence from activity and history |
| [Automerge](https://automerge.org/docs/hello/) | credible local-first document/sync model | retain as serious alternative if offline-first becomes dominant |
| [ProseMirror collaboration guide](https://prosemirror.net/docs/guide/) | centralized collaborative editing is feasible | domain OT remains an option but expensive across many artifact types |
| [Notion sharing and permissions](https://www.notion.com/help/sharing-and-permissions) | direct/group/workspace/link grants and inherited access need legibility | show source of access and audience impact; do not blindly inherit |
| [Notion comments](https://www.notion.com/help/comments-mentions-and-reminders) | durable comments/mentions belong near content | shared semantic comment service with type-specific anchors |

Recommended hybrid: Convex authority/metadata/comments/activity plus adapter-based Yjs content rooms. Unresolved: managed versus self-hosted provider and degree of offline support.

## School data and privacy

| Source | Useful evidence | Spectra consequence |
|---|---|---|
| [ManageBac Public API](https://help.managebac.com/hc/en-us/articles/360018226931-Enabling-ManageBac-Public-API-for-Integrations) | school-managed tokens, function permissions, tenant reference/changelog, 200 requests/minute/IP, update/filter semantics | discover and contract-test capabilities; never assume old client paths; centrally schedule requests |
| [ManageBac Data Exchange](https://help.managebac.com/hc/en-us/articles/42614157701913-Data-Exchange-User-Guide) | OneRoster 1.2 CSV provides an exchange path | use as controlled roster fallback, not live personal retrieval |
| [GDPR Article 5](https://eur-lex.europa.eu/eli/reg/2016/679/art_5/oj/eng) | minimization, purpose limitation, accuracy, storage limitation, security | purpose-code reads, minimize payloads, correct/delete derived state |
| [US Department of Education FERPA guidance](https://studentprivacy.ed.gov/faq/what-must-educational-agencies-or-institutions-do-ensure-only-school-officials-legitimate) | school officials should receive only data needed for legitimate educational interest | no routine admin/teacher access to private student work or agent sessions |
| [ICO edtech statement, June 2026](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2026/06/ico-statement-on-edtech-examined-report/) | children’s edtech privacy remains an active enforcement concern | perform child-data DPIA/legal review before memory, analytics, or broad connectors |

Alternatives compared: live API versus OneRoster export; copied artifacts versus immutable external records; bidirectional sync versus read-only source plus overlay. Recommendation: verified read-only capabilities, normalized external records, user overlays, explicit conversion into artifacts.

## Calendar, presentations, and canvas

| Source | Product principle | Spectra adaptation |
|---|---|---|
| [Google Calendar Help](https://support.google.com/calendar/?hl=en) and [event creation](https://support.google.com/calendar/answer/72143?hl=en-GB) | events, tasks, recurrence, invitations, calendars, sharing form a coherent time model | typed layers, series/occurrences, source overlays, accessible agenda, approval for consequential AI changes |
| [Google Calendar sharing](https://support.google.com/calendar/answer/37082?hl=en-GB) | calendar and event visibility are distinct | filter external/private layers per viewer instead of sharing the whole view |
| [PowerPoint collaboration](https://support.microsoft.com/en-us/office/work-together-on-powerpoint-presentations-0c30ee3f-8674-4f0e-97be-89cf2892a34d) | coauthoring, comments, and revision history are baseline expectations | native scene collaboration, comments, versions, presenter-safe pinning |
| [Miro board sharing](https://help.miro.com/hc/en-us/articles/360017730813-Sharing-boards-and-inviting-collaborators) | board audiences and roles must be explicit | common grants plus board-specific capabilities |
| [Miro board access rights](https://help.miro.com/hc/en-us/articles/360017572194-Board-access-rights) | edit/comment/view differences matter on canvas | editor/commenter/viewer policy, locked objects and external embeds |
| [Miro comments](https://help.miro.com/hc/en-us/articles/360017730873-Comments) | spatial comments need object/location anchors | node/coordinate anchors with orphan recovery |

Rejected: clone leader chrome, flatten presentations into images, treat every calendar item as editable local data, or load an entire whiteboard scene to every client.

## Interactive artifacts and code

| Source | Useful evidence | Spectra consequence |
|---|---|---|
| [Anthropic Artifacts](https://claude.com/blog/build-artifacts) | generated work can be directly interactive alongside conversation | first-class expanded embeds and source identity |
| [Interactive tools in Claude](https://claude.com/blog/interactive-tools-in-claude) | tool-backed interfaces can remain in the conversation flow | typed embed SDK, permission checks, and bounded context contribution |
| [OWASP prompt-injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) | untrusted content can manipulate agent/tool behavior | separate data/instructions, allowlist tools/network, validate output, red-team indirect injection |
| [Anthropic tool-use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works) | tools need explicit schemas and orchestration | artifact/domain tools, not generic database or shell access |

Alternatives compared: iframe-only web runtime, remote container runtime, or broad app-server execution; vanilla web, React/TypeScript, or language-neutral SDK. Recommendation: sandboxed browser React/TypeScript visualization profile first, isolated remote profiles later, versioned Spectra SDK and no ambient secrets/network.

## Research tasks

### RES-01 Archive tenant-specific ManageBac API reference/changelog and convert it into sanitized contract fixtures

- [ ] Implemented
- [ ] Independently verified

### RES-02 Benchmark managed/self-hosted Yjs and Automerge against Spectra editor/board fixtures

- [ ] Implemented
- [ ] Independently verified

### RES-03 Validate memory policies and token budgets with representative student/teacher tasks

- [ ] Implemented
- [ ] Independently verified

### RES-04 Complete child-data/privacy, retention, analytics, and safeguarding legal review

- [ ] Implemented
- [ ] Independently verified

### RES-05 Prototype PPTX fidelity, ICS interoperability, large-board sync, and sandboxed runtimes

- [ ] Implemented
- [ ] Independently verified

### RES-06 Re-check primary documentation at implementation start and record material changes

- [ ] Implemented
- [ ] Independently verified

