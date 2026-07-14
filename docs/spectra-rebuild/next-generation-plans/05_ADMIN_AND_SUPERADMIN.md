# Admin and superadmin

## Replacement principles

This system is a clean replacement. Current /admin, /super-admin, /api/admin, /api/school-admin, /api/super-admin, convex/admin.ts, convex/schoolAdmin.ts, convex/superAdmin.ts, and hard-coded email logic are removed in Phase 1. The new implementation uses the same identity, grants, audit, secrets, usage, and design system as the product.

School administration and platform operations are additional authority scopes, not alternate ordinary products. Students, teachers, school admins, and superadmins retain identical ordinary Spectra artifact/agent creation, use, and sharing capabilities. Admin navigation only adds dedicated management pages. Neither authority implies routine access to private prompts, threads, memory, or artifacts; analytics, moderation, adoption, and support cannot become content back doors.

## Role and capability model

Recommended management-role additions are school owner, administrator, IT/integration manager, and support/safeguarding officer. Teacher and student are school-profile labels with no reduced ordinary capability. Capabilities are authoritative for additional management only. Sensitive separation includes membership management, role/grant management, integration secret management, content governance, announcement sending, agent governance, audit viewing, data export/deletion, and any separately approved safeguarding workflow.

Platform-operator eligibility comes from normalized SUPER_ADMIN_EMAILS and optional step-up authentication. A platform operator creates a time-boxed operatorSession when entering a school: reason/ticket, target school, read-only default, requested capabilities, expiry, banner, and audit. Writes require an explicit elevation and may require a second operator for destructive actions. Recommend no impersonation of an individual student; operate as a labeled platform operator.

## School admin information architecture

- Overview: health, seats, invitations, adoption, integration status, governance actions, feedback; no platform costs.
- People: members, pending accounts, invitations, roles, groups/classes, seat requests, lifecycle/offboarding.
- Communication: targeted messages, announcements, delivery state, accessible templates, emergency governance.
- Usage & adoption: active users, workspace/artifact/agent adoption, retention trends, storage/compute/model usage and configured-but-disabled limits; no prompt or private-content inspection.
- Agents & resources: school/class agents, publishing policy, resource bindings, version/eval health, reports.
- Integrations: ManageBac and future connectors, secret rotation, capabilities, mappings, sync runs, quarantine.
- Governance: sharing defaults, public-link policy, retention, AI/model policy, allowed code runtimes/network, exports/deletion, audit.
- Feedback & support: user feedback triage, status/replies, aggregate themes, escalation to Spectra.
- School profile: branding, domains, locale/timezone, academic calendar, accessibility defaults.

Messaging needs consent/role policy, rate limits, group resolution snapshot, scheduling, delivery/failure, edit/cancel rules, and audit. It is not implemented as a hidden direct read of private threads.

## Superadmin information architecture

- Platform overview: school, seat, active-user, AI usage/cost, storage, latency/error, connector health and trend cards.
- Schools: create, configure status/domains/contacts, inspect usage/storage, define/adjust/simulate disabled-default limits, later enable enforcement deliberately, and enter the shared school-admin interface through an operator session.
- Operations: incidents, queues, model/provider health, failed jobs, connector errors, migrations, feature rollout.
- Usage & finance: model/storage/egress cost allocation, budgets, anomalies, forecasts; never shown to school admins unless a future product decision changes it.
- Requests & support: school requests, feedback, tickets, seat changes, integration requests, response SLA.
- Governance: platform policies, data processing regions, retention defaults, public sharing, model allowlists.
- Audit & security: operator sessions, privileged actions, credential events, suspicious access, export/delete jobs.

## Data and services

Use memberships/invitations/groups from tenancy; policy bundles/resource grants from authority; usageEvents and dailyAggregates for storage, model, messages, artifact operations, collaboration bandwidth, imports, and execution; limitPolicies with enforcementEnabled=false by default; auditEvents; feedback; announcements/deliveries; incidents; schoolRequests; integration/secret metadata. Aggregation workers tolerate delayed usage and expose “last complete through” timestamps. Limits can be simulated and adjusted per school without commercial enforcement or product redesign.

School creation is a saga: reserve slug/domain, create organization, initial membership invitation, policy defaults, limits, audit, and onboarding state. It is idempotent and reversible before activation. School deletion is a multi-step offboarding workflow with hold, export, connector revocation, user notification, retention, purge preview, and dual approval—not one mutation.

## Privacy and audit

Dashboards do not suppress small cohorts solely because they are small. They still avoid private prompts, thread content, memory, and unrelated artifacts. School admins/superadmins may receive extensive operational aggregates; teachers receive only limited analytics that help with their own agents or explicitly assigned learning experiences and analytics never become the centre of teacher UX. Feedback is private to reporter plus assigned school/platform responders; users know who can read it. Every privileged read of audit, export, identity mapping, integration settings, or any separately authorized case is itself audited.

Audit events are immutable and contain actor context, operator session, action, target type/id, school, decision, reason, request correlation, before/after hashes, timestamp, and safe metadata. Secrets and content excerpts are prohibited. Retention/export access follows policy.

## UI review

Match 10_superadmin_overview.png and 11_school_admin_overview.png extremely closely: warm editorial shell, metric cards, charts, storage/usage, health, seats, feedback, queues, schools/workspaces, activity, settings, and persistent composer. Every displayed action must work. Where a reference suggests generic Share/star on an operational page, preserve layout fidelity but replace it with meaningful operational actions. Add active operator-session banner/controls, freshness, privacy labels, limit-enforcement status, keyboard/responsive drill-down, empty/error states, and destructive review. The same school-admin routes/components render for local admins and scoped platform operators.

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

### ADM-02 Implement ordinary product role parity, management-only capability additions, last-owner invariants, and privileged step-up

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

### ADM-09 Implement extensive privacy-safe admin/superadmin aggregates without small-cohort suppression, limited purposeful teacher analytics, freshness, and anomaly handling

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

### ADM-13 Meter storage, model, collaboration, execution, import, and activity usage; expose school/platform views and per-school limit configuration/simulation with enforcement disabled by default

- [ ] Implemented
- [ ] Verified
