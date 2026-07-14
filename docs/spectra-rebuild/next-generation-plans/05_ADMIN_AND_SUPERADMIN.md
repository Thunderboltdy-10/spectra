# Admin and superadmin

## Replacement principles

This system is a clean replacement. Current /admin, /super-admin, /api/admin, /api/school-admin, /api/super-admin, convex/admin.ts, convex/schoolAdmin.ts, convex/superAdmin.ts, and hard-coded email logic are removed in Phase 1. The new implementation uses the same identity, grants, audit, secrets, usage, and design system as the product.

School administration and platform operations are different authority scopes. Neither authority implies routine access to private student prompts, threads, memory, or artifacts. Aggregate adoption and safety workflows must not become a back door into content.

## Role and capability model

Recommended school role bundles: school owner, administrator, IT/integration manager, teacher, support/safeguarding officer, and student. Capabilities are authoritative; roles are editable bundles. Sensitive capability separation includes membership management, role/grant management, integration secret management, content governance, announcement sending, agent governance, audit viewing, data export/deletion, and safeguarding case access.

Platform-operator eligibility comes from normalized SUPER_ADMIN_EMAILS and optional step-up authentication. A platform operator creates a time-boxed operatorSession when entering a school: reason/ticket, target school, read-only default, requested capabilities, expiry, banner, and audit. Writes require an explicit elevation and may require a second operator for destructive actions. Recommend no impersonation of an individual student; operate as a labeled platform operator.

## School admin information architecture

- Overview: health, seats, invitations, adoption, integration status, governance actions, feedback; no platform costs.
- People: members, pending accounts, invitations, roles, groups/classes, seat requests, lifecycle/offboarding.
- Communication: targeted messages, announcements, delivery state, accessible templates, emergency governance.
- Usage & adoption: active users, workspace/artifact/agent adoption, retention trends, storage quotas; privacy thresholds and no prompt inspection.
- Agents & resources: school/class agents, publishing policy, resource bindings, version/eval health, reports.
- Integrations: ManageBac and future connectors, secret rotation, capabilities, mappings, sync runs, quarantine.
- Governance: sharing defaults, public-link policy, retention, AI/model policy, allowed code runtimes/network, exports/deletion, audit.
- Feedback & support: user feedback triage, status/replies, aggregate themes, escalation to Spectra.
- School profile: branding, domains, locale/timezone, academic calendar, accessibility defaults.

Messaging needs consent/role policy, rate limits, group resolution snapshot, scheduling, delivery/failure, edit/cancel rules, and audit. It is not implemented as a hidden direct read of private threads.

## Superadmin information architecture

- Platform overview: school, seat, active-user, AI usage/cost, storage, latency/error, connector health and trend cards.
- Schools: create, configure contract/limits, status, domains, contacts, adoption/health, enter school through operator session.
- Operations: incidents, queues, model/provider health, failed jobs, connector errors, migrations, feature rollout.
- Usage & finance: model/storage/egress cost allocation, budgets, anomalies, forecasts; never shown to school admins unless a future product decision changes it.
- Requests & support: school requests, feedback, tickets, seat changes, integration requests, response SLA.
- Governance: platform policies, data processing regions, retention defaults, public sharing, model allowlists.
- Audit & security: operator sessions, privileged actions, credential events, suspicious access, export/delete jobs.

## Data and services

Use memberships/invitations/groups from the tenancy context; policy bundles and resource grants from authority; usageEvents plus privacy-safe dailyAggregates from metering; auditEvents; feedback; announcements/deliveries; incidents; schoolRequests; integration/secret metadata. Aggregation workers must tolerate delayed usage and expose “last complete through” timestamps.

School creation is a saga: reserve slug/domain, create organization, initial membership invitation, policy defaults, limits, audit, and onboarding state. It is idempotent and reversible before activation. School deletion is a multi-step offboarding workflow with hold, export, connector revocation, user notification, retention, purge preview, and dual approval—not one mutation.

## Privacy and audit

Dashboards suppress small cohorts (recommended threshold five; decision D-12) and avoid raw prompts. Admins see agent evaluation reports and aggregate usage, not student sessions. Feedback is private to reporter plus assigned school/platform responders; users know who can read it. Every privileged read of audit, export, identity mapping, integration settings, or safeguarding case is itself audited.

Audit events are immutable and contain actor context, operator session, action, target type/id, school, decision, reason, request correlation, before/after hashes, timestamp, and safe metadata. Secrets and content excerpts are prohibited. Retention/export access follows policy.

## UI review

The superadmin and school-admin images establish the right warm editorial density, sidebar hierarchy, cards/tables, and health summaries. Remove generic artifact actions such as Share/favorite from operational pages. Add active authority banner and operator-session controls, data freshness, cohort/privacy labels, keyboard table actions, responsive drill-down, empty/error states, and destructive-action review. The same school-admin routes/components render for school admins and scoped platform operators; authority changes controls, not the information architecture.

The frontend-design skill is required during later implementation, as requested. It is not used in this planning stage.

## Failure and safety

- Membership/role edits use optimistic UI only after a server reservation; self-lockout and last-owner removal are prevented transactionally.
- Invitation links are hashed, expiring, single-use, domain/policy checked, and revocable.
- Usage gaps display unknown, not zero; cost anomalies do not trigger automatic school suspension.
- Connector secret validation is isolated; a failed rotation retains the previous credential until explicit cutover.
- Platform operator session expiry revokes subscriptions and mutations immediately.
- Destructive school operations require typed confirmation, impact preview, async job status, retry, and rollback until purge boundary.

## Admin tasks

### ADM-01 Remove the obsolete admin/superadmin implementation and hard-coded platform identity

- [ ] Implemented
- [ ] Verified

### ADM-02 Implement role bundles, capabilities, last-owner invariants, and privileged step-up

- [ ] Implemented
- [ ] Verified

### ADM-03 Implement SUPER_ADMIN_EMAILS parsing and time-boxed labeled operator sessions

- [ ] Implemented
- [ ] Verified

### ADM-04 Implement school creation, activation, suspension, offboarding, export, and purge sagas

- [ ] Implemented
- [ ] Verified

### ADM-05 Build people, invitations, groups/classes, seats, lifecycle, and role-management surfaces

- [ ] Implemented
- [ ] Verified

### ADM-06 Build messaging, announcements, delivery, rate limits, and communication audit

- [ ] Implemented
- [ ] Verified

### ADM-07 Build school usage/adoption, governance, agents/resources, integrations, feedback, and profile areas

- [ ] Implemented
- [ ] Verified

### ADM-08 Build platform schools, health, operations, cost, incidents, requests, and security areas

- [ ] Implemented
- [ ] Verified

### ADM-09 Implement privacy-safe aggregates, cohort suppression, freshness, and anomaly handling

- [ ] Implemented
- [ ] Verified

### ADM-10 Implement immutable privileged audit and audit-of-audit access

- [ ] Implemented
- [ ] Verified

### ADM-11 Apply the frontend-design skill and shared Spectra shell during implementation

- [ ] Implemented
- [ ] Verified

### ADM-12 Prove cross-school isolation, no private-content access, operator expiry, and destructive recovery

- [ ] Implemented
- [ ] Verified
