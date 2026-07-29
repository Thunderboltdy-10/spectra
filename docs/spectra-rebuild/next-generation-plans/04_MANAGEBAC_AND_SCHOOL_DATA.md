# ManageBac and school data

## Research boundary

ManageBac’s current official guidance says schools create and permission API tokens in the API Manager and provides a per-tenant reference/changelog there. It documents read/write subtleties, omitted nulls, ISO 8601 timestamps, combined filters, and a 200 requests/minute/IP limit. The public help page does not prove that every endpoint imagined by the current repository exists for this tenant. Therefore endpoint names in the old client—especially timetable, CAS, announcements, and student assignments—must be treated as hypotheses until capability discovery and contract fixtures verify them: [ManageBac Public API](https://help.managebac.com/hc/en-us/articles/360018226931-Enabling-ManageBac-Public-API-for-Integrations). OneRoster 1.2 CSV is a credible fallback for roster exchange, not a live personal-data API: [ManageBac Data Exchange](https://help.managebac.com/hc/en-us/articles/42614157701913-Data-Exchange-User-Guide).

The supplied API Manager permission screenshot and the tenant-specific reference are capability evidence. During implementation, archive a redacted copy, inventory every permission category and displayed route, configure the school token read-only for every available category, and reconcile the screenshot against the live tenant reference. Every readable route must be discovered, verified, documented, contract-tested with sanitized fixtures, and represented in the capability manifest. Do not infer contracts from the old client. Never enable or call write routes.

Do not send the development token to the browser, AI, ordinary logs, client-visible database records, or committed tests. Do not broadly enumerate student data merely to discover a signed-in user.

## Connector architecture

School admins create an integration record containing schoolId, provider, base URL, server-secret reference, credential fingerprint, capabilities, status, last validation, rotation due date, and policy. Use pragmatic authenticated server-side encryption with a server-only key and tightly restricted backend functions; client-visible Convex records hold only reference/fingerprint metadata. Support rotation and audit without requiring costly external vault infrastructure at the current scale. Validation runs in an isolated server worker with an egress allowlist, redacted logs, timeouts, rate limiting, and per-school queues.

Each capability has: provider path/version, allowed purpose, minimum role, personal/class/school scope, pagination cursor, change strategy, freshness SLA, schema contract version, and last success/error. Use the tenant’s API Manager/reference to build a checked capability manifest. For the current read-only token, disable every mutation regardless of provider documentation.

## Identity resolution

1. Clerk establishes a verified email; the active Spectra school membership establishes tenant scope.
2. A privileged, school-scoped resolver queries only the narrowest permitted user/membership endpoint or an admin-prepared identity index.
3. Match normalized verified school email plus school identifier. Never match on name alone.
4. Exactly one match stores the ManageBac user ID in a restricted server-side identityMapping with evidence, timestamp, and verified status. Zero matches requests admin help; several matches enter an admin-only review without returning candidate identities or details to the user.
5. Subsequent personal requests derive the mapped provider ID server-side. A client-supplied ManageBac user/student ID is rejected and security-audited, not merely ignored.

Teachers/admins receive class or school data only through explicit provider capability plus Spectra role/purpose policy. A teacher cannot use a generic retrieval tool to query arbitrary students. Every person-data read is purpose-coded and audited.

## Data categories and product representations

| Provider category                  | Canonical Spectra representation                                     | Visibility                                |
| ---------------------------------- | -------------------------------------------------------------------- | ----------------------------------------- |
| personal profile/enrolment         | external person summary, not artifact                                | mapped user and authorized staff          |
| class/group/membership             | external class plus optional class workspace projection              | member or authorized teacher/admin        |
| assignment/deadline                | external record plus optional planner-task overlay                   | personal/class policy                     |
| assessment                         | trusted external assessment record; optional derived study plan/quiz | never silently editable                   |
| timetable                          | external event source feeding timetable artifact                     | mapped user/class                         |
| CAS experience/reflection/evidence | external records convertible into documents, tasks, timetable items, Sheets, links, or workspaces | mapped user and provider-authorized staff |
| public class resource/file         | resource object/version usable in workspace or agent                 | audience from source policy               |
| school-wide public file            | school resource catalog, not copied artifact                         | school audience                           |
| discussion/announcement            | external feed item or linked thread if import is explicit            | source audience                           |

External records are immutable normalized snapshots with providerRecordId, recordType, sourceModifiedAt, fetchedAt, payloadVersion, normalized fields, classification, audience scope, provenance URL, hash, and tombstone. Raw payload retention is minimized and encrypted where retained for debugging. User-created overlays hold notes, completion, reminders, tags, alternative schedule, placement, and linked artifacts. Overlays never overwrite source fields.

## Sync and conflict semantics

Sync has stages: discover capability, fetch page, validate, quarantine invalid records, normalize, resolve relations, diff hashes, commit records/tombstones, update projections, report. Cursor/modified-since use only when provider semantics are proven; periodic reconciliation catches missed deletes. Rate budgets are centrally scheduled with jitter and Retry-After handling.

Because the planned credential is read-only, “conflict” means source changed while a user overlay or derived artifact depends on an older source—not a bidirectional write conflict. UI compares old/new source fields, preserves overlays, marks invalid assumptions, and lets users rebase or unlink. Provider deletion tombstones the external record, preserves provenance in derived work, and offers archive/keep-detached choices. It never deletes a user-created artifact automatically.

## First successful synchronization

First sync is an automatic, resumable, idempotent bootstrap after credential validation and exact user mapping. It shows capability-by-capability progress and a completion summary but does not require approval for every ordinary import. A bootstrapVersion and deterministic provider keys prevent duplicate workspaces/tasks/events when retried.

For every verified readable capability, the importer may create or connect:

- exactly one class workspace per current class, keyed by provider class ID and academic period;
- timetable source layers and occurrences;
- immutable source assignment/assessment/deadline records plus source-linked planner tasks or task overlays according to documented mapping;
- permitted class/school resources and links;
- class, task, deadline, timetable, document, Sheet, and workspace relationships;
- CAS source records available for conversion into existing artifact types;
- provenance badges, source timestamps, freshness state, and an import summary.

Automatic class workspaces start private to the mapped user unless an explicit school/class sharing policy has been configured. Provider membership does not expose private user work. The bootstrap records created/linked/skipped/quarantined/error counts per capability and can resume without re-creating customized objects.

## Later synchronization procedure

Later sync resolves deterministic source identity before any write:

1. unchanged hashes/versions leave records and projections untouched;
2. new records are automatically added only when the established mapping is safe and non-consequential; new classes follow the configured auto-create policy and never duplicate an existing provider-keyed workspace;
3. source-field changes update immutable external records and safe projections while preserving all user overlays/customization;
4. source removals create tombstones/detach states and never delete user-authored work;
5. overlapping user/source assumptions produce a conflict with old source, new source, overlay, affected links, and suggested actions;
6. AI may summarize conflicts and recommend resolutions, but consequential workspace reorganization, ambiguous identity/linking, or destructive detach requires review;
7. each run publishes an itemized summary and retains retryable failures without rolling back unrelated successful capabilities.

Class workspace names, descriptions, layout, collaborators, placed artifacts, and user-created links are overlays/customization. Later sync may refresh source metadata but cannot recreate, replace, or reset the workspace. Planner and timetable plans inherit the same source/overlay/tombstone procedure.

## Retrieval and AI

The AI gets tools with semantic purposes—get my upcoming deadlines, find resources for my class, get my timetable—not arbitrary endpoint access. The backend resolves actor mapping, policy, freshness, and minimal fields. Tool results include provenance and stale state. The AI may propose documents, tasks, timetable plans, Sheets, quizzes, class-workspace organization, or CAS conversions into existing artifact types. Consequential calendar/workspace reorganization requires preview/approval; ordinary idempotent first-sync creation follows the bootstrap policy without per-item approval.

Imported tasks and timetable events show a source badge, last refresh, changed/deleted warnings, and user overlay state. First sync creates class workspaces automatically; later manual “Create workspace from class” is offered only for a class not already mapped and previews metadata/resources/assignments/access. It never auto-shares private work.

## Integration UI review

Match 12_managebac_integration.png: status/coverage/conflicts, Classes/Timetable/Tasks/History/Conflicts/Provenance, previews, sync table, conflict cards, right settings/details, and persistent composer. Add the verified permission/category/route manifest, credential fingerprint/rotation, request-rate budget, freshness SLA, first-sync bootstrap progress/summary, quarantine, identity-resolution queue, and per-record provenance. Do not show unsupported or unverified categories as healthy. All settings remain read-only-source/overlay semantics; there is no bidirectional provider write.

## Failure, security, and operations

- Invalid/expired credential: revoke worker cache, mark integration blocked, notify authorized admins, continue serving last records as stale if retention allows.
- Partial page failure: commit no ambiguous page; retain last good records and resume cursor idempotently.
- Schema drift: quarantine unknown version, alert, preserve sanitized sample fixture, do not coerce.
- Wrong identity suspicion: revoke mapping immediately and purge derived personal caches; never show alternate student candidates.
- School offboarding: revoke secret, stop jobs, export allowed overlays, delete source records per contract.
- Provider compromise/prompt injection in resources: treat content as untrusted data, scan files, sandbox previews, never treat text as AI instructions.

## ManageBac tasks

### MB-01 Remove every old ManageBac route, function, field, cron, env dependency, utility, and test

- [ ] Implemented
- [ ] Verified

### MB-02 Inspect the API Manager screenshot and tenant reference, inventory every permission/category/route, configure all available permissions read-only, and build sanitized contract fixtures/manifest

- [ ] Implemented
- [ ] Verified

### MB-03 Implement pragmatic server-encrypted credentials, restricted access, validation, rotation, egress policy, fingerprinting, and redacted audit

- [ ] Implemented
- [ ] Verified

### MB-04 Implement verified-school-email exact-one identity resolution, restricted stored provider ID, client-ID rejection, and ambiguous/no-match admin workflows

- [ ] Implemented
- [ ] Verified

### MB-05 Implement external records, normalized relations, tombstones, quarantine, and retention

- [ ] Implemented
- [ ] Verified

### MB-06 Implement automatic idempotent first sync with class workspaces, timetable, tasks/deadlines/assessments/resources/links, progress, summary, retry, and no duplicate recreation

- [ ] Implemented
- [ ] Verified

### MB-07 Implement personal/class/school authorization and purpose-coded AI retrieval tools

- [ ] Implemented
- [ ] Verified

### MB-08 Implement later-sync hashing, safe automatic changes, customization-preserving overlays, no duplicate class workspaces, conflict review, tombstones, detach, and source-deletion UX

- [ ] Implemented
- [ ] Verified

### MB-09 Implement source conversions/links into documents, tasks, timetable, Sheets, quizzes, workspaces, and resources with approval only for consequential ambiguity

- [ ] Implemented
- [ ] Verified

### MB-10 Match the ManageBac reference UI and build capability/permission detail, bootstrap progress/summary, previews, identity queue, health, provenance, quarantine, conflict, and sync-history surfaces

- [ ] Implemented
- [ ] Verified

### MB-11 Prove no cross-student retrieval, secret leakage, schema coercion, or unbounded API enumeration

- [ ] Implemented
- [ ] Verified

### MB-12 Pilot with sanitized fixtures and one school before production-wide enablement

- [ ] Implemented
- [ ] Verified
