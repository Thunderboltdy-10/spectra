# Agent artifact plan

This plan inherits the artifact standard and specializes 06_AGENT_ARTIFACT_SYSTEM.md.

## Artifact contract

Agent content is structured into profile/purpose, audience intent, knowledge bindings, behaviors/boundaries, skills/tools, routing descriptors, evaluation suites, and draft release notes. Published agentVersions are immutable packages. Resource bindings pin or explicitly track reviewed versions. Only creator/owner can delete; modify/publish/use are separate capabilities.

Representations: catalog card, use-only detail, guided training studio, test lab, permissions/share, versions/release, evaluation dashboard, privacy-safe analytics, compact workspace placement, and quick-chat agent chip. Historical rendering shows complete configuration and resource-version manifest but never unrelated usage sessions.

Collaboration applies to draft authoring, comments, and review. Publishing claims a stable draft version and runs eval/resource/permission gates. Concurrent draft edits use stable sections; behavior/instruction conflicts require review. Each real invocation belongs to the invoking user’s private thread/run; the artifact stores aggregate usage only.

AI assists with training questions, resource coverage, skill schemas, test cases, adversarial cases, prompt/behavior proposals, evaluation and release summaries. No interaction silently changes a published version. Improvements are proposals backed by aggregated categories, consented feedback, or synthetic eval failures.

Failures: revoked resource, invalid audience, leaked source in an eval, model/tool unavailable, regression, deprecated version, school policy change, owner leaves school. Each has a publish/use block or degraded state and recovery. Owner offboarding requires transfer/archive policy but never lets an editor delete by accident.

Migration exports old agent definitions/resources/collaborators for owner review; it does not automatically publish them. Old accessLevel/visibility/collaborators/model-list semantics map to draft migration warnings and new grants.

## Tasks

### AGART-01 Define content, immutable release, resource binding, skill, eval, feedback, and aggregate schemas

- [ ] Implemented
- [ ] Verified

### AGART-02 Build catalog/detail/training/test/permissions/versions/analytics and chat-chip representations

- [ ] Implemented
- [ ] Verified

### AGART-03 Implement draft collaboration, comments, publish gates, history, rollback, and owner-only deletion

- [ ] Implemented
- [ ] Verified

### AGART-04 Implement AI training, coverage, skill/eval generation, weakness analysis, and improvement proposals

- [ ] Implemented
- [ ] Verified

### AGART-05 Prove invocation privacy, source protection, audience revocation, and aggregate thresholds

- [ ] Implemented
- [ ] Verified

### AGART-06 Migrate old agents into reviewed drafts and remove old agent routes/schema/runtime

- [ ] Implemented
- [ ] Verified

### AGART-07 Prove accessibility, catalog scale, version pinning, regression blocks, and owner offboarding

- [ ] Implemented
- [ ] Verified
