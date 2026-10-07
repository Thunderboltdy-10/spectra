"use client";

/**
 * Agent Foundry
 * Phase 10 §10.1–§10.14 — replaces the fixed six-step wizard.
 *
 * The Foundry is a compiler, not a settings form. Two opening answers are
 * compiled into a mission; every question after them is generated from what the
 * mission still lacks. Three things follow from that and are load-bearing here:
 *
 *  1. The operating brief the runtime reads (`instructions.text`) is *derived*
 *     from the mission and the approved skills by `projectFoundryToLegacy`. It
 *     is never typed. `publishAgent` requires 40 characters of it, so the brief
 *     is shown, counted and reconciled here rather than left invisible.
 *  2. Granted capabilities are the one part of the compiled agent the runtime
 *     reads straight from `content.tools` (`/api/spectra/run` builds its tool
 *     grants from it), so answering the capabilities question writes there.
 *  3. Build, Checks and Releases are views of one draft, not three editors.
 *     Modes come from `work/registry` through the studio contract, and the
 *     competence ledger travels with the authoring surface rather than
 *     displacing it when the pane narrows.
 */

import { ArrowRight, Loader2, RotateCcw, ShieldAlert, AlertTriangle, Check, ChevronDown, Lock, Plus, Trash2, X, CircleSlash, FlaskConical, Gauge, Play, ScrollText, Square } from "@/components/icons/glyph-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusBadge, statusToneFor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MetricValue,
  describeFailure,
  metricCaption,
  type DescribedFailure,
  type MetricReading,
} from "@/components/ui/truthful-state";
import {
  acceptCompiledSkill,
  addSection,
  answerSection,
  applyCompiledRouting,
  assessSufficiency,
  benchCaseToEvaluationCase,
  buildEvaluationSuite,
  compileRuntimePackage,
  compilerProgress,
  compilerStatusLabel,
  detectSkillOverlap,
  dismissSection,
  isBenchEvaluationCase,
  isEmptyValue,
  normalizeFoundryContent,
  pendingCompiledSkills,
  planFacetWeights,
  projectFoundryToLegacy,
  restoreSection,
  skillIssues,
  summarizeEvidence,
  type AgentFoundryContent,
  type EvaluationLayer,
  type EvidenceBinding,
  type EvidenceExtraction,
  type FoundryFacet,
  type FoundrySection,
  type FoundrySectionValue,
  type SpectraSkill,
  withBenchCases,
  type BenchCase,
} from "../agents/foundry";
import type { AgentTool } from "../agents/model";
import {
  compileSpectraAgentFoundation,
  compileSpectraFoundrySkills,
  evaluateSpectraAgent,
  extractSpectraFoundryEvidence,
  getSpectraAgentAnalytics,
  getSpectraAgentEvalRuns,
  getSpectraAgentReleases,
  getSpectraFoundryCompilerJob,
  manageSpectraAgentRelease,
  nextSpectraFoundrySection,
  publishSpectraAgent,
  type SpectraAgentAnalytics,
  type SpectraAgentEvalRun,
  type SpectraAgentRelease,
  type SpectraArtifact,
  type SpectraFoundryCompilerJob,
} from "../data/api";
import { LocalAutocompleteTextarea } from "../compute/autocomplete";
import { aiRegionAttr, pathTouches } from "./ai-region-path";
import { ArtifactWorkbar, type CommandBinding, WorkbarItemSelector } from "./artifact-workbar";
import { projectBindingsFromIr } from "../capabilities";
import { useStudioContract } from "./artifact-studio-shell";
import { targetAttrs } from "../collaboration/target-attributes";
import { TARGET_ATTRIBUTE } from "../collaboration/interaction-geometry";
import type { WorkRegion } from "../anchors/locate";
import { attributeSelector, paintedFirst, useOpenAnchor, type AnchorLanding } from "../anchors/use-open-anchor";

/** The semantic layer's agent regions (shared/semantic-chunks.ts): the view each is in and its control. */
const AGENT_REGION_PARTS = new Map<string, { view: string; path: string; brief?: boolean }>([
  ["agent:profile", { view: "overview", path: "/foundry/mission" }],
  ["agent:routing", { view: "releases", path: "/routing/description" }],
  ["agent-instructions", { view: "releases", path: "/instructions/text", brief: true }],
]);
import { AgentBench, benchBarAction, useAgentBench } from "./agent-bench";
import { spectraBus } from "../events";
export { canPublishAgentArtifact } from "./agent-publish-gates";

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

/**
 * The capabilities Spectra can actually grant. This list is the runtime's
 * allowlist (`AgentTool["key"]`, enforced again by `publishAgent`), not a menu
 * of plausible ones: the previous list offered "Run code" and "Read files",
 * which the runtime has no tool for, so both were dropped on save and would
 * have failed publish. Everything here reaches a real tool.
 */
const TOOL_CHOICES: ReadonlyArray<{
  id: AgentTool["key"];
  label: string;
  detail: string;
}> = [
  { id: "artifact_search", label: "Find work", detail: "Search what the person asking can already see" },
  { id: "artifact_read", label: "Read work", detail: "Open and quote items they can already open" },
  { id: "artifact_create", label: "Create work", detail: "Start new typed Spectra work" },
  { id: "artifact_edit", label: "Edit work", detail: "Propose region-safe changes" },
  { id: "memory_retrieve", label: "Recall context", detail: "Read what they asked Spectra to remember" },
  { id: "school_data", label: "Read school data", detail: "Timetable and results they may already see" },
  { id: "web_search", label: "Search the web", detail: "Look things up outside Spectra" },
];

const TOOL_LABEL = new Map<string, string>(
  TOOL_CHOICES.map((tool) => [tool.id, tool.label]),
);

/** What each evaluation layer establishes, in the creator's terms (§10.10). */
const LAYER_LABEL: Record<EvaluationLayer, string> = {
  contract: "Keeps its output contract",
  held_out: "Handles unseen requests",
  mission_truth: "Matches your worked examples",
  tool_sandbox: "Stays honest without its tools",
  adversarial: "Resists instructions hidden in material",
  regression: "Has not lost old behaviour",
  independent_judge: "Judged by a second model",
};

/** The server's publish gates, stated once so the copy cannot drift from them. */
const BRIEF_MINIMUM = 40;
const ROUTING_MINIMUM = 30;

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

function whenText(at: number) {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}


/* ------------------------------------------------------------------ */
/* Competence ledger — the one loud element on this surface            */
/* ------------------------------------------------------------------ */

/**
 * What this agent knows, and what it cannot do yet.
 *
 * Two rules the previous version broke. First, weight and achievement are
 * different facts: the bars encoded pursuit weight as length and coverage as
 * fill, so nine bars sat 30–75% full under the heading `COMPETENCE 0%`. A
 * teacher read the bars as progress. There is no bar now — the weight is a
 * number and the state is a word, and the headline is a count rather than a
 * percentage. Second, this panel is not more important than the work: below the
 * two-column threshold it collapses to its headline so the authoring surface
 * stays on screen, and every row remains reachable by opening it (CANON D4).
 */
function CompetenceLedger({
  content,
  skills,
  evidence,
  extraGaps,
  open,
  onClose,
}: {
  content: AgentFoundryContent;
  skills: SpectraSkill[];
  evidence: EvidenceBinding[];
  extraGaps: string[];
  open: boolean;
  onClose: () => void;
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
  const [allGaps, setAllGaps] = useState(false);

  if (!open) return null;

  const rows = sufficiency.pursuedFacets
    .map((facet) => ({
      facet,
      weight: weights.get(facet) ?? 0,
      covered: !sufficiency.missingFacets.includes(facet),
    }))
    .sort((left, right) => right.weight - left.weight);
  const established = rows.filter((row) => row.covered).length;

  const gaps: string[] = [];
  for (const facet of sufficiency.missingFacets) {
    gaps.push(`${FACET_LABEL[facet]}: not established yet.`);
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
  gaps.push(...extraGaps);
  const shown = allGaps ? gaps : gaps.slice(0, 6);

  return (
    <aside className="foundry-ledger" aria-label="What this agent knows">
      <header className="foundry-ledger-head">
        <span className="foundry-ledger-eyebrow">Competence</span>
        <span className="foundry-ledger-figure">
          {established}
          <span className="foundry-ledger-unit"> of {rows.length || 0}</span>
        </span>
        <button
          type="button"
          className="foundry-icon-button"
          aria-label="Hide competence"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </header>

      <p className="foundry-ledger-note">
        {rows.length === 0
          ? "This mission pursues no facets yet."
          : `${established} of ${rows.length} facets established. ${gaps.length} thing${gaps.length === 1 ? "" : "s"} it cannot do yet.`}
      </p>

      <ul className="foundry-ledger-rows">
            {rows.map((row) => (
              <li
                key={row.facet}
                className={`foundry-ledger-row${row.covered ? " is-covered" : ""}`}
                /* The name had 82px of a 296px panel and truncated to
                   `Source mater…`. It takes the free space now that no bar
                   competes for it. */
                style={{ gridTemplateColumns: "minmax(0, 1fr) auto auto" }}
              >
                <span className="foundry-ledger-name">
                  {FACET_LABEL[row.facet]}
                </span>
                <span className="foundry-ledger-weight" title="How much this mission depends on it">
                  {row.weight}
                </span>
                <span className="foundry-ledger-name" style={{ textAlign: "right" }}>
                  {row.covered ? "Established" : "Not yet"}
                </span>
              </li>
            ))}
          </ul>

          {rows.length > 0 && (
            <p className="foundry-ledger-note">
              The number is how much this mission depends on the facet, not how
              far you have got with it.
            </p>
          )}

          {sufficiency.notApplicable.length > 0 && (
            <p className="foundry-ledger-note">
              Not pursued for this mission:{" "}
              {sufficiency.notApplicable
                .map((facet) => FACET_LABEL[facet])
                .join(", ")}
              .
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
              <>
                <ul className="foundry-gap-list">
                  {shown.map((gap, index) => (
                    <li key={index}>{gap}</li>
                  ))}
                </ul>
                {gaps.length > shown.length || allGaps ? (
                  <button
                    type="button"
                    className="foundry-text-button"
                    onClick={() => setAllGaps((value) => !value)}
                  >
                    {allGaps
                      ? "Show fewer"
                      : `Show all ${gaps.length}`}
                  </button>
                ) : null}
              </>
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
      <>
        <ul className="foundry-choices">
          {TOOL_CHOICES.map((tool) => {
            const active = selected.includes(tool.id);
            return (
              <li key={tool.id}>
                <button
                  type="button"
                  className={`foundry-choice${active ? " is-active" : ""}`}
                  disabled={disabled}
                  aria-pressed={active}
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
        <p className="foundry-section-detail">
          Whatever you grant, the agent works inside the permissions of whoever
          asks, and Spectra asks that person before anything consequential.
        </p>
      </>
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
        .map((id) => TOOL_LABEL.get(id) ?? id)
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

/** One failure, in the interface's voice, with a reference support can trace. */
function FoundryProblem({ problem }: { problem?: DescribedFailure }) {
  if (!problem) return null;
  return (
    <p className="foundry-problem" role="alert">
      <AlertTriangle size={14} />
      {problem.message} Reference {problem.reference}.
    </p>
  );
}

/**
 * The capability grant the runtime reads. Deselecting revokes, which is why the
 * list is rebuilt from the selection rather than merged into it.
 */
function toolGrantsFrom(
  toolIds: readonly string[],
  existing: readonly AgentTool[],
): AgentTool[] {
  return TOOL_CHOICES.filter((tool) => toolIds.includes(tool.id)).map((tool) => {
    const previous = existing.find((entry) => entry.key === tool.id);
    return {
      id: previous?.id ?? identifier("tool"),
      key: tool.id,
      enabled: true,
      approval: previous?.approval ?? ("consequential" as const),
    };
  });
}

function releaseLabel(release: SpectraAgentRelease) {
  const rollout = release.rollout ?? "published";
  if (release.status !== "published") return release.status;
  if (rollout === "internal_test") return "you only";
  if (rollout === "limited") return "on request";
  return "live";
}

/**
 * `statusToneFor` reads the settled product vocabulary, and an eval run says
 * `passed`, which that vocabulary does not list, so a green run was rendered as
 * neutral grey. Mapped here rather than by inventing a second tone scale; A1
 * owns the word list.
 */
function runTone(status: string) {
  if (status === "passed") return "succeeded";
  if (status === "failed") return "failed";
  return status;
}

/* ------------------------------------------------------------------ */
/* Checks — the one place a run can be tested before it is released    */
/* ------------------------------------------------------------------ */

/**
 * The suite and its runs. Both were already real and neither was reachable:
 * `evaluateSpectraAgent` runs a layered suite against the live model with the
 * agent's own compiled brief, stores every case with its verdict, reason and
 * the answer it got, and the surface then displayed one sentence and threw the
 * rest away. A failure a creator cannot read is a failure they cannot fix.
 */
function ChecksView({
  suite,
  runs,
  currentHash,
  canEdit,
  loading,
  benchCases = [],
}: {
  suite: ReturnType<typeof buildEvaluationSuite>;
  runs: SpectraAgentEvalRun[];
  currentHash: string;
  canEdit: boolean;
  loading: boolean;
  /** Tests saved from the bench; they run in the regression layer. */
  benchCases?: BenchCase[];
}) {
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [showPassed, setShowPassed] = useState(false);
  const activeId = openRunId ?? runs[0]?._id ?? null;
  const active = runs.find((run) => run._id === activeId) ?? null;

  const layers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of suite)
      counts.set(entry.layer, (counts.get(entry.layer) ?? 0) + 1);
    return (Object.keys(LAYER_LABEL) as EvaluationLayer[])
      .filter((layer) => layer !== "independent_judge")
      .map((layer) => ({ layer, count: counts.get(layer) ?? 0 }));
  }, [suite]);

  const cases = active?.results ?? [];
  const failed = cases.filter((entry) => !entry.passed);
  const savedTests = suite.filter((entry) => isBenchEvaluationCase(entry.id)).length;
  const caseLabel = (caseId: string, category: string) => {
    if (isBenchEvaluationCase(caseId)) {
      const saved = benchCases.find((entry) => `bench-${entry.id}` === caseId);
      return saved
        ? `Your test: ${saved.prompt.length > 80 ? `${saved.prompt.slice(0, 80)}…` : saved.prompt}`
        : "A test you saved";
    }
    return LAYER_LABEL[category as EvaluationLayer] ?? category;
  };
  const shown = showPassed ? cases : failed;

  return (
    <>
      <section className="foundry-block">
        <div className="foundry-block-head">
          <h3>What gets checked</h3>
          <span className="foundry-block-count">
            {suite.length} check{suite.length === 1 ? "" : "s"}
          </span>
        </div>
        <p className="foundry-block-lede">
          The suite is built from this agent&rsquo;s own mission, skills and
          sources, so it changes as they do. Every check runs against the live
          model using the brief the runtime will use.
          {savedTests > 0
            ? ` It also runs the ${savedTests === 1 ? "test" : `${savedTests} tests`} you saved from the bench.`
            : ""}
        </p>
        {suite.length === 0 ? (
          <p className="foundry-empty">
            Nothing to check yet. Approve at least one skill and the suite is
            built from it.
          </p>
        ) : (
          <ol className="foundry-compile-stages">
            {layers.map((entry) => (
              <li
                key={entry.layer}
                className={entry.count === 0 ? "is-skipped" : "is-completed"}
              >
                <span className="foundry-compile-stage-label">
                  {LAYER_LABEL[entry.layer]}
                </span>
                <span className="foundry-compile-stage-detail">
                  {entry.count === 0 ? "not covered" : `${entry.count}`}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="foundry-block">
        <div className="foundry-block-head">
          <h3>Runs</h3>
          <span className="foundry-block-count">
            {runs.length} recorded
          </span>
        </div>

        {loading ? (
          <p className="foundry-empty">Reading the run history.</p>
        ) : !canEdit ? (
          <p className="foundry-empty">
            Run history is available to people who can edit this agent.
          </p>
        ) : runs.length === 0 ? (
          <p className="foundry-empty">
            No checks have run yet. Run them once and every case, including the
            ones that fail, is kept here.
          </p>
        ) : (
          <ul className="foundry-releases">
            {runs.slice(0, 8).map((run) => {
              const stale = Boolean(currentHash) && run.contentHash !== currentHash;
              return (
                <li key={run._id}>
                  <span className="foundry-release-number">
                    {run.passedCount}/{run.caseCount}
                  </span>
                  <StatusBadge tone={statusToneFor(runTone(run.status))}>
                    {run.status}
                  </StatusBadge>
                  <span className="foundry-release-notes">
                    {whenText(run.completedAt ?? run.startedAt)} ·{" "}
                    {run.modelId.split("/").pop()} ·{" "}
                    {stale ? "an earlier draft" : "this draft"}
                  </span>
                  <button
                    type="button"
                    className="foundry-text-button"
                    aria-expanded={run._id === activeId}
                    onClick={() =>
                      setOpenRunId(run._id === activeId ? "" : run._id)
                    }
                  >
                    {run._id === activeId ? "Hide" : "Open"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {active && (
          <>
            <p className="foundry-block-lede">
              {failed.length === 0
                ? `Every check passed. Average score ${active.averageScore.toFixed(2)} against a ${active.threshold.toFixed(2)} threshold.`
                : `${failed.length} of ${active.caseCount} check${active.caseCount === 1 ? "" : "s"} failed. Average score ${active.averageScore.toFixed(2)} against a ${active.threshold.toFixed(2)} threshold.`}
            </p>
            <ul className="foundry-skill-list">
              {shown.map((entry) => (
                <li
                  key={entry.caseId}
                  className={`foundry-skill${entry.passed ? " is-approved" : ""}`}
                >
                  <div className="foundry-skill-head">
                    <span className="foundry-skill-name">
                      {caseLabel(entry.caseId, entry.category)}
                    </span>
                    <span className="foundry-skill-state">
                      {entry.passed ? "passed" : "failed"} ·{" "}
                      {entry.score.toFixed(2)}
                      {entry.required ? " · required" : ""}
                    </span>
                  </div>
                  <p className="foundry-skill-purpose">
                    {entry.reason || "No reason was recorded for this case."}
                  </p>
                  {entry.responseExcerpt && (
                    <p className="foundry-skill-contract">
                      It answered: {entry.responseExcerpt.slice(0, 320)}
                      {entry.responseExcerpt.length > 320 ? "…" : ""}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {cases.length > failed.length && (
              <button
                type="button"
                className="foundry-text-button"
                onClick={() => setShowPassed((value) => !value)}
              >
                {showPassed
                  ? "Failures only"
                  : `Show the ${cases.length - failed.length} that passed`}
              </button>
            )}
            <p className="foundry-ledger-note">
              Spectra also records how each answer was judged and what the run
              could not establish. This screen does not read those yet.
            </p>
          </>
        )}
      </section>
    </>
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
  /* Registry truth: which modes exist, who may enter them, and how much room
     this pane has. The type declares nothing about permissions itself. */
  const contract = useStudioContract();
  // `readOnly` and `contract.readOnly` are the same fact from the same shell
  // resolution; both are read so a future divergence fails closed.
  const canEdit = contract.can("edit") && !readOnly;

  const normalized = useMemo(() => normalizeFoundryContent(content), [content]);
  const [agent, setAgent] = useState(normalized);
  useEffect(() => setAgent(normalized), [normalized]);

  const [view, setView] = useState<string>("overview");
  const [objective, setObjective] = useState("");
  const [interaction, setInteraction] = useState("");
  const [drafts, setDrafts] = useState<Record<string, FoundrySectionValue>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>();
  const [problem, setProblem] = useState<DescribedFailure>();
  const [proposed, setProposed] = useState<SpectraSkill[]>([]);
  const [evidenceText, setEvidenceText] = useState("");
  const [evidenceLabel, setEvidenceLabel] = useState("");
  const [evidenceKind, setEvidenceKind] =
    useState<EvidenceBinding["kind"]>("rubric");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [releases, setReleases] = useState<SpectraAgentRelease[]>([]);
  const [evalRuns, setEvalRuns] = useState<SpectraAgentEvalRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(!readOnly);
  const [currentHash, setCurrentHash] = useState("");
  const [showDismissed, setShowDismissed] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  // Opened at a part of the agent (a search hit, a citation): show the view it
  // is in and land on it.
  const landOnPart = useCallback((region: WorkRegion): AnchorLanding | null => {
    const part = AGENT_REGION_PARTS.get(region.id);
    if (!part) return null;
    return {
      select: () => {
        setView(part.view);
        if (part.brief) setShowBrief(true);
      },
      find: (root) => paintedFirst(root.querySelectorAll(attributeSelector(TARGET_ATTRIBUTE, part.path))),
    };
  }, []);
  useOpenAnchor(artifactId, landOnPart);
  const [activeQuestionId, setActiveQuestionId] = useState("");
  const [analytics, setAnalytics] = useState<SpectraAgentAnalytics | null>(null);
  const [analyticsState, setAnalyticsState] = useState<
    "idle" | "loading" | "ready" | "failed"
  >("idle");
  const [compilerJob, setCompilerJob] =
    useState<SpectraFoundryCompilerJob | null>(null);
  const streamEnd = useRef<HTMLDivElement>(null);
  const reconciled = useRef<string | null>(null);

  const foundry = agent.foundry;
  const established = foundry.foundationEstablished;
  // A drafted skill approved since (here, or by Spectra) no longer waits.
  const waiting = useMemo(
    () => pendingCompiledSkills(proposed, foundry.skills),
    [foundry.skills, proposed],
  );

  // A mode the viewer cannot enter is never left selected.
  useEffect(() => {
    if (!contract.modes.some((entry) => entry.id === view))
      setView(contract.modes[0]?.id ?? "overview");
  }, [contract.modes, view]);

  useEffect(() => {
    onActiveRegionChange?.(established ? view : "foundation");
  }, [established, onActiveRegionChange, view]);

  /* Re-reads the check runs and, with them, the hash of the draft they ran
     against. Every gate that mentions checks depends on that hash being current,
     so this is called on mount, on entering Releases, after a run, and from the
     bar. */
  const reloadRuns = useCallback(async () => {
    setRunsLoading(true);
    const response = await getSpectraAgentEvalRuns(artifactId).catch(() => null);
    if (response) {
      setEvalRuns(response.runs);
      setCurrentHash(response.currentContentHash);
    }
    setRunsLoading(false);
    return response !== null;
  }, [artifactId]);

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
        .catch(() => undefined)
        .finally(() => active && setRunsLoading(false));
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

  // Spectra can run this agent's checks and release it too; show what it did.
  useEffect(
    () =>
      spectraBus.on("agent.releasesChanged", (detail) => {
        if (detail.agentId !== artifactId) return;
        void getSpectraAgentReleases(artifactId)
          .then((response) => setReleases(response.releases))
          .catch(() => undefined);
        if (!readOnly)
          void getSpectraAgentEvalRuns(artifactId)
            .then((response) => {
              setEvalRuns(response.runs);
              setCurrentHash(response.currentContentHash);
            })
            .catch(() => undefined);
      }),
    [artifactId, readOnly],
  );

  // Usage is only asked for when the release view is opened, because opening an
  // editor should not cost a query nobody is looking at.
  useEffect(() => {
    if (view !== "releases" || readOnly || analyticsState !== "idle") return;
    setAnalyticsState("loading");
    let active = true;
    void getSpectraAgentAnalytics(artifactId)
      .then((response) => {
        if (!active) return;
        setAnalytics(response.analytics);
        setAnalyticsState("ready");
      })
      .catch(() => active && setAnalyticsState("failed"));
    return () => {
      active = false;
    };
  }, [analyticsState, artifactId, readOnly, view]);

  /* The check gate is keyed to a hash of the draft, so a run that passed before
     the last edit stops counting. Re-reading it on entering Releases is what
     keeps the blocker list and the Publish verb honest rather than optimistic. */
  useEffect(() => {
    if (view !== "releases" || readOnly) return;
    void reloadRuns();
  }, [readOnly, reloadRuns, view]);

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

  /* Spectra compiled this agent: its drafted skills wait here as the studio's
     own Compile leaves them, and the compiled routing and notes apply. */
  const latestAgent = useRef(agent);
  useEffect(() => {
    latestAgent.current = agent;
  }, [agent]);
  useEffect(
    () =>
      spectraBus.on("agent.compiled", (detail) => {
        if (detail.agentId !== artifactId || readOnly) return;
        void getSpectraFoundryCompilerJob(artifactId)
          .then(({ job }) => {
            setCompilerJob(job);
            if (job?.status !== "completed" || !job.result) return;
            const result = job.result;
            setProposed(result.skills);
            if (canEdit) commit(applyCompiledRouting(latestAgent.current, result));
            setNotice(
              `Spectra drafted ${result.skills.length} skill${result.skills.length === 1 ? "" : "s"}. Approve the ones that match how you work.`,
            );
          })
          .catch(() => undefined);
      }),
    [artifactId, canEdit, commit, readOnly],
  );

  /* The operating brief is compiled, never typed, so it can fall behind a
     mission that was changed by something other than this surface (an AI edit,
     an import, an older draft). Publish reads the stored field, so a stale
     brief fails on a field the creator cannot see. Reconcile once per artifact
     on open. */
  const compiled = useMemo(() => projectFoundryToLegacy(agent), [agent]);
  const brief = compiled.instructions.text.trim();
  const briefBehind = brief !== (agent.instructions?.text ?? "").trim();
  useEffect(() => {
    if (!canEdit || !established || !briefBehind) return;
    if (reconciled.current === artifactId) return;
    reconciled.current = artifactId;
    commit(agent);
  }, [agent, artifactId, briefBehind, canEdit, commit, established]);

  async function run<T>(key: string, fallback: string, task: () => Promise<T>) {
    setBusy(key);
    setProblem(undefined);
    try {
      return await task();
    } catch (error) {
      setProblem(describeFailure(error, { fallback }));
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  /* -------------------- foundation -------------------- */

  async function establishFoundation() {
    const result = await run(
      "foundation",
      "Spectra could not read the foundation. Try rewording the objective, then set it again.",
      () =>
        compileSpectraAgentFoundation({
          agentId: artifactId,
          objective,
          interaction,
        }),
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
      const result = await run(
        "next",
        "Spectra could not work out what to ask next. Try again, or add a source in the meantime.",
        () => nextSpectraFoundrySection(artifactId),
      );
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
    const state = answerSection(foundry.state, section.id, draft, Date.now());
    /* Capabilities are the one answer the runtime reads from outside the Foundry
       document: `/api/spectra/run` builds its tool grants from `content.tools`,
       and nothing was writing there, so every capability a creator granted was
       discarded on save. The grant is written in the same commit as the answer. */
    const next: AgentFoundryContent =
      draft.kind === "permissions"
        ? {
            ...agent,
            tools: toolGrantsFrom(draft.toolIds, agent.tools),
            foundry: { ...foundry, state },
          }
        : { ...agent, foundry: { ...foundry, state } };
    commit(next);
    setDrafts((current) => {
      const rest = { ...current };
      delete rest[section.id];
      return rest;
    });
    // The answer has to travel with the request: `requestSection` adds the next
    // section to the draft it was given, and the draft in scope here is the only
    // one that contains what was just answered.
    void requestSection(next);
  }

  /* -------------------- evidence -------------------- */

  async function attachEvidence() {
    const label = evidenceLabel.trim() || "Source";
    const text = evidenceText.trim();
    if (!text) return;

    const sourceId = identifier("src");
    const result = await run(
      "evidence",
      `Spectra could not read "${label}". Check the text you pasted, then read it again.`,
      () =>
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
    const result = await run(
      "compile",
      "The skill compiler stopped before it finished. The stages below show where.",
      () => compileSpectraFoundrySkills(artifactId),
    );
    // Whether or not compilation succeeded, the job record explains what
    // happened, so read it back either way.
    void getSpectraFoundryCompilerJob(artifactId)
      .then((response) => setCompilerJob(response.job))
      .catch(() => undefined);
    if (!result) return;
    setProposed(result.skills);
    commit(applyCompiledRouting(agent, result));
    setNotice(
      `${result.skills.length} skill${result.skills.length === 1 ? "" : "s"} drafted. Approve the ones that match how you work.`,
    );
  }

  function acceptSkill(skill: SpectraSkill) {
    patchFoundry({ skills: acceptCompiledSkill(foundry.skills, skill) });
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

  const bench = useAgentBench({ agentId: artifactId, enabled: canEdit, content: agent });
  const passingEval = evalRuns.some(
    (entry) =>
      entry.status === "passed" &&
      Boolean(currentHash) &&
      entry.contentHash === currentHash,
  );
  /* Saving a test does not change the draft, so the server also asks that the
     passing run started after the newest saved test. */
  const newestTest = bench.cases.reduce(
    (latest, entry) => Math.max(latest, entry.updatedAt),
    0,
  );
  const passingWithTests = evalRuns.some(
    (entry) =>
      entry.status === "passed" &&
      Boolean(currentHash) &&
      entry.contentHash === currentHash &&
      entry.startedAt >= newestTest,
  );

  const compiledSuite = useMemo(
    () =>
      buildEvaluationSuite({
        agentId: artifactId,
        mission: foundry.mission,
        skills: foundry.skills,
        bindings: foundry.evidenceBindings,
      }),
    [artifactId, foundry.evidenceBindings, foundry.mission, foundry.skills],
  );
  const suite = useMemo(
    () =>
      compiledSuite.length > 0
        ? withBenchCases(compiledSuite, bench.cases.map(benchCaseToEvaluationCase))
        : compiledSuite,
    [bench.cases, compiledSuite],
  );

  /* Capabilities a skill's procedure asks for that the agent has not been
     granted. The runtime resolves these as unmet and makes the agent decline,
     so they belong in the incapability ledger rather than in a console. */
  const ungranted = useMemo(() => {
    const granted = new Set(
      agent.tools.filter((tool) => tool.enabled).map((tool) => tool.key),
    );
    const wanted = new Set(
      foundry.skills.flatMap((skill) =>
        skill.procedure.flatMap((step) => step.tools ?? []),
      ),
    );
    return [...wanted].filter(
      (tool) => TOOL_LABEL.has(tool) && !granted.has(tool as AgentTool["key"]),
    );
  }, [agent.tools, foundry.skills]);

  const routingDescription = agent.routing.description.trim();
  const routingRequired =
    agent.routing.enabled && routingDescription.length < ROUTING_MINIMUM;

  /* Everything the server will refuse, in the server's own order, phrased as the
     thing to do about it. Two lists because the gates differ: `publishAgent`
     requires a passing check run only when the rollout is not `internal_test`,
     so a private release to yourself is reachable before checks pass. Offering
     one verb against the stricter list would have hidden the escape hatch that
     lets a creator try the agent before committing it to the school. */
  const { blockers: publishBlockers, privateBlockers } = useMemo(() => {
    const shared: string[] = [];
    if (!foundry.mission.objective.trim())
      shared.push("The mission has no objective. Answer the first question to set one.");
    if (brief.length < BRIEF_MINIMUM)
      shared.push(
        `The operating brief is ${brief.length} character${brief.length === 1 ? "" : "s"} and the runtime needs ${BRIEF_MINIMUM}. It is compiled from the mission and the approved skills, so answer more of the mission or approve a skill.`,
      );
    if (foundry.skills.length === 0)
      shared.push("No skills are approved, so there is nothing to publish. Compile skills, then approve the ones that match how you work.");
    for (const skill of foundry.skills) shared.push(...skillIssues(skill));
    if (routingRequired)
      shared.push(
        `Automatic routing needs ${ROUTING_MINIMUM} characters describing when to choose this agent, and it has ${routingDescription.length}. Compiling skills drafts it.`,
      );
    for (const binding of foundry.evidenceBindings) {
      if (binding.extraction && !binding.confirmed) {
        shared.push(`"${binding.label}" has not been confirmed as read correctly.`);
      }
    }
    const privateOnly = [...new Set(shared)];
    return {
      privateBlockers: privateOnly,
      blockers: !passingEval
        ? [
            ...privateOnly,
            "No check run has passed against this exact draft. Run the checks, or release it to yourself first.",
          ]
        : !passingWithTests
          ? [
              ...privateOnly,
              "A test was saved after the last passing run. Run the checks again so it counts.",
            ]
          : privateOnly,
    };
  }, [
    brief.length,
    foundry.evidenceBindings,
    foundry.mission.objective,
    foundry.skills,
    passingEval,
    passingWithTests,
    routingDescription.length,
    routingRequired,
  ]);

  const ledgerGaps = useMemo(() => {
    const gaps: string[] = [];
    if (routingRequired)
      gaps.push(
        "Spectra cannot choose this agent automatically until routing has a description.",
      );
    for (const tool of ungranted)
      gaps.push(
        `${TOOL_LABEL.get(tool)}: a skill needs it and it is not granted, so the agent will say it cannot.`,
      );
    if (brief.length > 0 && brief.length < BRIEF_MINIMUM)
      gaps.push(
        `The operating brief is ${brief.length} of the ${BRIEF_MINIMUM} characters a release needs.`,
      );
    return gaps;
  }, [brief.length, routingRequired, ungranted]);

  async function evaluate() {
    const result = await run(
      "evaluate",
      "The check run did not finish. Nothing was released, and you can run it again.",
      () => evaluateSpectraAgent(artifactId),
    );
    // The run list is re-read whether or not the request succeeded: a run that
    // failed halfway is still a run, and the cases it did get through are the
    // most useful thing on the screen.
    await reloadRuns();
    if (!result) return;
    setNotice(
      result.status === "passed"
        ? `Passed ${result.passedCount} of ${result.caseCount} checks.`
        : `Failed. ${result.passedCount} of ${result.caseCount} checks passed. Every case is in Checks, including what the agent answered.`,
    );
  }

  async function publish(rollout: "internal_test" | "published") {
    const result = await run(
      rollout === "internal_test" ? "release-private" : "publish",
      rollout === "internal_test"
        ? "The private release was not created. Nothing changed for anyone else."
        : "The release was not published and the current release is untouched. If you have changed the draft since the last passing run, run the checks again first.",
      () =>
        publishSpectraAgent(
          artifactId,
          foundry.draftReleaseNotes || undefined,
          rollout,
        ),
    );
    if (!result) {
      // The most likely refusal is the check gate, which is keyed to the draft's
      // hash, so re-read it: the blocker list then says so rather than leaving
      // Publish looking available.
      await reloadRuns();
      return;
    }
    const list = await getSpectraAgentReleases(artifactId).catch(() => null);
    if (list) setReleases(list.releases);
    // A private release carries no passing run, so it can never be promoted to
    // the school later; the way out is a second release once checks pass.
    setNotice(
      rollout === "internal_test"
        ? `Release ${result.releaseNumber} is available to you only. Use it in a conversation, then run the checks and publish when it holds up.`
        : `Release ${result.releaseNumber} published.`,
    );
  }

  async function manageRelease(
    releaseId: string,
    action: "promote" | "rollback",
  ) {
    const result = await run(
      action,
      action === "promote"
        ? "The release was not promoted. It still reaches the same people as before."
        : "The rollback did not happen. The current release is still the live one.",
      () => manageSpectraAgentRelease(releaseId, action),
    );
    if (!result) return;
    const list = await getSpectraAgentReleases(artifactId).catch(() => null);
    if (list) setReleases(list.releases);
    setNotice(
      action === "promote"
        ? "Promoted. Everyone who can use this agent now reaches this release."
        : "Rolled back to the previous release.",
    );
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
  const sufficiency = assessSufficiency(foundry.mission, foundry.state);
  const questionItems = established
    ? [...answered, ...open]
        .slice()
        .sort((left, right) => left.order - right.order || left.createdAt - right.createdAt)
        .map((section) => ({
          value: section.id,
          label: section.prompt.replace(/\s+/g, " ").trim() || FACET_LABEL[section.facet],
        }))
    : [
        {
          value: "foundation-objective",
          label: `What should ${artifactTitle.trim() || "this agent"} do?`,
        },
        {
          value: "foundation-interaction",
          label: "How should it feel to work with?",
        },
      ];
  const currentQuestionId =
    questionItems.some((item) => item.value === activeQuestionId)
      ? activeQuestionId
      : (questionItems[0]?.value ?? "");

  function focusQuestion(id: string) {
    setActiveQuestionId(id);
    const node = document.querySelector<HTMLElement>(
      `[data-foundry-question="${CSS.escape(id)}"]`,
    );
    node?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  const progressReadout =
    established && view === "overview" ? (
      <span
        className="spectra-workbar-progress"
        title={`${Math.round(sufficiency.coverage * 100)}% of the mission is established`}
      >
        <span className="spectra-workbar-progress-track">
          <span style={{ width: `${Math.round(sufficiency.coverage * 100)}%` }} />
        </span>
        <span>{Math.round(sufficiency.coverage * 100)}%</span>
      </span>
    ) : null;

  /* `newest` is what the creator last released, private or not, because that is
     the state the bar has to report. `serving` is what anyone else actually
     reaches, and it is the only sensible thing to roll back *to*. */
  const published = releases.filter((release) => release.status === "published");
  const highest = (list: SpectraAgentRelease[]) =>
    list.reduce<SpectraAgentRelease | undefined>(
      (best, release) =>
        !best || release.releaseNumber > best.releaseNumber ? release : best,
      undefined,
    );
  const newest = highest(published);
  const serving = highest(
    published.filter((release) => release.rollout !== "internal_test"),
  );

  /* Usage under the S8 rule: a number is drawn only where a measurement exists.
     `completionRate` and `averageLatencyMs` come back null when there is nothing
     to divide, and a missing denominator is not a zero. */
  const usageReadings = useMemo<
    ReadonlyArray<{ label: string; reading: MetricReading }>
  >(() => {
    if (analyticsState !== "ready" || !analytics)
      return [
        { label: "Times used", reading: { state: "loading" } },
        { label: "Did not finish", reading: { state: "loading" } },
        { label: "Average answer", reading: { state: "loading" } },
        { label: "Rating", reading: { state: "loading" } },
      ];
    const completed =
      analytics.completionRate === null
        ? null
        : Math.round(analytics.completionRate * analytics.invocations);
    return [
      {
        label: "Times used",
        reading: { state: "measured", value: String(analytics.invocations) },
      },
      {
        label: "Did not finish",
        reading:
          completed === null
            ? {
                state: "unknown",
                reason:
                  "Nothing has run yet, so there is nothing that failed to finish.",
              }
            : {
                state: "measured",
                value: String(Math.max(0, analytics.invocations - completed)),
              },
      },
      {
        label: "Average answer",
        reading:
          analytics.averageLatencyMs === null
            ? {
                state: "unknown",
                reason: "Timing is recorded only for runs that finished.",
              }
            : {
                state: "measured",
                value: `${(analytics.averageLatencyMs / 1000).toFixed(1)}s`,
              },
      },
      {
        label: "Rating",
        reading:
          analytics.feedback.averageRating === null
            ? {
                state: "unknown",
                reason: "Nobody has rated an answer from this agent yet.",
              }
            : {
                state: "measured",
                value: `${analytics.feedback.averageRating.toFixed(1)} of 5`,
              },
      },
    ];
  }, [analytics, analyticsState]);

  // One sentence per condition that needs explaining. A measured number explains
  // itself, so "Measured from product records." is not printed four times.
  const usageCaptions = useMemo(() => {
    const sentences = new Set<string>();
    for (const entry of usageReadings) {
      if (entry.reading.state === "measured" || entry.reading.state === "loading")
        continue;
      sentences.add(metricCaption(entry.reading));
    }
    return [...sentences];
  }, [usageReadings]);

  // Only the ratings people chose to share carry a comment, so a rating without
  // one is a number, not an empty quotation.
  const comments = useMemo(
    () =>
      (analytics?.feedback.comments ?? [])
        .filter((entry) => Boolean(entry.comment?.trim()))
        .slice(-3)
        .reverse(),
    [analytics],
  );

  if (!established) {
    return (
      <div className={`spectra-agent-foundry is-${mode} is-foundation`}>
        {/* Every work type gets one control row, including the first screen of
            one. This bar states what is being built and whether it is saved;
            the verb stays with the two questions it depends on. */}
        <ArtifactWorkbar
          label="Agent"
          modes={[]}
          context="New agent"
          selector={
            <WorkbarItemSelector
              ariaLabel="Current question"
              itemNoun="question"
              value={currentQuestionId}
              onChange={focusQuestion}
              items={questionItems}
            />
          }
        />
        <div className="foundry-foundation">
          <p className="foundry-eyebrow">Foundation</p>
          <p className="foundry-lede">
            Two answers set the foundation. What Spectra asks after them is
            decided by what you write here, so there is no fixed set of steps.
          </p>

          <label className="foundry-question" data-foundry-question="foundation-objective">
            <span className="foundry-question-prompt">
              What should {artifactTitle.trim() || "this agent"} do?
            </span>
            <LocalAutocompleteTextarea
              className="foundry-textarea"
              textareaClassName="foundry-input"
              surface="agent_foundry"
              rows={5}
              value={objective}
              onValueChange={setObjective}
              disabled={!canEdit || busy === "foundation"}
              placeholder="Say what it should produce, who it is for, and what makes a result correct."
            />
          </label>

          <label className="foundry-question" data-foundry-question="foundation-interaction">
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
              disabled={!canEdit || busy === "foundation"}
              placeholder="Direct and specific. It should never soften a weak answer."
            />
          </label>

          <FoundryProblem problem={problem} />

          <Button
            variant="primary"
            size="lg"
            className="self-start"
            disabled={
              !canEdit || busy === "foundation" || objective.trim().length < 10
            }
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
          </Button>
        </div>
      </div>
    );
  }

  /* One bar, one primary verb, and the modes the registry says this viewer may
     enter. The baseline put `Build | Continue | Compile skills` in one segmented
     control (two modes and a verb, with the verb styled as the active tab) and
     then repeated both verbs as buttons in the body. */
  const barActions: CommandBinding[] =
    projectBindingsFromIr(
      "agent",
      view === "overview"
      ? [
          {
            id: "next",
            label: busy === "next" ? "Working" : "Continue",
            icon: ArrowRight,
            priority: "essential",
            keepLabel: true,
            requires: "edit",
            disabled: !canEdit || busy === "next",
            hint: "Ask the next question this mission needs",
            onSelect: () => void requestSection(),
          },
          {
            id: "source",
            label: "Add a source",
            icon: Plus,
            priority: "essential",
            requires: "edit",
            disabled: !canEdit,
            onSelect: () => setEvidenceOpen(true),
          },
          ...(dismissed.length
            ? [
                {
                  id: "dismissed",
                  label: `${dismissed.length} dismissed`,
                  icon: RotateCcw,
                  priority: "secondary" as const,
                  active: showDismissed,
                  onSelect: () => setShowDismissed((value) => !value),
                },
              ]
            : []),
          {
            id: "competence",
            label: ledgerOpen ? "Hide competence" : "Competence",
            icon: Gauge,
            priority: "secondary" as const,
            active: ledgerOpen,
            onSelect: () => setLedgerOpen((open) => !open),
          },
        ]
      : view === "bench"
        ? [
            {
              id: "competence",
              label: ledgerOpen ? "Hide competence" : "Competence",
              icon: Gauge,
              priority: "secondary" as const,
              active: ledgerOpen,
              onSelect: () => setLedgerOpen((open) => !open),
            },
          ]
      : view === "checks"
        ? [
            {
              id: "refresh",
              label: "Refresh runs",
              icon: RotateCcw,
              priority: "secondary",
              requires: "edit",
              disabled: busy !== null,
              onSelect: () => void reloadRuns(),
            },
            {
              id: "competence",
              label: ledgerOpen ? "Hide competence" : "Competence",
              icon: Gauge,
              priority: "secondary" as const,
              active: ledgerOpen,
              onSelect: () => setLedgerOpen((open) => !open),
            },
          ]
        : [
            {
              id: "brief",
              label: "Operating brief",
              icon: ScrollText,
              priority: "secondary",
              active: showBrief,
              onSelect: () => setShowBrief((value) => !value),
            },
            {
              id: "competence",
              label: ledgerOpen ? "Hide competence" : "Competence",
              icon: Gauge,
              priority: "secondary" as const,
              active: ledgerOpen,
              onSelect: () => setLedgerOpen((open) => !open),
            },
            {
              id: "private",
              label: "Release to yourself",
              icon: Lock,
              priority: "advanced",
              requires: "edit",
              disabled:
                !canEdit ||
                !canPublish ||
                busy !== null ||
                privateBlockers.length > 0,
              hint: "Only you can use it, and it needs no passing check",
              onSelect: () => void publish("internal_test"),
            },
          ],
    );

  const benchBar = benchBarAction(bench, canEdit);
  const barPrimary =
    view === "overview"
      ? {
          label: busy === "compile" ? "Drafting skills" : "Compile skills",
          disabled: !canEdit || busy === "compile",
          busy: busy === "compile",
          requires: "edit" as const,
          onSelect: () => void compile(),
        }
      : view === "bench"
        ? {
            label: benchBar.label,
            icon: benchBar.stops ? Square : Play,
            disabled: benchBar.disabled,
            requires: "edit" as const,
            onSelect: benchBar.onSelect,
          }
      : view === "checks"
        ? {
            label: busy === "evaluate" ? "Running checks" : "Run checks",
            icon: FlaskConical,
            disabled: !canEdit || busy === "evaluate" || suite.length === 0,
            busy: busy === "evaluate",
            requires: "edit" as const,
            onSelect: () => void evaluate(),
          }
        : {
            label: busy === "publish" ? "Publishing" : "Publish",
            disabled:
              !canEdit ||
              !canPublish ||
              busy === "publish" ||
              publishBlockers.length > 0,
            busy: busy === "publish",
            requires: "edit" as const,
            onSelect: () => void publish("published"),
          };

  return (
    <div className={`spectra-agent-foundry is-${mode}`}>
      <ArtifactWorkbar
        label="Agent"
        modes={{ registry: true, value: view, onChange: setView }}
        context={newest ? `v${newest.releaseNumber} ${releaseLabel(newest)}` : "Not released"}
        selector={
          view === "overview" && questionItems.length ? (
            <WorkbarItemSelector
              ariaLabel="Current question"
              itemNoun="question"
              value={currentQuestionId}
              onChange={focusQuestion}
              items={questionItems}
            />
          ) : undefined
        }
        actions={barActions}
        primary={barPrimary}
        trailing={progressReadout}
        /* Below 1020px the stylesheet stacks the grid and gives the ledger
           `order: -1`, which put a status panel above the control row. The bar
           is ordered ahead of both, so the sequence stays bar, ledger headline,
           authoring surface at every width. */
        className="order-[-2]"
      />
      <div
        className="foundry-stream"
        data-ai-region={aiRegionAttr(pathTouches(aiChangedPaths, "/foundry"))}
      >
        {notice && (
          <p className="foundry-notice" role="status">
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
        <FoundryProblem problem={problem} />

        {view === "overview" ? (
          <>
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


        {answered.map((section) => {
          const editing = drafts[section.id] !== undefined;
          return (
            <article
              key={section.id}
              className="foundry-section is-answered"
              data-foundry-question={section.id}
              {...targetAttrs(`/foundry/sections/${section.id}`)}
            >
              <div className="foundry-section-head">
                <p className="foundry-section-facet">{FACET_LABEL[section.facet]}</p>
                <div className="foundry-section-actions">
                  <button
                    type="button"
                    className="foundry-text-button"
                    disabled={!canEdit}
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
                    disabled={!canEdit}
                    artifacts={artifacts}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!canEdit}
                    onClick={() => saveSection(section)}
                  >
                    Save
                  </Button>
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
            data-foundry-question={section.id}
            {...targetAttrs(`/foundry/sections/${section.id}`)}
          >
            <div className="foundry-section-head">
              <p className="foundry-section-facet">{FACET_LABEL[section.facet]}</p>
              {!section.required && (
                <button
                  type="button"
                  className="foundry-text-button"
                  disabled={!canEdit}
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
              disabled={!canEdit}
              artifacts={artifacts}
            />
            <Button
              variant="primary"
              size="sm"
              className="self-start"
              disabled={
                !canEdit || isEmptyValue(drafts[section.id] ?? section.value)
              }
              onClick={() => saveSection(section)}
            >
              Save and continue
            </Button>
          </article>
        ))}

        <div ref={streamEnd} />

        {/* `Continue building` and `Compile skills` were repeated here as body
            buttons while the same two verbs sat in the bar. They live in the bar
            only, and the dismissed list opens from there too. */}
        {showDismissed && (
          <ul className="foundry-dismissed">
            {dismissed.map((section) => (
              <li key={section.id}>
                <span>{section.prompt}</span>
                <button
                  type="button"
                  className="foundry-text-button"
                  disabled={!canEdit}
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
              disabled={!canEdit}
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
              <Button
                variant="primary"
                size="sm"
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
              </Button>
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
                      disabled={!canEdit}
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
                          disabled={!canEdit}
                          onClick={() => confirmEvidence(binding.id, true)}
                        >
                          <Check size={13} />
                          Read correctly
                        </button>
                        {binding.confirmed && (
                          <button
                            type="button"
                            className="foundry-text-button"
                            disabled={!canEdit}
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

          {waiting.length > 0 && (
            <ul className="foundry-skill-list is-proposed">
              {waiting.map((skill) => (
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
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!canEdit}
                      onClick={() => acceptSkill(skill)}
                    >
                      Approve
                    </Button>
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
                    disabled={!canEdit}
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

          {foundry.skills.length === 0 && waiting.length === 0 && (
            <p className="foundry-empty">
              Nothing compiled yet. Answer enough about the mission, then compile.
            </p>
          )}
        </section>

        {/* ---------------- end of the build stream ---------------- */}
          </>
        ) : null}

        {view === "bench" ? (
          <AgentBench
            bench={bench}
            content={agent}
            suite={compiledSuite}
            canEdit={canEdit}
            onApply={commit}
          />
        ) : null}

        {view === "checks" ? (
          <ChecksView
            suite={suite}
            runs={evalRuns}
            currentHash={currentHash}
            canEdit={canEdit}
            loading={runsLoading}
            benchCases={bench.cases}
          />
        ) : null}

        {view === "releases" ? (
          <>
            <section
              className="foundry-block"
              data-ai-region={aiRegionAttr(
                pathTouches(aiChangedPaths, "/routing"),
              )}
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
                Publishing compiles the mission, skills and evidence into a
                package that cannot change afterwards. A release needs an
                operating brief of at least {BRIEF_MINIMUM} characters
                {agent.routing.enabled
                  ? `, a routing sentence of at least ${ROUTING_MINIMUM},`
                  : ""}{" "}
                and a check run that passed on this exact draft. Earlier
                releases stay available to roll back to.
              </p>

              {/* The routing sentence is a publish gate and was never shown, so
                  the rejection arrived from a field nobody could read. */}
              <p
                className="foundry-skill-contract"
                {...targetAttrs("/routing/description")}
              >
                {agent.routing.enabled
                  ? `When Spectra should choose this agent: ${routingDescription || "not described yet."}`
                  : "Automatic routing is off, so this agent is only used when someone asks for it by name."}
              </p>

              {/* The Foundry binds sources as evidence and never writes
                  `content.resources`, but an agent converted from the old
                  editor can still carry them, and publish refuses if one is no
                  longer readable. Stated rather than hidden. */}
              {agent.resources.length > 0 && (
                <p className="foundry-ledger-note">
                  {agent.resources.length} attached{" "}
                  {agent.resources.length === 1 ? "item is" : "items are"} pinned
                  to this agent from an earlier version of the editor. Each one
                  has to still be readable by you when you publish, or the
                  release is refused.
                </p>
              )}

              {/* The operating brief is the 40-character gate. It is compiled,
                  not typed, so it is shown and counted rather than edited. */}
              <button
                type="button"
                className="foundry-text-button"
                aria-expanded={showBrief}
                onClick={() => setShowBrief((value) => !value)}
              >
                <ChevronDown
                  size={13}
                  style={{
                    transform: showBrief ? "rotate(0deg)" : "rotate(-90deg)",
                  }}
                />
                Operating brief · {brief.length} character
                {brief.length === 1 ? "" : "s"}
              </button>
              {showBrief && (
                <p
                  className="foundry-skill-purpose"
                  style={{ whiteSpace: "pre-wrap" }}
                  {...targetAttrs("/instructions/text")}
                >
                  {brief ||
                    "Nothing compiled yet. The brief is written from the mission and the approved skills."}
                </p>
              )}
              <p className="foundry-ledger-note">
                This is the whole of what the runtime reads. It is compiled from
                the mission and the approved skills, so it changes by changing
                them rather than by editing it here.
              </p>

              {publishBlockers.length > 0 && (
                <ul className="foundry-blockers">
                  {publishBlockers.map((blocker, index) => (
                    <li key={index}>{blocker}</li>
                  ))}
                </ul>
              )}

              {releases.length > 0 ? (
                <ul className="foundry-releases">
                  {releases.slice(0, 6).map((release) => {
                    const rollout = release.rollout ?? "published";
                    /* Both verbs are refused by the server unless the release
                       carries the passing check run it was published against,
                       and a private release never carries one. A door that
                       cannot open is removed rather than disabled. */
                    const evidenced = Boolean(release.evalRunId);
                    const promotable =
                      evidenced &&
                      release.status === "published" &&
                      rollout === "limited";
                    const restorable =
                      evidenced &&
                      release.status !== "deprecated" &&
                      serving !== undefined &&
                      release.releaseNumber < serving.releaseNumber;
                    return (
                      <li key={release.releaseId}>
                        <span className="foundry-release-number">
                          v{release.releaseNumber}
                        </span>
                        <StatusBadge tone={statusToneFor(releaseLabel(release))}>
                          {releaseLabel(release)}
                        </StatusBadge>
                        <span className="foundry-release-notes">
                          {release.releaseNotes || "No notes"}
                        </span>
                        {promotable ? (
                          <button
                            type="button"
                            className="foundry-text-button"
                            disabled={!canEdit || !canPublish || busy !== null}
                            onClick={() =>
                              void manageRelease(release.releaseId, "promote")
                            }
                          >
                            Promote
                          </button>
                        ) : restorable ? (
                          <button
                            type="button"
                            className="foundry-text-button"
                            disabled={!canEdit || !canPublish || busy !== null}
                            onClick={() =>
                              void manageRelease(release.releaseId, "rollback")
                            }
                          >
                            Roll back
                          </button>
                        ) : (
                          <span />
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="foundry-empty">
                  Nothing released yet. Release it to yourself first from the
                  bar, use it in a conversation, then publish it to the school.
                </p>
              )}
            </section>

            {/* ---------------- what happened when it was used ---------------- */}

            <section className="foundry-block">
              <div className="foundry-block-head">
                <h3>Use</h3>
                <span className="foundry-block-count">
                  {analyticsState === "ready" && analytics
                    ? `${analytics.feedback.count} rating${analytics.feedback.count === 1 ? "" : "s"}`
                    : ""}
                </span>
              </div>
              {analyticsState === "failed" ? (
                <p className="foundry-empty">
                  Usage could not be read just now. Reopen this view to try
                  again.
                </p>
              ) : !canEdit ? (
                /* `agents.analytics` requires `modify`, so a read-only viewer is
                   told that rather than left watching four skeletons that will
                   never resolve. */
                <p className="foundry-empty">
                  Usage figures are available to people who can edit this agent.
                </p>
              ) : (
                <>
                  <dl className="foundry-ledger-stats">
                    {usageReadings.map((entry) => (
                      <div key={entry.label}>
                        <dt>{entry.label}</dt>
                        <dd>
                          <MetricValue
                            reading={entry.reading}
                            valueClassName="text-editor"
                          />
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {usageCaptions.map((caption) => (
                    <p key={caption} className="foundry-ledger-note">
                      {caption}
                    </p>
                  ))}
                  {comments.length > 0 && (
                    <ul className="foundry-skill-list">
                      {comments.map((entry) => (
                        <li key={entry.createdAt} className="foundry-skill">
                          <div className="foundry-skill-head">
                            <span className="foundry-skill-name">
                              {entry.category}
                            </span>
                            <span className="foundry-skill-state">
                              {entry.rating} of 5 · {whenText(entry.createdAt)}
                            </span>
                          </div>
                          <p className="foundry-skill-purpose">
                            {entry.comment}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="foundry-ledger-note">
                    {analytics?.privacy ??
                      "Aggregates never include what anyone asked or what the agent answered."}
                  </p>
                  <p className="foundry-ledger-note">
                    Runs that did not finish are counted, not listed. Spectra
                    keeps no per-run record a creator can open yet.
                  </p>
                </>
              )}
            </section>
          </>
        ) : null}
      </div>

      <CompetenceLedger
        content={agent}
        skills={foundry.skills}
        evidence={foundry.evidenceBindings}
        extraGaps={ledgerGaps}
        open={ledgerOpen}
        onClose={() => setLedgerOpen(false)}
      />
    </div>
  );
}
