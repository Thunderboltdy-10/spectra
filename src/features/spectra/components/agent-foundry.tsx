"use client";

/**
 * Agent Foundry
 * Phase 10 §10.1–§10.14 — replaces the fixed six-step wizard.
 *
 * The surface has three regions: the foundation and adaptive build stream on
 * the left, the competence ledger on the right, and the release strip beneath.
 * Nothing here is a numbered wizard step; which sections exist is decided by
 * the mission, and every one of them can be dismissed and restored.
 */

import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleSlash,
  FlaskConical,
  Loader2,
  Plus,
  RotateCcw,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addSection,
  answerSection,
  assessSufficiency,
  compileRuntimePackage,
  compilerProgress,
  compilerStatusLabel,
  detectSkillOverlap,
  dismissSection,
  isEmptyValue,
  normalizeFoundryContent,
  planFacetWeights,
  projectFoundryToLegacy,
  restoreSection,
  skillIssues,
  summarizeEvidence,
  type AgentFoundryContent,
  type EvidenceBinding,
  type EvidenceExtraction,
  type FoundryFacet,
  type FoundrySection,
  type FoundrySectionValue,
  type SpectraSkill,
} from "../agents/foundry";
import {
  compileSpectraAgentFoundation,
  compileSpectraFoundrySkills,
  evaluateSpectraAgent,
  extractSpectraFoundryEvidence,
  getSpectraAgentEvalRuns,
  getSpectraAgentReleases,
  getSpectraFoundryCompilerJob,
  manageSpectraAgentRelease,
  nextSpectraFoundrySection,
  publishSpectraAgent,
  type SpectraAgentEvalRun,
  type SpectraAgentRelease,
  type SpectraArtifact,
  type SpectraFoundryCompilerJob,
} from "../data/api";
import { LocalAutocompleteTextarea } from "../compute/autocomplete";
import { aiRegionAttr, pathTouches } from "./ai-region-path";
import { ArtifactWorkbar, WorkbarRail } from "./artifact-workbar";
import { targetAttrs } from "../collaboration/target-attributes";

const FACET_LABEL: Record<FoundryFacet, string> = {
  objective: "Objective",
  interaction: "Manner",
  inputs: "Given material",
  outputs: "Correct result",
  criteria: "Judgement",
  evidence: "Source material",
  procedure: "Method",
  boundaries: "Limits",
  tools: "Capabilities",
  calibration: "Worked examples",
  evaluation: "Checks",
};

const TOOL_CHOICES = [
  { id: "artifact_search", label: "Find work", detail: "Search what the person asking can already see" },
  { id: "artifact_read", label: "Read work", detail: "Open and quote permissioned items" },
  { id: "artifact_create", label: "Create work", detail: "Start new typed Spectra work" },
  { id: "artifact_edit", label: "Edit work", detail: "Propose region-safe changes" },
  { id: "web_search", label: "Search the web", detail: "Look things up outside Spectra" },
  { id: "code_execution", label: "Run code", detail: "Compute in a sandbox" },
  { id: "file_analysis", label: "Read files", detail: "Analyse uploaded documents" },
] as const;

const EVIDENCE_KINDS = [
  { id: "rubric", label: "Rubric or mark scheme" },
  { id: "policy", label: "Policy or standard" },
  { id: "manual", label: "Manual or handbook" },
  { id: "annotated_work", label: "Marked work" },
  { id: "accepted_example", label: "Good example" },
  { id: "rejected_example", label: "Poor example" },
  { id: "source_document", label: "Reference document" },
] as const;

function identifier(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "That did not work.";
}

/* ------------------------------------------------------------------ */
/* Competence ledger — the one loud element on this surface            */
/* ------------------------------------------------------------------ */

function CompetenceLedger({
  content,
  skills,
  evidence,
}: {
  content: AgentFoundryContent;
  skills: SpectraSkill[];
  evidence: EvidenceBinding[];
}) {
  const weights = useMemo(
    () => planFacetWeights(content.foundry.mission),
    [content.foundry.mission],
  );
  const sufficiency = useMemo(
    () => assessSufficiency(content.foundry.mission, content.foundry.state),
    [content.foundry.mission, content.foundry.state],
  );
  const evidenceSummary = useMemo(() => summarizeEvidence(evidence), [evidence]);

  const rows = sufficiency.pursuedFacets
    .map((facet) => ({
      facet,
      weight: weights.get(facet) ?? 0,
      covered: !sufficiency.missingFacets.includes(facet),
    }))
    .sort((left, right) => right.weight - left.weight);

  const maxWeight = rows.reduce((high, row) => Math.max(high, row.weight), 1);

  const gaps: string[] = [];
  for (const facet of sufficiency.missingFacets) {
    gaps.push(`${FACET_LABEL[facet]} is not established.`);
  }
  if (skills.length === 0) {
    gaps.push("No skills compiled, so the agent has nothing specific to do.");
  }
  for (const skill of skills) {
    for (const issue of skillIssues(skill)) gaps.push(issue);
  }
  for (const overlap of detectSkillOverlap(skills)) {
    gaps.push(
      `Two skills answer the same requests (${Math.round(overlap.overlap * 100)}% overlap).`,
    );
  }
  if (evidenceSummary.securityConcerns > 0) {
    gaps.push(
      `${evidenceSummary.securityConcerns} instruction-like passage${evidenceSummary.securityConcerns === 1 ? "" : "s"} in your sources were quarantined.`,
    );
  }
  if (evidenceSummary.unresolvedContradictions > 0) {
    gaps.push(
      `${evidenceSummary.unresolvedContradictions} contradiction${evidenceSummary.unresolvedContradictions === 1 ? "" : "s"} between sources are unresolved.`,
    );
  }

  return (
    <aside className="foundry-ledger" aria-label="What this agent knows">
      <header className="foundry-ledger-head">
        <span className="foundry-ledger-eyebrow">Competence</span>
        <span className="foundry-ledger-figure">
          {Math.round(sufficiency.coverage * 100)}
          <span className="foundry-ledger-unit">%</span>
        </span>
      </header>

      <ul className="foundry-ledger-rows">
        {rows.map((row) => (
          <li
            key={row.facet}
            className={`foundry-ledger-row${row.covered ? " is-covered" : ""}`}
          >
            <span className="foundry-ledger-name">{FACET_LABEL[row.facet]}</span>
            <span className="foundry-ledger-bar" aria-hidden>
              <span
                className="foundry-ledger-bar-track"
                style={{ width: `${(row.weight / maxWeight) * 100}%` }}
              >
                <span className="foundry-ledger-bar-fill" />
              </span>
            </span>
            <span className="foundry-ledger-weight">{row.weight}</span>
          </li>
        ))}
      </ul>

      {sufficiency.notApplicable.length > 0 && (
        <p className="foundry-ledger-note">
          Not pursued for this mission:{" "}
          {sufficiency.notApplicable.map((facet) => FACET_LABEL[facet]).join(", ")}.
        </p>
      )}

      <section className="foundry-ledger-block">
        <h4>Holdings</h4>
        <dl className="foundry-ledger-stats">
          <div>
            <dt>Skills</dt>
            <dd>{skills.length}</dd>
          </div>
          <div>
            <dt>Sources</dt>
            <dd>{evidenceSummary.sourceCount}</dd>
          </div>
          <div>
            <dt>Criteria</dt>
            <dd>{evidenceSummary.criteriaCount}</dd>
          </div>
          <div>
            <dt>Rules</dt>
            <dd>{evidenceSummary.ruleCount}</dd>
          </div>
        </dl>
      </section>

      <section className="foundry-ledger-block">
        <h4>Can&rsquo;t do yet</h4>
        {gaps.length === 0 ? (
          <p className="foundry-ledger-clear">
            Nothing outstanding. The agent does what the mission describes.
          </p>
        ) : (
          <ul className="foundry-gap-list">
            {gaps.slice(0, 8).map((gap, index) => (
              <li key={index}>{gap}</li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Section editors                                                     */
/* ------------------------------------------------------------------ */

function SectionEditor({
  section,
  draft,
  onDraft,
  disabled,
  artifacts,
}: {
  section: FoundrySection;
  draft: FoundrySectionValue;
  onDraft: (value: FoundrySectionValue) => void;
  disabled: boolean;
  artifacts: SpectraArtifact[];
}) {
  if (section.kind === "work_reference") {
    const selected = draft.kind === "works" ? draft.workIds : [];
    return (
      <ul className="foundry-choices">
        {artifacts.slice(0, 40).map((artifact) => {
          const active = selected.includes(artifact._id);
          return (
            <li key={artifact._id}>
              <button
                type="button"
                className={`foundry-choice${active ? " is-active" : ""}`}
                disabled={disabled}
                onClick={() =>
                  onDraft({
                    kind: "works",
                    workIds: active
                      ? selected.filter((id) => id !== artifact._id)
                      : [...selected, artifact._id],
                  })
                }
              >
                <span className="foundry-choice-label">{artifact.title}</span>
                <span className="foundry-choice-detail">
                  {artifact.blueprintKey.replaceAll("_", " ")}
                </span>
                {active && <Check size={14} className="foundry-choice-mark" />}
              </button>
            </li>
          );
        })}
        {artifacts.length === 0 && (
          <li className="foundry-empty">Nothing in this workspace to link yet.</li>
        )}
      </ul>
    );
  }

  if (section.kind === "permission_selection") {
    const selected = draft.kind === "permissions" ? draft.toolIds : [];
    return (
      <ul className="foundry-choices">
        {TOOL_CHOICES.map((tool) => {
          const active = selected.includes(tool.id);
          return (
            <li key={tool.id}>
              <button
                type="button"
                className={`foundry-choice${active ? " is-active" : ""}`}
                disabled={disabled}
                onClick={() =>
                  onDraft({
                    kind: "permissions",
                    toolIds: active
                      ? selected.filter((id) => id !== tool.id)
                      : [...selected, tool.id],
                  })
                }
              >
                <span className="foundry-choice-label">{tool.label}</span>
                <span className="foundry-choice-detail">{tool.detail}</span>
                {active && <Check size={14} className="foundry-choice-mark" />}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  if (section.kind === "example_pair") {
    const pairs = draft.kind === "examples" ? draft.pairs : [];
    return (
      <div className="foundry-pairs">
        {pairs.map((pair, index) => (
          <div key={pair.id} className="foundry-pair">
            <div className="foundry-pair-head">
              <span>Example {index + 1}</span>
              <button
                type="button"
                className="foundry-icon-button"
                disabled={disabled}
                aria-label={`Remove example ${index + 1}`}
                onClick={() =>
                  onDraft({
                    kind: "examples",
                    pairs: pairs.filter((entry) => entry.id !== pair.id),
                  })
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
            <textarea
              className="foundry-input"
              rows={3}
              placeholder="What comes in"
              value={pair.input}
              disabled={disabled}
              onChange={(event) =>
                onDraft({
                  kind: "examples",
                  pairs: pairs.map((entry) =>
                    entry.id === pair.id
                      ? { ...entry, input: event.target.value }
                      : entry,
                  ),
                })
              }
            />
            <textarea
              className="foundry-input"
              rows={4}
              placeholder="What you would produce from it"
              value={pair.output}
              disabled={disabled}
              onChange={(event) =>
                onDraft({
                  kind: "examples",
                  pairs: pairs.map((entry) =>
                    entry.id === pair.id
                      ? { ...entry, output: event.target.value }
                      : entry,
                  ),
                })
              }
            />
          </div>
        ))}
        <button
          type="button"
          className="foundry-ghost-button"
          disabled={disabled}
          onClick={() =>
            onDraft({
              kind: "examples",
              pairs: [
                ...pairs,
                { id: identifier("pair"), input: "", output: "" },
              ],
            })
          }
        >
          <Plus size={14} />
          Add an example
        </button>
      </div>
    );
  }

  if (
    (section.kind === "single_choice" || section.kind === "multi_choice") &&
    section.options?.length
  ) {
    const value = draft.kind === "choice" ? draft : { kind: "choice" as const, selected: [] };
    const multi = section.kind === "multi_choice" || section.multiSelect === true;
    return (
      <>
        <ul className="foundry-choices">
          {section.options.map((option) => {
            const active = value.selected.includes(option.id);
            return (
              <li key={option.id}>
                <button
                  type="button"
                  className={`foundry-choice${active ? " is-active" : ""}${option.recommended ? " is-recommended" : ""}`}
                  disabled={disabled}
                  onClick={() =>
                    onDraft({
                      ...value,
                      kind: "choice",
                      selected: multi
                        ? active
                          ? value.selected.filter((id) => id !== option.id)
                          : [...value.selected, option.id]
                        : [option.id],
                    })
                  }
                >
                  <span className="foundry-choice-label">{option.label}</span>
                  {option.detail && (
                    <span className="foundry-choice-detail">{option.detail}</span>
                  )}
                  {active && <Check size={14} className="foundry-choice-mark" />}
                </button>
              </li>
            );
          })}
        </ul>
        {section.allowOther !== false && (
          <input
            className="foundry-input"
            placeholder="Something else"
            value={value.other ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onDraft({ ...value, kind: "choice", other: event.target.value })
            }
          />
        )}
      </>
    );
  }

  if (section.kind === "evidence_confirmation") {
    const accepted = draft.kind === "confirmation" ? draft.accepted : false;
    return (
      <div className="foundry-confirm">
        <button
          type="button"
          className={`foundry-choice${accepted ? " is-active" : ""}`}
          disabled={disabled}
          onClick={() => onDraft({ kind: "confirmation", accepted: true })}
        >
          <span className="foundry-choice-label">That is right</span>
        </button>
        <button
          type="button"
          className={`foundry-choice${draft.kind === "confirmation" && !accepted ? " is-active" : ""}`}
          disabled={disabled}
          onClick={() => onDraft({ kind: "confirmation", accepted: false })}
        >
          <span className="foundry-choice-label">Not quite</span>
        </button>
      </div>
    );
  }

  const text = draft.kind === "text" ? draft.text : "";
  return (
    <LocalAutocompleteTextarea
      className="foundry-textarea"
      textareaClassName="foundry-input"
      surface="agent_foundry"
      rows={section.kind === "long_text" ? 5 : 2}
      value={text}
      disabled={disabled}
      placeholder="In your own words"
      onValueChange={(next) => onDraft({ kind: "text", text: next })}
    />
  );
}

function summarizeValue(value: FoundrySectionValue): string {
  switch (value.kind) {
    case "text":
      return value.text.trim();
    case "choice":
      return [...value.selected, value.other].filter(Boolean).join(", ");
    case "examples":
      return `${value.pairs.length} worked example${value.pairs.length === 1 ? "" : "s"}`;
    case "permissions":
      return value.toolIds
        .map(
          (id) => TOOL_CHOICES.find((tool) => tool.id === id)?.label ?? id,
        )
        .join(", ");
    case "confirmation":
      return value.accepted ? "Confirmed" : "Marked as not quite right";
    case "files":
      return `${value.fileIds.length} file${value.fileIds.length === 1 ? "" : "s"}`;
    case "works":
      return `${value.workIds.length} linked item${value.workIds.length === 1 ? "" : "s"}`;
    case "skills":
      return `${value.approvedSkillIds.length} skill${value.approvedSkillIds.length === 1 ? "" : "s"} approved`;
    case "empty":
      return "";
  }
}

/* ------------------------------------------------------------------ */
/* Foundry                                                             */
/* ------------------------------------------------------------------ */

/**
 * Compilation status (§10.8). Background compiler work is an internal durable
 * run: it is reported here, inside the surface that started it, and never as a
 * Live Dock tab. Quiet by default — one line and a rule — and only opens into
 * the stage list while work is in flight or something needs attention.
 */
function CompilerTrace({
  job,
  running,
}: {
  job: SpectraFoundryCompilerJob | null;
  running: boolean;
}) {
  if (!job && !running) return null;

  const view = job ?? {
    status: "running" as const,
    stages: [] as SpectraFoundryCompilerJob["stages"],
  };
  const progress = running && !job ? 0 : compilerProgress(view);
  const label = running && !job ? "Starting" : compilerStatusLabel(view);
  const problems = (job?.diagnostics ?? []).filter(
    (entry) => entry.severity === "error" || entry.severity === "warning",
  );
  const detailed =
    running ||
    job?.status === "running" ||
    job?.status === "failed" ||
    problems.length > 0;

  return (
    <section
      className={`foundry-compile is-${job?.status ?? "running"}`}
      aria-live="polite"
    >
      <div className="foundry-compile-head">
        <span className="foundry-compile-label">{label}</span>
        {job?.stale && job.status === "completed" && (
          <span className="foundry-compile-stale">
            The draft changed after this build
          </span>
        )}
      </div>
      <div
        className="foundry-compile-rule"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-label="Compilation progress"
      >
        <span style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>

      {detailed && job && (
        <ol className="foundry-compile-stages">
          {job.stages.map((stage) => (
            <li key={stage.stage} className={`is-${stage.status}`}>
              <span className="foundry-compile-stage-label">{stage.label}</span>
              <span className="foundry-compile-stage-detail">
                {stage.error ??
                  stage.detail ??
                  (stage.status === "skipped" ? "Not needed" : "")}
              </span>
            </li>
          ))}
        </ol>
      )}

      {problems.length > 0 && (
        <ul className="foundry-compile-problems">
          {problems.slice(0, 6).map((entry, index) => (
            <li key={index} className={`is-${entry.severity}`}>
              {entry.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AgentFoundry({
  artifactId,
  artifactTitle,
  mode,
  artifacts,
  content,
  onChange,
  aiChangedPaths = [],
  readOnly = false,
  canPublish = false,
  onActiveRegionChange,
}: {
  artifactId: string;
  artifactTitle: string;
  mode: "split" | "tab";
  artifacts: SpectraArtifact[];
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
  readOnly?: boolean;
  canPublish?: boolean;
  onActiveRegionChange?: (regionId: string) => void;
}) {
  const normalized = useMemo(() => normalizeFoundryContent(content), [content]);
  const [agent, setAgent] = useState(normalized);
  useEffect(() => setAgent(normalized), [normalized]);

  const [objective, setObjective] = useState("");
  const [interaction, setInteraction] = useState("");
  const [drafts, setDrafts] = useState<Record<string, FoundrySectionValue>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [proposed, setProposed] = useState<SpectraSkill[]>([]);
  const [evidenceText, setEvidenceText] = useState("");
  const [evidenceLabel, setEvidenceLabel] = useState("");
  const [evidenceKind, setEvidenceKind] =
    useState<EvidenceBinding["kind"]>("rubric");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [releases, setReleases] = useState<SpectraAgentRelease[]>([]);
  const [evalRuns, setEvalRuns] = useState<SpectraAgentEvalRun[]>([]);
  const [currentHash, setCurrentHash] = useState("");
  const [showDismissed, setShowDismissed] = useState(false);
  const [compilerJob, setCompilerJob] =
    useState<SpectraFoundryCompilerJob | null>(null);
  const streamEnd = useRef<HTMLDivElement>(null);

  const foundry = agent.foundry;
  const established = foundry.foundationEstablished;

  useEffect(() => {
    onActiveRegionChange?.(established ? "build" : "foundation");
  }, [established, onActiveRegionChange]);

  useEffect(() => {
    let active = true;
    void getSpectraAgentReleases(artifactId)
      .then((response) => active && setReleases(response.releases))
      .catch(() => undefined);
    if (!readOnly)
      void getSpectraAgentEvalRuns(artifactId)
        .then((response) => {
          if (!active) return;
          setEvalRuns(response.runs);
          setCurrentHash(response.currentContentHash);
        })
        .catch(() => undefined);
    // The last compilation is state the creator left behind, not a Live Dock
    // tab, so it is restored with the surface (§10.8).
    if (!readOnly)
      void getSpectraFoundryCompilerJob(artifactId)
        .then((response) => active && setCompilerJob(response.job))
        .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [artifactId, readOnly]);

  const commit = useCallback(
    (next: AgentFoundryContent) => {
      if (readOnly) return;
      const projected = projectFoundryToLegacy(next);
      setAgent(projected);
      onChange(projected);
    },
    [onChange, readOnly],
  );

  const patchFoundry = useCallback(
    (patch: Partial<AgentFoundryContent["foundry"]>) => {
      commit({ ...agent, foundry: { ...agent.foundry, ...patch } });
    },
    [agent, commit],
  );

  async function run<T>(key: string, task: () => Promise<T>) {
    setBusy(key);
    setProblem(undefined);
    try {
      return await task();
    } catch (error) {
      setProblem(errorText(error));
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  /* -------------------- foundation -------------------- */

  async function establishFoundation() {
    const result = await run("foundation", () =>
      compileSpectraAgentFoundation({ agentId: artifactId, objective, interaction }),
    );
    if (!result) return;

    const missionSource = { ...agent, foundry: { ...agent.foundry } };
    const next = normalizeFoundryContent({
      ...missionSource,
      foundry: {
        ...missionSource.foundry,
        mission: result.mission,
        foundationEstablished: true,
      },
    });
    commit(next);
    if (Array.isArray(result.securityConcerns) && result.securityConcerns.length > 0) {
      setNotice(
        `${result.securityConcerns.length} instruction-like passage${result.securityConcerns.length === 1 ? "" : "s"} in your description were quarantined. They did not become agent policy.`,
      );
    }
    await requestSection(next);
  }

  /* -------------------- adaptive sections -------------------- */

  const requestSection = useCallback(
    async (base?: AgentFoundryContent) => {
      const result = await run("next", () => nextSpectraFoundrySection(artifactId));
      if (!result) return;
      const source = base ?? agent;
      if (result.sufficient || !result.section) {
        setNotice(
          "The mission is covered. Compile the agent, or add anything else you want it to know.",
        );
        return;
      }
      const section = result.section as FoundrySection;
      commit({
        ...source,
        foundry: {
          ...source.foundry,
          state: addSection(
            source.foundry.state,
            {
              ...section,
              value: { kind: "empty" },
              status: "open",
            },
            Date.now(),
          ),
        },
      });
      window.requestAnimationFrame(() =>
        streamEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
      );
    },
    [agent, artifactId, commit],
  );

  function saveSection(section: FoundrySection) {
    const draft = drafts[section.id] ?? section.value;
    if (isEmptyValue(draft)) return;
    patchFoundry({
      state: answerSection(foundry.state, section.id, draft, Date.now()),
    });
    setDrafts((current) => {
      const next = { ...current };
      delete next[section.id];
      return next;
    });
    void requestSection();
  }

  /* -------------------- evidence -------------------- */

  async function attachEvidence() {
    const label = evidenceLabel.trim() || "Source";
    const text = evidenceText.trim();
    if (!text) return;

    const sourceId = identifier("src");
    const result = await run("evidence", () =>
      extractSpectraFoundryEvidence({
        agentId: artifactId,
        sourceId,
        kind: evidenceKind,
        text,
      }),
    );
    if (!result) return;

    const extraction = result.extraction as EvidenceExtraction;
    const binding: EvidenceBinding = {
      id: identifier("evidence"),
      sourceId,
      kind: evidenceKind,
      label,
      confirmed: false,
      extraction,
    };
    patchFoundry({ evidenceBindings: [...foundry.evidenceBindings, binding] });
    setEvidenceText("");
    setEvidenceLabel("");
    setEvidenceOpen(false);
    if (extraction.securityConcerns.length > 0) {
      setNotice(
        `${extraction.securityConcerns.length} passage${extraction.securityConcerns.length === 1 ? "" : "s"} in "${label}" addressed the assistant directly. They were quarantined and did not become agent policy.`,
      );
    }
  }

  function confirmEvidence(bindingId: string, confirmed: boolean) {
    patchFoundry({
      evidenceBindings: foundry.evidenceBindings.map((binding) =>
        binding.id === bindingId ? { ...binding, confirmed } : binding,
      ),
    });
  }

  function removeEvidence(bindingId: string) {
    patchFoundry({
      evidenceBindings: foundry.evidenceBindings.filter(
        (binding) => binding.id !== bindingId,
      ),
      skills: foundry.skills.map((skill) => ({
        ...skill,
        evidenceBindings: skill.evidenceBindings.filter(
          (reference) => reference.bindingId !== bindingId,
        ),
      })),
    });
  }

  /* -------------------- compile -------------------- */

  async function compile() {
    const result = await run("compile", () =>
      compileSpectraFoundrySkills(artifactId),
    );
    // Whether or not compilation succeeded, the job record explains what
    // happened, so read it back either way.
    void getSpectraFoundryCompilerJob(artifactId)
      .then((response) => setCompilerJob(response.job))
      .catch(() => undefined);
    if (!result) return;
    setProposed(result.skills as SpectraSkill[]);
    commit({
      ...agent,
      routing: {
        ...agent.routing,
        description: result.routing.description || agent.routing.description,
        examples: result.routing.examples.length
          ? result.routing.examples
          : agent.routing.examples,
        negativeExamples: result.routing.negativeExamples.length
          ? result.routing.negativeExamples
          : agent.routing.negativeExamples,
      },
      foundry: {
        ...agent.foundry,
        draftReleaseNotes: result.releaseNotes || agent.foundry.draftReleaseNotes,
      },
    });
    setNotice(
      `${result.skills.length} skill${result.skills.length === 1 ? "" : "s"} drafted. Approve the ones that match how you work.`,
    );
  }

  function acceptSkill(skill: SpectraSkill) {
    const existing = foundry.skills.find((entry) => entry.id === skill.id);
    const merged: SpectraSkill = existing
      ? { ...skill, version: existing.version + 1, supersedesVersion: existing.version }
      : skill;
    patchFoundry({
      skills: [
        ...foundry.skills.filter((entry) => entry.id !== skill.id),
        { ...merged, status: "verified" },
      ],
    });
    setProposed((current) => current.filter((entry) => entry.id !== skill.id));
  }

  function rejectSkill(skillId: string) {
    setProposed((current) => current.filter((entry) => entry.id !== skillId));
  }

  /* -------------------- release -------------------- */

  const runtimePackage = useMemo(
    () =>
      compileRuntimePackage({
        releaseId: "draft",
        agentId: artifactId,
        releaseNumber: (releases[0]?.releaseNumber ?? 0) + 1,
        contentHash: currentHash || "draft",
        mission: foundry.mission,
        skills: foundry.skills,
        evidenceBindings: foundry.evidenceBindings,
        toolGrants: agent.tools
          .filter((tool) => tool.enabled)
          .map((tool) => ({
            toolId: tool.key,
            approval:
              tool.approval === "always"
                ? ("always" as const)
                : tool.approval === "never"
                  ? ("never" as const)
                  : ("policy" as const),
            scopedToSkillIds: [],
          })),
        modelPolicy: { mode: "spectra_default", allowFallback: true },
        semanticProfileRef: `agent:${artifactId}`,
        // Draft package: display-only, never persisted, so the clock is not read
        // during render.
        compiledAt: 0,
      }),
    [
      agent.tools,
      artifactId,
      currentHash,
      foundry.evidenceBindings,
      foundry.mission,
      foundry.skills,
      releases,
    ],
  );

  const passingEval = evalRuns.some(
    (entry) =>
      entry.status === "passed" &&
      Boolean(currentHash) &&
      entry.contentHash === currentHash,
  );

  const publishBlockers = useMemo(() => {
    const blocked: string[] = [];
    if (!foundry.mission.objective.trim())
      blocked.push("The mission has no objective.");
    if ((agent.instructions?.text ?? "").trim().length < 40)
      blocked.push("The approved mission and skills need more actionable detail.");
    if (foundry.skills.length === 0)
      blocked.push("No skills are approved, so there is nothing to publish.");
    for (const skill of foundry.skills) blocked.push(...skillIssues(skill));
    if (!passingEval)
      blocked.push("No evaluation has passed against the current draft.");
    for (const binding of foundry.evidenceBindings) {
      if (binding.extraction && !binding.confirmed) {
        blocked.push(`"${binding.label}" has not been confirmed as read correctly.`);
      }
    }
    return [...new Set(blocked)];
  }, [agent.instructions?.text, foundry.evidenceBindings, foundry.mission.objective, foundry.skills, passingEval]);

  async function evaluate() {
    const result = await run("evaluate", () => evaluateSpectraAgent(artifactId));
    if (!result) return;
    const runs = await getSpectraAgentEvalRuns(artifactId).catch(() => null);
    if (runs) {
      setEvalRuns(runs.runs);
      setCurrentHash(runs.currentContentHash);
    }
    setNotice(
      result.status === "passed"
        ? `Passed ${result.passedCount} of ${result.caseCount} checks.`
        : `Failed. ${result.passedCount} of ${result.caseCount} checks passed.`,
    );
  }

  async function publish() {
    const result = await run("publish", () =>
      publishSpectraAgent(artifactId, foundry.draftReleaseNotes || undefined),
    );
    if (!result) return;
    const list = await getSpectraAgentReleases(artifactId).catch(() => null);
    if (list) setReleases(list.releases);
    setNotice(`Release ${result.releaseNumber} published.`);
  }

  async function rollback(releaseId: string) {
    const result = await run("rollback", () =>
      manageSpectraAgentRelease(releaseId, "rollback"),
    );
    if (!result) return;
    const list = await getSpectraAgentReleases(artifactId).catch(() => null);
    if (list) setReleases(list.releases);
    setNotice("Rolled back to the previous release.");
  }

  /* -------------------- render -------------------- */

  const open = foundry.state.sections.filter(
    (section) => section.status === "open",
  );
  const answered = foundry.state.sections.filter(
    (section) => section.status === "answered",
  );
  const dismissed = foundry.state.sections.filter(
    (section) => section.status === "dismissed",
  );

  if (!established) {
    return (
      <div className={`spectra-agent-foundry is-${mode} is-foundation`}>
        <div className="foundry-foundation">
          <p className="foundry-eyebrow">New specialist</p>
          <h2 className="foundry-title">{artifactTitle || "Untitled agent"}</h2>
          <p className="foundry-lede">
            Two answers set the foundation. Everything after them is decided by
            what you say here — there is no fixed set of steps.
          </p>

          <label className="foundry-question">
            <span className="foundry-question-prompt">
              What should this agent do?
            </span>
            <LocalAutocompleteTextarea
              className="foundry-textarea"
              textareaClassName="foundry-input"
              surface="agent_foundry"
              rows={5}
              value={objective}
              onValueChange={setObjective}
              disabled={readOnly || busy === "foundation"}
              placeholder="Mark Year 11 history essays against our department rubric and write feedback the student can act on."
            />
          </label>

          <label className="foundry-question">
            <span className="foundry-question-prompt">
              How should it feel to work with?
            </span>
            <LocalAutocompleteTextarea
              className="foundry-textarea"
              textareaClassName="foundry-input"
              surface="agent_foundry"
              rows={3}
              value={interaction}
              onValueChange={setInteraction}
              disabled={readOnly || busy === "foundation"}
              placeholder="Direct and specific. It should never soften a weak argument."
            />
          </label>

          {problem && (
            <p className="foundry-problem">
              <AlertTriangle size={14} />
              {problem}
            </p>
          )}

          <button
            type="button"
            className="foundry-primary"
            disabled={readOnly || busy === "foundation" || objective.trim().length < 10}
            onClick={() => void establishFoundation()}
          >
            {busy === "foundation" ? (
              <>
                <Loader2 size={15} className="foundry-spin" />
                Reading what you wrote
              </>
            ) : (
              <>
                Set the foundation
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`spectra-agent-foundry is-${mode}`}>
      <ArtifactWorkbar label="Agent tools">
        <WorkbarRail>
          <span className="px-1 text-[12px] font-medium text-[var(--text-secondary)]">Build</span>
        </WorkbarRail>
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-[6px] px-2.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45"
          disabled={readOnly || busy === "next"}
          onClick={() => void requestSection()}
        >
          {busy === "next" ? "Working…" : "Continue"}
        </button>
        <button
          type="button"
          className="spectra-workbar-primary inline-flex h-8 items-center rounded-[6px] bg-[var(--text-primary)] px-2.5 text-[11px] font-semibold text-[var(--bg-primary)] disabled:opacity-45"
          disabled={readOnly || busy === "compile"}
          onClick={() => void compile()}
        >
          {busy === "compile" ? "Drafting…" : "Compile skills"}
        </button>
      </ArtifactWorkbar>
      <div
        className="foundry-stream"
        data-ai-region={aiRegionAttr(pathTouches(aiChangedPaths, "/foundry"))}
      >
        <header className="foundry-mission" {...targetAttrs("/foundry/mission")}>
          <p className="foundry-eyebrow">Mission</p>
          <p
            className={`foundry-mission-objective${pathTouches(aiChangedPaths, "/foundry/mission") ? " is-ai-changed" : ""}`}
          >
            {foundry.mission.objective}
          </p>
          <ul className="foundry-mission-facts">
            {foundry.mission.domains.slice(0, 4).map((domain) => (
              <li key={domain}>{domain}</li>
            ))}
            {foundry.mission.intendedUsers.slice(0, 2).map((user) => (
              <li key={user} className="is-muted">
                for {user}
              </li>
            ))}
          </ul>
        </header>

        {notice && (
          <p className="foundry-notice">
            {notice}
            <button
              type="button"
              className="foundry-icon-button"
              aria-label="Dismiss"
              onClick={() => setNotice(undefined)}
            >
              <X size={13} />
            </button>
          </p>
        )}
        {problem && (
          <p className="foundry-problem">
            <AlertTriangle size={14} />
            {problem}
          </p>
        )}

        {answered.map((section) => {
          const editing = drafts[section.id] !== undefined;
          return (
            <article
              key={section.id}
              className="foundry-section is-answered"
              {...targetAttrs(`/foundry/sections/${section.id}`)}
            >
              <div className="foundry-section-head">
                <p className="foundry-section-facet">{FACET_LABEL[section.facet]}</p>
                <div className="foundry-section-actions">
                  <button
                    type="button"
                    className="foundry-text-button"
                    disabled={readOnly}
                    onClick={() =>
                      setDrafts((current) =>
                        editing
                          ? (() => {
                              const next = { ...current };
                              delete next[section.id];
                              return next;
                            })()
                          : { ...current, [section.id]: section.value },
                      )
                    }
                  >
                    {editing ? "Cancel" : "Change"}
                  </button>
                </div>
              </div>
              <p className="foundry-section-prompt">{section.prompt}</p>
              {editing ? (
                <>
                  <SectionEditor
                    section={section}
                    draft={drafts[section.id]!}
                    onDraft={(value) =>
                      setDrafts((current) => ({ ...current, [section.id]: value }))
                    }
                    disabled={readOnly}
                    artifacts={artifacts}
                  />
                  <button
                    type="button"
                    className="foundry-primary is-compact"
                    disabled={readOnly}
                    onClick={() => saveSection(section)}
                  >
                    Save
                  </button>
                </>
              ) : (
                <p className="foundry-section-answer">{summarizeValue(section.value)}</p>
              )}
            </article>
          );
        })}

        {open.map((section) => (
          <article
            key={section.id}
            className="foundry-section is-open"
            {...targetAttrs(`/foundry/sections/${section.id}`)}
          >
            <div className="foundry-section-head">
              <p className="foundry-section-facet">{FACET_LABEL[section.facet]}</p>
              {!section.required && (
                <button
                  type="button"
                  className="foundry-text-button"
                  disabled={readOnly}
                  onClick={() =>
                    patchFoundry({
                      state: dismissSection(foundry.state, section.id, Date.now()),
                    })
                  }
                >
                  <CircleSlash size={13} />
                  Not relevant
                </button>
              )}
            </div>
            <p className="foundry-section-prompt">{section.prompt}</p>
            {section.detail && (
              <p className="foundry-section-detail">{section.detail}</p>
            )}
            <SectionEditor
              section={section}
              draft={drafts[section.id] ?? section.value}
              onDraft={(value) =>
                setDrafts((current) => ({ ...current, [section.id]: value }))
              }
              disabled={readOnly}
              artifacts={artifacts}
            />
            <button
              type="button"
              className="foundry-primary is-compact"
              disabled={
                readOnly || isEmptyValue(drafts[section.id] ?? section.value)
              }
              onClick={() => saveSection(section)}
            >
              Save and continue
            </button>
          </article>
        ))}

        <div ref={streamEnd} />

        <div className="foundry-stream-actions">
          <button
            type="button"
            className="foundry-secondary"
            disabled={readOnly || busy === "next"}
            onClick={() => void requestSection()}
          >
            {busy === "next" ? (
              <>
                <Loader2 size={14} className="foundry-spin" />
                Working out what to ask
              </>
            ) : (
              "Continue building"
            )}
          </button>
          <button
            type="button"
            className="foundry-secondary"
            disabled={readOnly || busy === "compile"}
            onClick={() => void compile()}
          >
            {busy === "compile" ? (
              <>
                <Loader2 size={14} className="foundry-spin" />
                Drafting skills
              </>
            ) : (
              "Compile skills"
            )}
          </button>
          {dismissed.length > 0 && (
            <button
              type="button"
              className="foundry-text-button"
              onClick={() => setShowDismissed((value) => !value)}
            >
              {showDismissed ? "Hide" : `${dismissed.length} dismissed`}
            </button>
          )}
        </div>

        {showDismissed && (
          <ul className="foundry-dismissed">
            {dismissed.map((section) => (
              <li key={section.id}>
                <span>{section.prompt}</span>
                <button
                  type="button"
                  className="foundry-text-button"
                  disabled={readOnly}
                  onClick={() =>
                    patchFoundry({
                      state: restoreSection(foundry.state, section.id, Date.now()),
                    })
                  }
                >
                  <RotateCcw size={13} />
                  Bring back
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* ---------------- evidence ---------------- */}

        <section
          className="foundry-block"
          data-ai-region={aiRegionAttr(
            pathTouches(aiChangedPaths, "/foundry/evidenceBindings"),
          )}
        >
          <div className="foundry-block-head">
            <h3>Source material</h3>
            <button
              type="button"
              className="foundry-text-button"
              disabled={readOnly}
              onClick={() => setEvidenceOpen((value) => !value)}
            >
              <Plus size={13} />
              Add a source
            </button>
          </div>
          <p className="foundry-block-lede">
            Rubrics, policies and marked work are read as material, never as
            instructions. Anything in them that addresses the assistant is
            quarantined and reported here.
          </p>

          {evidenceOpen && (
            <div className="foundry-evidence-form">
              <input
                className="foundry-input"
                placeholder="What is this? e.g. Department essay rubric 2026"
                value={evidenceLabel}
                onChange={(event) => setEvidenceLabel(event.target.value)}
              />
              <div className="foundry-choices is-inline">
                {EVIDENCE_KINDS.map((kind) => (
                  <button
                    key={kind.id}
                    type="button"
                    className={`foundry-chip${evidenceKind === kind.id ? " is-active" : ""}`}
                    onClick={() =>
                      setEvidenceKind(kind.id as EvidenceBinding["kind"])
                    }
                  >
                    {kind.label}
                  </button>
                ))}
              </div>
              <textarea
                className="foundry-input"
                rows={8}
                placeholder="Paste the source"
                value={evidenceText}
                onChange={(event) => setEvidenceText(event.target.value)}
              />
              <button
                type="button"
                className="foundry-primary is-compact"
                disabled={busy === "evidence" || !evidenceText.trim()}
                onClick={() => void attachEvidence()}
              >
                {busy === "evidence" ? (
                  <>
                    <Loader2 size={14} className="foundry-spin" />
                    Reading it
                  </>
                ) : (
                  "Read this source"
                )}
              </button>
            </div>
          )}

          <ul className="foundry-evidence-list">
            {foundry.evidenceBindings.map((binding) => {
              const extraction = binding.extraction;
              return (
                <li
                  key={binding.id}
                  className={`foundry-evidence${binding.confirmed ? " is-confirmed" : ""}${extraction && extraction.securityConcerns.length > 0 ? " is-quarantined" : ""}`}
                >
                  <div className="foundry-evidence-head">
                    <span className="foundry-evidence-label">{binding.label}</span>
                    <button
                      type="button"
                      className="foundry-icon-button"
                      aria-label={`Remove ${binding.label}`}
                      disabled={readOnly}
                      onClick={() => removeEvidence(binding.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {extraction && (
                    <>
                      <p className="foundry-evidence-read">
                        {extraction.criteria.length} criteria ·{" "}
                        {extraction.rules.length} rules ·{" "}
                        {extraction.examples.length} examples ·{" "}
                        {extraction.edgeCases.length} edge cases
                      </p>
                      {extraction.criteria.length > 0 && (
                        <ul className="foundry-evidence-detail">
                          {extraction.criteria.slice(0, 5).map((criterion) => (
                            <li key={criterion.id}>{criterion.name}</li>
                          ))}
                        </ul>
                      )}
                      {extraction.securityConcerns.length > 0 && (
                        <p className="foundry-quarantine">
                          <ShieldAlert size={13} />
                          {extraction.securityConcerns.length} passage
                          {extraction.securityConcerns.length === 1 ? "" : "s"}{" "}
                          quarantined. They address the assistant rather than
                          describe the subject, so they were not made policy.
                        </p>
                      )}
                      {extraction.contradictions.length > 0 && (
                        <p className="foundry-quarantine is-conflict">
                          <AlertTriangle size={13} />
                          {extraction.contradictions[0]!.description}
                        </p>
                      )}
                      {extraction.unresolvedQuestions.length > 0 && (
                        <ul className="foundry-evidence-questions">
                          {extraction.unresolvedQuestions.slice(0, 3).map((entry) => (
                            <li key={entry.id}>{entry.question}</li>
                          ))}
                        </ul>
                      )}
                      <div className="foundry-evidence-actions">
                        <button
                          type="button"
                          className={`foundry-choice is-compact${binding.confirmed ? " is-active" : ""}`}
                          disabled={readOnly}
                          onClick={() => confirmEvidence(binding.id, true)}
                        >
                          <Check size={13} />
                          Read correctly
                        </button>
                        {binding.confirmed && (
                          <button
                            type="button"
                            className="foundry-text-button"
                            disabled={readOnly}
                            onClick={() => confirmEvidence(binding.id, false)}
                          >
                            Undo
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* ---------------- skills ---------------- */}

        <section
          className="foundry-block"
          data-ai-region={aiRegionAttr(
            pathTouches(aiChangedPaths, "/foundry/skills"),
          )}
        >
          <div className="foundry-block-head">
            <h3>Skills</h3>
            <span className="foundry-block-count">
              {foundry.skills.length} approved
            </span>
          </div>

          <CompilerTrace job={compilerJob} running={busy === "compile"} />

          {proposed.length > 0 && (
            <ul className="foundry-skill-list is-proposed">
              {proposed.map((skill) => (
                <li key={skill.id} className="foundry-skill">
                  <div className="foundry-skill-head">
                    <span className="foundry-skill-name">{skill.name}</span>
                    <span className="foundry-skill-state">Drafted</span>
                  </div>
                  <p className="foundry-skill-purpose">{skill.purpose}</p>
                  {skill.procedure.length > 0 && (
                    <ol className="foundry-skill-steps">
                      {skill.procedure
                        .slice()
                        .sort((left, right) => left.order - right.order)
                        .map((step) => (
                          <li key={step.order}>{step.action}</li>
                        ))}
                    </ol>
                  )}
                  {skill.outputContract.shape && (
                    <p className="foundry-skill-contract">
                      Produces: {skill.outputContract.shape}
                    </p>
                  )}
                  <div className="foundry-skill-actions">
                    <button
                      type="button"
                      className="foundry-primary is-compact"
                      disabled={readOnly}
                      onClick={() => acceptSkill(skill)}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="foundry-text-button"
                      onClick={() => rejectSkill(skill.id)}
                    >
                      Discard
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <ul className="foundry-skill-list">
            {foundry.skills.map((skill) => (
              <li key={skill.id} className="foundry-skill is-approved">
                <div className="foundry-skill-head">
                  <span className="foundry-skill-name">{skill.name}</span>
                  <span className="foundry-skill-state">v{skill.version}</span>
                </div>
                <p className="foundry-skill-purpose">{skill.purpose}</p>
                <div className="foundry-skill-actions">
                  <button
                    type="button"
                    className="foundry-text-button"
                    disabled={readOnly}
                    onClick={() =>
                      patchFoundry({
                        skills: foundry.skills.filter(
                          (entry) => entry.id !== skill.id,
                        ),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {foundry.skills.length === 0 && proposed.length === 0 && (
            <p className="foundry-empty">
              Nothing compiled yet. Answer enough about the mission, then compile.
            </p>
          )}
        </section>

        {/* ---------------- release ---------------- */}

        <section
          className="foundry-block"
          data-ai-region={aiRegionAttr(pathTouches(aiChangedPaths, "/routing"))}
        >
          <div className="foundry-block-head">
            <h3>Release</h3>
            <span className="foundry-block-count">
              {runtimePackage.skillIndex.length} skills ·{" "}
              {runtimePackage.verificationSteps.length} checks ·{" "}
              {runtimePackage.safetyBoundaries.length} boundaries
            </span>
          </div>

          <p className="foundry-block-lede">
            Publishing compiles the mission, skills and evidence into an
            immutable package. Earlier releases stay available to roll back to.
          </p>

          {publishBlockers.length > 0 && (
            <ul className="foundry-blockers">
              {publishBlockers.slice(0, 6).map((blocker, index) => (
                <li key={index}>{blocker}</li>
              ))}
            </ul>
          )}

          <div className="foundry-release-actions">
            <button
              type="button"
              className="foundry-secondary"
              disabled={readOnly || busy === "evaluate"}
              onClick={() => void evaluate()}
            >
              {busy === "evaluate" ? (
                <>
                  <Loader2 size={14} className="foundry-spin" />
                  Running checks
                </>
              ) : (
                <>
                  <FlaskConical size={14} />
                  Run checks
                </>
              )}
            </button>
            <button
              type="button"
              className="foundry-primary"
              disabled={
                readOnly ||
                !canPublish ||
                busy === "publish" ||
                publishBlockers.length > 0
              }
              onClick={() => void publish()}
            >
              {busy === "publish" ? (
                <>
                  <Loader2 size={15} className="foundry-spin" />
                  Publishing
                </>
              ) : (
                "Publish"
              )}
            </button>
          </div>

          {releases.length > 0 && (
            <ul className="foundry-releases">
              {releases.slice(0, 5).map((release) => (
                <li key={release.releaseId}>
                  <span className="foundry-release-number">
                    v{release.releaseNumber}
                  </span>
                  <span className="foundry-release-status">{release.status}</span>
                  <span className="foundry-release-notes">
                    {release.releaseNotes || "No notes"}
                  </span>
                  {release.status === "published" && (
                    <button
                      type="button"
                      className="foundry-text-button"
                      disabled={readOnly || busy === "rollback"}
                      onClick={() => void rollback(release.releaseId)}
                    >
                      Roll back
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <CompetenceLedger
        content={agent}
        skills={foundry.skills}
        evidence={foundry.evidenceBindings}
      />
    </div>
  );
}
