# Product decisions requiring review

Recommendations are defaults for planning, not silent authorization. “Can begin” means unaffected foundations may proceed; the choice must be resolved before the named dependent work ships.

## D-01 Tenant identity and multi-school membership

Question: can one user belong to several schools with one global identity?

Options: (A) one account, multiple memberships; strongest portability and correct operator model, more tenant-switching UX. (B) one account per school; simpler boundary, duplicate identity/memory and painful transfers. Recommendation: A, with memory explicitly scoped and an always-visible active school. Change: core user/org schema and navigation. Can begin: no—the identity migration depends on it.

## D-02 Platform operator entry into schools

Question: what authority does superadmin receive inside a school?

Options: (A) labeled, time-boxed operator session, read-only default, reason and explicit write elevation; accountable and least-privilege. (B) silent full impersonation; convenient but destroys audit meaning and privacy. (C) separate platform-only interface; safer but duplicates school management and violates the requested shared interface. Recommendation: A; do not impersonate students. Can begin: operator/session foundation yes; privileged actions wait for approval.

## D-03 Grant inheritance

Question: does workspace access grant access to placed artifacts?

Options: (A) no automatic inheritance; explicit/bulk grants, clear isolation but more sharing steps. (B) full inheritance; simple but easy leakage. (C) configurable artifact “inherit audience” flag with impact preview. Recommendation: C, default on for artifacts created in a shared workspace and explicit when placing existing private artifacts. Parent access never overrides stricter classification. Can begin: registry yes; sharing UX waits.

## D-04 Public sharing

Question: permit public artifacts/agents in the first release?

Options: disabled; school-only; or revocable public view/use links with school policy, expiry, non-indexed default. Recommendation: public only for agents and explicitly published artifacts after governance, abuse, copyright, moderation, and rate controls; disabled during foundation release. Can begin: yes.

## D-05 Artifact content storage

Question: one generic content store or type-specific stores?

Options: generic tagged blobs ease registry/migrations but weaken indexes; fully type-specific tables improve constraints but multiply infrastructure; hybrid base artifact plus typed content adapters/stores. Recommendation: hybrid. Can begin: no—registry/schema work depends on it.

## D-06 Collaboration provider

Question: self-host Yjs transport or use a managed collaboration service?

Options: managed reduces operational work but adds cost/vendor/data-region constraints; self-host provides control and Convex integration but requires gateway reliability; Automerge local-first is credible if offline becomes dominant. Recommendation: benchmark managed Yjs and self-hosted Yjs with Tiptap/whiteboard fixtures, decide on data region, 50-user load, reconnect, cost, and revocation. Keep adapter vendor-neutral. Can begin: adapters/prototype yes; production transport no.

## D-07 Offline editing promise

Question: is offline a launch guarantee?

Options: full local-first all suitable artifacts; opportunistic local draft/reconnect; online-first with explicit outage state. Recommendation: opportunistic for document/deck/task first, online-required for assessed submissions, publishing, code execution, integration refresh, and admin. Can begin: yes.

## D-08 Secret infrastructure

Question: which managed KMS/vault and deployment region?

Options depend on production cloud. Recommendation: envelope encryption with a managed secret service, rotation/audit, and secret references only in Convex. Do not implement application-managed encryption keys. Can begin: connector schemas yes; credential storage no.

## D-09 ManageBac scope

Question: initial integration breadth?

Options: broad all discovered categories; or narrow identity/classes/assignments/resources/timetable then CAS/assessments. Recommendation: capability-driven narrow pilot, adding only verified endpoints and policies. Current token remains read-only. Can begin: contract discovery yes.

## D-10 Memory defaults and retention

Question: opt-in versus on-by-default, and retention values?

Options: explicit opt-in maximizes trust but weak discovery; on-by-default with controls provides value but raises school/privacy concerns; school-configured default plus user control. Recommendation: opt-in pilot for inferred memory, explicit “remember” always available; school policy may disable categories but not force private inference. Proposed retention in 03. Can begin: schema/evals yes; capture no.

## D-11 School-admin safeguarding access

Question: should any workflow permit access to private student content?

Options: never through admin; narrowly defined safeguarding case with legal basis, dual authorization, notification policy, and audit; routine admin access. Recommendation: no routine access; design safeguarding separately only after legal/product review. Can begin: admin excluding such access yes.

## D-12 Analytics privacy threshold

Question: minimum cohort for teacher/creator/school analytics?

Options: 3, 5, 10, or differential-privacy mechanisms. Recommendation: suppress below 5 initially, aggregate time buckets, never expose prompts; evaluate higher thresholds for sensitive dimensions. Can begin: aggregate pipeline yes.

## D-13 Agent resource-derived use

Question: may use-only students benefit from teacher resources they cannot directly open?

Options: require direct resource access; allow derived answers under teacher/license policy with anti-extraction controls; forbid protected resources. Recommendation: allow explicit derived-use bindings with disclosure, citation rules, extraction tests, and no source reproduction; mark schemes require stricter policy. Can begin: resource binding model yes.

## D-14 Automatic agent selection

Question: can Spectra automatically choose a specialized agent?

Options: explicit only; suggest then user confirms; auto-select above confidence with visible override. Recommendation: suggestions first; later auto-select only after routing evals and user setting. Default remains Spectra. Can begin: explicit selection yes.

## D-15 Code runtimes and hosting

Question: which languages and whether published experiences receive URLs?

Options: browser-only TS/JS/HTML/CSS safest; remote isolated Python plus compiled runners expands learning; broad container execution maximizes flexibility and risk. Recommendation: browser React/TypeScript visualization runtime first, isolated Python second, compiled languages as versioned execution profiles; no public hosting until abuse/cost/privacy review. Can begin: file/editor/preview shell yes.

## D-16 Visualization authoring standard

Question: default generated stack?

Options: vanilla HTML/CSS/JS; React/TypeScript plus scoped utility tokens; language-neutral runtime SDK. Recommendation: React/TypeScript with Spectra component/tokens SDK and optional scoped Tailwind-compatible utilities; exported artifacts include locked dependencies. Can begin: SDK design waits for approval.

## D-17 Presentation export fidelity

Question: prioritize editable PPTX fidelity or Spectra-native presentation quality?

Options: native-first with PDF/video and best-effort PPTX; constrained slide model for high PPTX editability; dual advanced/native and portable modes. Recommendation: native-first plus documented PPTX fidelity tiers; do not limit the editor to PowerPoint’s common denominator. Can begin: scene model yes.

## D-18 Assessment/quiz boundary

Question: will Spectra support graded high-stakes assessment or learning/practice only initially?

Options: practice/formative; teacher-assigned with gradebook export; high-stakes proctored. Recommendation: practice and formative assignments first. High-stakes requires identity, accommodations, integrity, appeals, immutable submission, and regulatory work. Can begin: quiz product yes.

## D-19 Additional artifacts

Question: approve dataset and portfolio as first-class artifact types?

Options: features inside code/document; or first-class types. Recommendation: both. Dataset needs schema/profiling/range collaboration and reproducible visualizations; portfolio needs evidence/reflection/outcome structure and CAS provenance. Imported assessment remains an external record, class remains a workspace/context, and resource collection remains a library/view. Can begin: artifact registry yes.

## D-20 Version retention

Question: retention and storage tiers by plan/school?

Options: unlimited; fixed count/time; policy-based hot/cold with protected published/assessed versions. Recommendation: policy-based, with reference-counted assets and protected milestones; publish transparent quotas. Can begin: content-addressing yes.

## UI reference disposition

| Image | Decision | Required change |
|---|---|---|
| 01 mission control | adjust | permission/source states, role-aware nav, live run and narrow layouts |
| 02 superadmin | adjust | operator-session banner, freshness, incident/request drill-down; remove artifact-like actions |
| 03 school admin | adjust | governance, privacy thresholds, groups/classes, messaging, integration/audit depth |
| 04 ManageBac | adjust | verified capability matrix, credential rotation, identity queue, read-only overlay semantics |
| 05 agent library | keep/adjust | privacy/use-right/version health and explicit Use versus Add |
| 06 agent studio | adjust | guided training, evals, release/version flow, privacy-safe analytics |
| 07 presentation | keep/adjust | collaboration/history/export/present states and narrow layouts |
| 08 code visualization | replace key details | default React/TS runtime, sandbox status, files/dependencies; do not imply Python-only support |
| 09 whiteboard | keep/adjust | layers, large-board navigation, accessibility, AI region-conflict states |
| 10 timetable | adjust | source badges/overlays, timezone/recurrence, approval and conflict states |
| existing document/deck/quiz | preserve language, supplement | collaboration/history/embed/import/export and dense/narrow states |
| existing planner task | replace shell | bring into current Spectra shell and timetable/source model |

Regenerate/supplement before implementation: share/permission dialog; memory controls; version comparison; embed modes/no-access; human/AI conflict; ManageBac identity/quarantine preview; agent training/eval/publish; dataset; CAS portfolio; mobile/narrow/tiled variants; offline/reconnect/permission-lost states.

## Decision tasks

### PD-01 Review and record decisions D-01 through D-08 before foundation implementation

- [ ] Implemented
- [ ] Independently verified

### PD-02 Review and record decisions D-09 through D-14 before school/memory/agent pilots

- [ ] Implemented
- [ ] Independently verified

### PD-03 Review and record decisions D-15 through D-20 before rich-artifact release work

- [ ] Implemented
- [ ] Independently verified

### PD-04 Regenerate and approve the required UI references before frontend implementation

- [ ] Implemented
- [ ] Independently verified

### PD-05 Propagate each approved decision into schemas, plans, acceptance suites, and migration order

- [ ] Implemented
- [ ] Independently verified

