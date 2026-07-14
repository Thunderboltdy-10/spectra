# ManageBac and school data

## Research boundary

ManageBac’s current official guidance says schools create and permission API tokens in the API Manager and provides a per-tenant reference/changelog there. It documents read/write subtleties, omitted nulls, ISO 8601 timestamps, combined filters, and a 200 requests/minute/IP limit. The public help page does not prove that every endpoint imagined by the current repository exists for this tenant. Therefore endpoint names in the old client—especially timetable, CAS, announcements, and student assignments—must be treated as hypotheses until capability discovery and contract fixtures verify them: [ManageBac Public API](https://help.managebac.com/hc/en-us/articles/360018226931-Enabling-ManageBac-Public-API-for-Integrations). OneRoster 1.2 CSV is a credible fallback for roster exchange, not a live personal-data API: [ManageBac Data Exchange](https://help.managebac.com/hc/en-us/articles/42614157701913-Data-Exchange-User-Guide).

Do not send the development token to the browser, AI, logs, or tests. Do not broadly enumerate student data merely to discover a signed-in user.

## Connector architecture

School admins create an integration record containing schoolId, provider, base URL, vault secret reference, credential fingerprint, capabilities, status, last validation, rotation due date, and policy. The credential is encrypted by a managed secret vault/KMS with envelope encryption; Convex holds only a reference and non-secret metadata. Validation runs in an isolated connector worker with outbound allowlists, redacted logs, timeouts, rate limiting, and per-school queues.

Each capability has: provider path/version, allowed purpose, minimum role, personal/class/school scope, pagination cursor, change strategy, freshness SLA, schema contract version, and last success/error. Use the tenant’s API Manager/reference to build a checked capability manifest. For the current read-only token, disable every mutation regardless of provider documentation.

## Identity resolution

1. Clerk establishes a verified email; the active Spectra school membership establishes tenant scope.
2. A privileged, school-scoped resolver queries only the narrowest permitted user/membership endpoint or an admin-prepared identity index.
3. Match normalized verified school email plus school identifier. Never match on name alone.
4. Exactly one match creates an identityMapping with provider ID, evidence, timestamp, and confidence “verified”. Zero matches requests admin help; several matches enter admin review without returning candidate private data to the student.
5. Subsequent requests use the opaque mapped provider ID. A client-supplied student ID is ignored.

Teachers/admins receive class or school data only through explicit provider capability plus Spectra role/purpose policy. A teacher cannot use a generic retrieval tool to query arbitrary students. Every person-data read is purpose-coded and audited.

## Data categories and product representations

| Provider category | Canonical Spectra representation | Visibility |
|---|---|---|
| personal profile/enrolment | external person summary, not artifact | mapped user and authorized staff |
| class/group/membership | external class plus optional class workspace projection | member or authorized teacher/admin |
| assignment/deadline | external record plus optional planner-task overlay | personal/class policy |
| assessment | trusted external assessment record; optional derived study plan/quiz | never silently editable |
| timetable | external event source feeding timetable artifact | mapped user/class |
| CAS experience/reflection/evidence | external records; user may create a portfolio artifact | mapped user and provider-authorized staff |
| public class resource/file | resource object/version usable in workspace or agent | audience from source policy |
| school-wide public file | school resource catalog, not copied artifact | school audience |
| discussion/announcement | external feed item or linked thread if import is explicit | source audience |

External records are immutable normalized snapshots with providerRecordId, recordType, sourceModifiedAt, fetchedAt, payloadVersion, normalized fields, classification, audience scope, provenance URL, hash, and tombstone. Raw payload retention is minimized and encrypted where retained for debugging. User-created overlays hold notes, completion, reminders, tags, alternative schedule, placement, and linked artifacts. Overlays never overwrite source fields.

## Sync and conflict semantics

Sync has stages: discover capability, fetch page, validate, quarantine invalid records, normalize, resolve relations, diff hashes, commit records/tombstones, update projections, report. Cursor/modified-since use only when provider semantics are proven; periodic reconciliation catches missed deletes. Rate budgets are centrally scheduled with jitter and Retry-After handling.

Because the planned credential is read-only, “conflict” means source changed while a user overlay or derived artifact depends on an older source—not a bidirectional write conflict. UI compares old/new source fields, preserves overlays, marks invalid assumptions, and lets users rebase or unlink. Provider deletion tombstones the external record, preserves provenance in derived work, and offers archive/keep-detached choices. It never deletes a user-created artifact automatically.

## Retrieval and AI

The AI gets tools with semantic purposes—get my upcoming deadlines, find resources for my class, get my timetable—not arbitrary endpoint access. The backend resolves actor mapping, policy, freshness, and minimal fields. Tool results include provenance and stale state. The AI may propose imports, class workspaces, planner overlays, study sessions, quizzes, documents, or CAS portfolio entries. Bulk creation and consequential calendar changes require preview/approval.

Imported tasks and timetable events show a source badge, last refresh, changed/deleted warnings, and user overlay state. “Create workspace from class” previews class metadata, resources, assignments, audience/grants, and artifacts to create. It does not auto-share students’ private work into the class workspace.

## Integration UI review

Preserve the image’s Overview, Import Preview, Sync History, Settings, Field Mapping, category health, and conflict visibility. Change “Field Mapping” to include capability and privacy policy; add credential fingerprint/rotation, request-rate budget, freshness SLA, quarantine, identity-resolution queue, and per-record provenance. Do not show unsupported categories as healthy. Replace any implication of bidirectional sync with read-only source/overlay language until write access is deliberately introduced.

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
- [ ] Independently verified

### MB-02 Obtain tenant API reference/changelog and build a verified read-only capability manifest

- [ ] Implemented
- [ ] Independently verified

### MB-03 Implement vault-backed credentials, validation, rotation, egress policy, and redacted audit

- [ ] Implemented
- [ ] Independently verified

### MB-04 Implement school-scoped identity resolution and ambiguous/no-match admin workflows

- [ ] Implemented
- [ ] Independently verified

### MB-05 Implement external records, normalized relations, tombstones, quarantine, and retention

- [ ] Implemented
- [ ] Independently verified

### MB-06 Implement rate-limited incremental sync, reconciliation, retry, and sync observability

- [ ] Implemented
- [ ] Independently verified

### MB-07 Implement personal/class/school authorization and purpose-coded AI retrieval tools

- [ ] Implemented
- [ ] Independently verified

### MB-08 Implement overlays, provenance, refresh, stale-change, detach, and source-deletion UX

- [ ] Implemented
- [ ] Independently verified

### MB-09 Implement reviewed imports into tasks, timetable, workspaces, resources, and portfolios

- [ ] Implemented
- [ ] Independently verified

### MB-10 Build admin integration, import preview, identity queue, health, mapping, and sync-history surfaces

- [ ] Implemented
- [ ] Independently verified

### MB-11 Prove no cross-student retrieval, secret leakage, schema coercion, or unbounded API enumeration

- [ ] Implemented
- [ ] Independently verified

### MB-12 Pilot with sanitized fixtures and one school before production-wide enablement

- [ ] Implemented
- [ ] Independently verified

