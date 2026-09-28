# Agent artifact plan

This plan inherits the artifact standard and specializes `06_AGENT_ARTIFACT_SYSTEM.md`. Every ordinary Spectra user—student, teacher, school admin, or superadmin—can create, use, share, and improve agents. Roles only add management pages.

## Product and reference contract

`13_agent_library.png` and `14_agent_guided_creation.png` are executable specifications for the library and the complete guided flow. Implement their hierarchy, cards, filters, status, audience language, six-step progression, resources, behavior, skills/tools, testing, review, details, and every visible control. Advanced configuration lives behind clear sections/inspectors; novice creation remains understandable. Catalog card, use-only detail, guided studio, expert editor, test lab, sharing, versions/release, evaluation, analytics, compact placement, quick-chat chip, comparison/history, embed, and responsive states form one cohesive product.

Agents are private by default. Sharing exposes read-only or modify for the artifact plus a distinct use capability represented through the simple UX; internal capabilities remain extensible. Workspace projection can be removed per agent. Public discovery/use is explicit. Invocation threads, prompts, retrieved context, memory, and outputs belong to the invoking user’s private authority and are never exposed through the agent artifact or analytics.

## Model, routing, and release

Content has stable regions for profile/purpose, audience intent, routing descriptors, knowledge/resource bindings, behaviors/boundaries, skills, allowed tools, model policy, specialized context, eval suites, and release notes. Published versions are immutable packages. Resource bindings pin or explicitly track reviewed versions. Only owner can delete; modify, publish, use, and manage-sharing are separate capabilities.

Automatic routing retrieves candidate descriptors on demand. Medium-to-high confidence selects a substantially better agent without confirmation; the selected agent is visible and reversible without interrupting the user. Low confidence uses ordinary Spectra. Continued threads retain their agent unless explicit selection or strong evidence justifies change. Selection loads only that version’s relevant instructions, skills, allowed tools, resource bindings, and specialized context—never all agents at startup. Every decision records candidates considered, confidence/evidence, chosen/fallback version, override, and privacy-safe outcome signals.

Draft authoring uses live synchronized stable-section collaboration, presence, comments, and exclusive conflict control. Publishing claims a stable draft and runs eval/resource/permission gates. Behavior/instruction conflicts pause for review. Each real invocation remains separate from artifact history.

## AI skill, effects, history, analytics

The on-demand agent-artifact skill covers when to create/select an agent, all regions, inspection, training/resource coverage/skill/tool/eval operations, preservation, validation, approvals, publishing, relationships, routing descriptors, and effects. AI assists with training questions, coverage, schemas, test/adversarial cases, behavior proposals, evaluation, and release summaries. No interaction silently changes a published version; improvements are reviewable proposals supported by aggregate categories, consented feedback, or synthetic eval failures.

Working effects bind to the specific profile/resource/behavior/skill/test/release region and fully clear on terminal state. Human sessions and coherent AI batches are distinct versions, with a user checkpoint before AI when needed. Historical rendering shows complete configuration/resource manifest and synchronized comparison, never unrelated usage sessions; restore creates a new draft/current version.

Agent analytics are useful and unsuppressed for small cohorts, but schema-limited to counts, rates, evaluation categories, routing quality, latency/cost, failures, and assignment outcomes. They never contain prompts, thread content, memory, retrieved private content, or unrelated artifacts. Teacher analytics remain limited to their agents or assigned experiences; school/platform operations have broader aggregates without ordinary private content.

## Import, export, failure, migration

Portable signed JSON/ZIP manifests export/import agent profile, permitted instructions, schemas, evals, release metadata, and explicit resource references without secrets or copied inaccessible content. Import is quarantined, schema/version/tool/resource validated, and reports unsupported models/tools/skills, missing resources, permission changes, and behavior diffs. Secrets are re-bound server-side and never exported.

Failures include revoked resource, invalid audience, source leak in eval, unavailable model/tool, regression, deprecated version, policy change, owner departure, routing uncertainty, interrupted publish, reconnect, occupied draft region, and permission loss. Offboarding transfers or archives through explicit policy.

## Tasks

### AGART-01 Define stable content regions, immutable releases, resource/skill/tool/model/eval/routing/feedback/aggregate schemas, manifests, and validation

- [ ] Implemented
- [ ] Verified

### AGART-02 Build exact library and guided-creation references plus detail/editor/test/sharing/versions/analytics/chat-chip/embed/history/responsive representations with every control functional

- [ ] Implemented
- [ ] Verified

### AGART-03 Implement private-default grants/use capability/workspace exceptions/public choice, draft collaboration/comments/region conflicts, publish gates, versions, restore, and owner-only deletion

- [ ] Implemented
- [ ] Verified

### AGART-04 Implement on-demand skill, AI training/coverage/schema/eval/weakness/improvement operations, real region effects, cleanup, and reduced motion

- [ ] Implemented
- [ ] Verified

### AGART-05 Implement automatic on-demand confidence routing, visible reversible selection, thread retention, complete selected-version loading, fallback, audit, and evaluation

- [ ] Implemented
- [ ] Verified

### AGART-06 Prove invocation privacy, source protection, revocation, and useful unsuppressed aggregate analytics without private content

- [ ] Implemented
- [ ] Verified

### AGART-07 Implement secure portable manifest import/export with quarantine, missing/unsupported/fidelity reports, recovery, and tests

- [ ] Implemented
- [ ] Verified

### AGART-08 Build from the clean post-deletion schema with no old agent compatibility/migration path, then prove every UI control, accessibility, scale, history, routing, regression gates, and offboarding

- [ ] Implemented
- [ ] Verified
