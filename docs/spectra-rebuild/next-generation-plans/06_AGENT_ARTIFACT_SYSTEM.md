# Agent artifact system

This is a clean replacement built only after the entire legacy agent implementation is deleted: old routes/pages/components, Convex tables/functions, selected-agent state, collaborator/accessLevel model, mode/model heuristics, resource coupling, auto-matching, usage analytics, prompts, tests, and navigation do not migrate or remain behind adapters. The encrypted baseline is rollback evidence only, not an automatic import source.

## Core model

An agent is a versioned artifact definition, not a separate account, model, or conversation store. It combines identity/purpose, audience, instructions, resource-version bindings, tools/capabilities, behavioral policies, eval suites, and publication state. Each invocation creates or continues a private thread and run owned by the invoking user. Sharing the agent never shares those sessions back to the creator.

Every ordinary Spectra user—student, teacher, school admin, or superadmin—may create, use, modify when granted, and share agents. Teacher identity is not a creation gate. Future classes/groups make distribution and discussion easier but agent creation/routing cannot depend on them.

Only the original creator may delete the agent. A manager/editor may change drafts or publish if granted, but owner transfer and deletion are owner-only, audited workflows. Revoking use stops new invocations and access to the agent definition; existing private threads remain readable to their owners but can no longer invoke that version unless policy permits.

## Training experience

Creation is a guided conversation plus structured studio:

1. Intent: intended users, job, success and non-goals.
2. Expertise: connect permissioned, versioned resources; extract a coverage map and contradictions.
3. Behavior: teaching style, boundaries, refusal/escalation, citation expectations, allowed tools.
4. Skills: define reusable, schema-validated workflows rather than free-form hidden prompts.
5. Evaluation: generate representative cases, rubrics, adversarial/privacy tests, and required thresholds.
6. Test lab: creator-only synthetic sessions with traces, source use, scoring, latency/cost.
7. Publish review: audience, data use, resource rights, version notes, known limits.

AI proposes settings and explains effects; the creator confirms consequential choices. “Learning” from real interactions means aggregated feedback and candidate improvement proposals evaluated against suites. It does not mean silently editing the published prompt or training on private student conversations.

## Data model

- Agent artifact content: profile, purpose, audience intent, behaviors, boundaries, tool policy, output policy, routing descriptors.
- agentVersions: immutable published package with instruction hash, resource bindings, skill versions, eval baseline, model policy, compatibility, release notes.
- agentResourceBindings: resource/artifact/file ID, pinned or reviewed-update policy, allowed use, extraction status, audience compatibility.
- agentSkills: typed inputs, steps/tools, outputs, approvals, examples, failure policy.
- evalSuites/evalCases/evalRuns: fixtures, rubrics, scores, regressions, reviewer, privacy tags.
- agentFeedback: explicit rating/category/comment shared under a clear consent choice; no session content by default.
- agentUsageAggregates: invocations, success/latency/cost, feedback/eval categories, version, and permitted assigned-experience outcomes; no prompts, threads, memory, or unrelated artifacts and no small-cohort suppression requirement.
- improvementProposals: evidence category, proposed diff, expected impact, eval results, creator decision.

## Sharing and privacy

Audience grants: private, selected users, class/group, school, public catalog. Capabilities: view definition, use, comment/feedback, modify draft, manage publication. Use-only users see identity, creator, purpose, resource titles/license/provenance allowed for disclosure, version, permissions, limitations, and privacy statement—not protected instruction internals or resources they cannot independently access.

Invocation authority is the intersection of user rights, agent-version policy, resource binding rights, school policy, and tool capability. A shared agent cannot launder access to a restricted mark scheme or other protected resource unless policy explicitly permits its derived use; results must not reproduce protected source content. Resource rights are checked at publish and invocation. Revoked resources block or degrade affected versions with a visible health state.

Creators receive useful aggregate metrics without arbitrary small-cohort suppression, synthetic/consented feedback, eval results, resource-health alerts, and proposed improvements. Teachers see only analytics for agents they manage or explicit assigned learning experiences. Creators/admins never receive user prompt text, thread titles/content, artifact context, memory, or unrelated work merely because an agent was used.

## Selection and routing

The context manifest has separate fields for continuationThreadId, focus objects, active workspace, and selected/routedAgentVersionId. An explicit chip overrides routing. The router retrieves compact candidate descriptors on demand; it never injects every available agent or its instructions at startup. At medium-to-high confidence, it automatically selects a substantially better specialized agent without interrupting for confirmation. The chosen agent is visible and reversible and loads only its relevant instructions, skills, allowed tools, resource bindings, and specialized context. Low confidence uses ordinary Spectra. A continued thread normally retains its agent unless explicit selection or a strong, logged reason justifies a switch; any switch is visible.

Agents can be followed globally, placed in Inbox, placed in a workspace, or linked to a class. These are placements/subscriptions, not copies. Updating a published version does not silently change pinned historical sessions; the user can continue old compatible version or upgrade.

## Runtime and safety

Agent instructions are lower authority than Spectra system/policy rules. Retrieved resources are untrusted content. Tools use allowlisted typed capabilities, least privilege, approval rules, budgets, and audit. Defend against indirect prompt injection and data exfiltration following [OWASP guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) and evaluate with representative suites rather than only happy-path chat: [Anthropic evaluation guidance](https://platform.claude.com/docs/en/test-and-evaluate/eval-tool), [tool-use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works).

Unsafe or low-quality feedback does not directly alter behavior. Proposals run full regression, privacy, citation, jailbreak, and resource-leak suites. Publication supports draft, internal test, limited rollout, published, deprecated, suspended. Rollback selects a previous immutable version for new runs without deleting history.

## UI review

Match 13_agent_library.png and 14_agent_guided_creation.png extremely closely: searchable catalog/My agents/Shared/Discover, cards and Add state, creator/tags/reputation, persistent composer, six-step guided editor, purpose/outcomes/scope/tasks/clarification behavior, right Details/Activity, links, tags, draft/preview, and progressive disclosure. Add audience/use-right/version/privacy/resource health, evaluation/release/version flows, automatic-routing visibility, and every permission/error/revocation state without cluttering the main journey.

## Agent tasks

### AG-01 Remove the old agent table, routes, pages, permissions, utilities, and tests after migration export

- [ ] Implemented
- [ ] Verified

### AG-02 Register agent as a conforming artifact with owner-only deletion and immutable versions

- [ ] Implemented
- [ ] Verified

### AG-03 Build guided creation for every user: intent, audience, resource, behavior, skill, evaluation, and publish training matching the reference

- [ ] Implemented
- [ ] Verified

### AG-04 Implement versioned resource bindings, audience compatibility, revocation, and source protection

- [ ] Implemented
- [ ] Verified

### AG-05 Implement typed skills/tools, least privilege, approvals, budgets, and injection defenses

- [ ] Implemented
- [ ] Verified

### AG-06 Implement private invocation threads and prove creator/admin isolation from student sessions

- [ ] Implemented
- [ ] Verified

### AG-07 Implement audience grants, use/modify distinction, catalog discovery, follows, and placements

- [ ] Implemented
- [ ] Verified

### AG-08 Implement on-demand candidate retrieval, automatic medium/high-confidence routing without confirmation, visible reversible selection, low-confidence Spectra fallback, and strong-reason continuation switching

- [ ] Implemented
- [ ] Verified

### AG-09 Implement eval suites, test lab, staged publishing, rollback, and regression gates

- [ ] Implemented
- [ ] Verified

### AG-10 Implement consented feedback, privacy-safe aggregates, and evaluated improvement proposals

- [ ] Implemented
- [ ] Verified

### AG-11 Build library and studio responsive, accessible, empty/error/revoked-resource states

- [ ] Implemented
- [ ] Verified

### AG-12 Red-team resource leakage, prompt injection, harmful learning, version drift, and audience revocation

- [ ] Implemented
- [ ] Verified

### AG-13 Prove universal student/teacher/admin/superadmin creation and sharing parity plus unsuppressed useful analytics with zero private-content leakage

- [ ] Implemented
- [ ] Verified
