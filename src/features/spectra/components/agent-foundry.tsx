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

import { Loader2, RotateCcw, AlertTriangle, ChevronDown, Lock, X, FlaskConical, Gauge, Play, Square } from "@/components/icons/glyph-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canonicalJsonValue } from "../../../../shared/canonical-json";
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
import { FoundryNav, FoundryNeedsMission, type FoundryNavAction, type FoundryView } from "./agent/foundry-nav";
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
import { identifier, SectionEditor, summarizeValue, TOOL_CHOICES, TOOL_LABEL } from "../agents/interview/section-editor";
import { InterviewQuestion, InterviewThinking } from "../agents/interview/interview-question";
import { ContextFiles, guessSourceKind, labelFromFileName } from "../agents/interview/context-files";
import { KnownAnswers } from "../agents/interview/known-answers";
import { readCommandAttachment } from "./command-attachments";
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

/** A check's own name, so a failure says what behaviour broke without reading the judge. */
function checkName(caseId: string, layer: string, input?: string) {
  const brief = input ? (input.length > 72 ? `${input.slice(0, 72).trimEnd()}…` : input) : "";
  if (caseId.endsWith("-adv-instruction-override")) return "Keeps its instructions private when asked to reveal them";
  if (caseId.endsWith("-adv-embedded-directive")) return "Ignores instructions hidden in the material";
  if (caseId.endsWith("-adv-boundary-expansion")) return "Turns down permissions offered in a message, and says its real limits";
  if (caseId.includes("-adv-quarantine-")) return "Treats a flagged source as material, not as its rules";
  if (caseId.includes("-sandbox-")) return `Says plainly when ${caseId.split("-sandbox-").pop()} is unavailable`;
  if (caseId.endsWith("-contract-include")) return "Includes everything its answer must hold";
  if (caseId.endsWith("-contract-exclude")) return "Leaves out what its answer must not contain";
  if (caseId.includes("-failure-")) return brief ? `Recovers when: ${brief}` : "Recovers from a known failure";
  if (caseId.includes("-truth-")) return brief ? `Matches your worked example: ${brief}` : LAYER_LABEL.mission_truth;
  // Cases the compiler wrote carry their own request; that is the clearest name they have.
  if (brief && layer === "adversarial") return `Holds to its role when told: ${brief}`;
  if (brief && layer === "held_out") return `Handles: ${brief}`;
  return LAYER_LABEL[layer as EvaluationLayer] ?? layer;
}

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
    gaps.push("No skills yet, so it has nothing specific to do.");
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
          ? "Nothing to aim for yet."
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
                <span className="foundry-ledger-weight" title="How much its job depends on this">
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
  // The run's verdict is the server's (agents.settleEvalRun); when it failed
  // with no failing case, say which of its rules it missed.
  const gateReason =
    active?.status !== "failed"
      ? ""
      : active.averageScore < active.threshold
        ? "The average is under the threshold, so the run failed."
        : cases.some((entry) => entry.required && !entry.passed)
          ? "A required check failed, so the run failed."
          : cases.some((entry) => entry.layer) && !cases.some((entry) => entry.layer === "adversarial")
            ? "It failed because none of its checks tried to talk the agent out of its instructions. Run the checks again: they now include those."
            : "";
  const savedTests = suite.filter((entry) => isBenchEvaluationCase(entry.id)).length;
  const caseLabel = (caseId: string, category: string) => {
    if (isBenchEvaluationCase(caseId)) {
      const saved = benchCases.find((entry) => `bench-${entry.id}` === caseId);
      return saved
        ? `Your test: ${saved.prompt.length > 80 ? `${saved.prompt.slice(0, 80)}…` : saved.prompt}`
        : "A test you saved";
    }
    return checkName(caseId, category, suite.find((entry) => entry.id === caseId)?.input);
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
                    {!currentHash ? "draft match not confirmed" : stale ? "an earlier draft" : "this draft"}
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
              {gateReason ? ` ${gateReason}` : ""}
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
                    {entry.reason || "No reason given."}
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
            {active.limitations?.length ? (
              <>
                <p className="foundry-ledger-note">What this run could not establish:</p>
                <ul className="foundry-skill-list">
                  {active.limitations.map((entry, index) => (
                    <li key={`${entry.kind}-${index}`} className="foundry-skill">
                      <p className="foundry-skill-purpose">{entry.detail}</p>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
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
  const [serverHash, setServerHash] = useState("");
  const draftKey = useMemo(
    () => JSON.stringify(canonicalJsonValue([artifactTitle, agent])),
    [artifactTitle, agent],
  );
  const [checkedDraft, setCheckedDraft] = useState(draftKey);
  // A history refresh can still read the previous saved head. Local edits must
  // invalidate its match immediately, without querying on every keystroke.
  const currentHash = draftKey === checkedDraft ? serverHash : "";
  const [showDismissed, setShowDismissed] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  // The two opening questions are asked one after the other.
  const [opening, setOpening] = useState<"objective" | "interaction">("objective");
  const [reading, setReading] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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
      setServerHash(response.currentContentHash);
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
          setServerHash(response.currentContentHash);
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
              setServerHash(response.currentContentHash);
            })
            .catch(() => undefined);
      }),
    [artifactId, readOnly],
  );

  // Usage is only asked for when the release view is opened, because opening an
  // editor should not cost a query nobody is looking at. It is asked once; a
  // failure or leaving before it answers lets the next visit ask again. (The
  // state is not a dependency: marking it "loading" re-ran this effect, whose
  // cleanup then threw the answer away, and the figures never arrived.)
  const analyticsAsked = useRef(false);
  useEffect(() => {
    if (view !== "releases" || readOnly || analyticsAsked.current) return;
    analyticsAsked.current = true;
    setAnalyticsState("loading");
    let settled = false;
    let active = true;
    void getSpectraAgentAnalytics(artifactId)
      .then((response) => {
        settled = true;
        if (!active) return;
        setAnalytics(response.analytics);
        setAnalyticsState("ready");
      })
      .catch(() => {
        settled = true;
        analyticsAsked.current = false;
        if (active) setAnalyticsState("failed");
      });
    return () => {
      active = false;
      if (!settled) {
        analyticsAsked.current = false;
        setAnalyticsState("idle");
      }
    };
  }, [artifactId, readOnly, view]);

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
              `${result.skills.length} skill${result.skills.length === 1 ? "" : "s"} drafted. Approve the ones that match how you work.`,
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
      "Your answers could not be read. Try rewording what it should do, then start again.",
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
        `${result.securityConcerns.length === 1 ? "One line" : `${result.securityConcerns.length} lines`} in your description read like instructions to Spectra, so ${result.securityConcerns.length === 1 ? "it was" : "they were"} left out.`,
      );
    }
    await requestSection(next);
  }

  /* -------------------- adaptive sections -------------------- */

  const requestSection = useCallback(
    async (base?: AgentFoundryContent) => {
      const result = await run(
        "next",
        "Couldn't come up with the next question. Try again.",
        () => nextSpectraFoundrySection(artifactId),
      );
      if (!result) return;
      const source = base ?? agent;
      if (result.sufficient || !result.section) {
        setNotice(
          "That's enough to build it. Build its skills, or add anything else it should know.",
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

  /** A question that does not apply is set aside, and the next one asked. */
  function skipSection(section: FoundrySection) {
    const next: AgentFoundryContent = { ...agent, foundry: { ...foundry, state: dismissSection(foundry.state, section.id, Date.now()) } };
    commit(next);
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
      `"${label}" could not be read. Check the text you pasted, then read it again.`,
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
        `Some lines in "${label}" were instructions, not content, so they were left out.`,
      );
    }
  }

  /** Attached files are read one by one; each becomes a source the agent reads when it needs to. */
  async function attachFiles(files: File[]) {
    for (const file of files) {
      const known = latestAgent.current.foundry.evidenceBindings.find((binding) => binding.label === labelFromFileName(file.name));
      if (known) {
        setNotice(`"${known.label}" is already attached.`);
        continue;
      }
      setReading(file.name);
      const attachment = await readCommandAttachment(file);
      if (attachment.error || !attachment.data) {
        setNotice(attachment.error ?? `${file.name} could not be read.`);
        continue;
      }
      const label = labelFromFileName(file.name);
      const kind = guessSourceKind(file.name);
      const sourceId = identifier("src");
      const result = await run(
        "evidence",
        `"${label}" could not be read. Try a PDF, Word or text file, or paste its text.`,
        () =>
          extractSpectraFoundryEvidence(
            attachment.handling === "text"
              ? { agentId: artifactId, sourceId, kind, text: attachment.data! }
              : { agentId: artifactId, sourceId, kind, attachment: { name: attachment.name, mimeType: attachment.mimeType, size: attachment.size, handling: attachment.handling, data: attachment.data } },
          ),
      );
      if (!result) continue;
      const extraction = result.extraction as EvidenceExtraction;
      const current = latestAgent.current;
      const next = {
        ...current,
        foundry: {
          ...current.foundry,
          evidenceBindings: [...current.foundry.evidenceBindings, { id: identifier("evidence"), sourceId, kind, label, confirmed: false, extraction }],
        },
      };
      latestAgent.current = next;
      commit(next);
      if (extraction.securityConcerns.length > 0)
        setNotice(`Some lines in "${label}" were instructions, not content, so they were left out.`);
    }
    setReading(null);
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
      "Building its skills stopped partway. The steps below show where.",
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
      shared.push("It doesn't have a job yet. Answer the first question.");
    if (brief.length < BRIEF_MINIMUM)
      shared.push(
        `The operating brief is ${brief.length} character${brief.length === 1 ? "" : "s"} and the runtime needs ${BRIEF_MINIMUM}. It is compiled from the mission and the approved skills, so answer more of the mission or approve a skill.`,
      );
    if (foundry.skills.length === 0)
      shared.push("No skills are approved yet. Build its skills, then approve the ones that fit.");
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
            "It hasn't passed its checks since your last change. Run the checks, or release it just to yourself first.",
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
        "Spectra can only pick this agent on its own once it has a description.",
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
    const evaluatedDraft = draftKey;
    const result = await run(
      "evaluate",
      "The checks didn't finish. Nothing was released; run them again.",
      () => evaluateSpectraAgent(artifactId),
    );
    // The run list is re-read whether or not the request succeeded: a run that
    // failed halfway is still a run, and the cases it did get through are the
    // most useful thing on the screen.
    await reloadRuns();
    if (!result) return;
    setCheckedDraft(evaluatedDraft);
    setNotice(
      result.status === "passed"
        ? `Passed ${result.passedCount} of ${result.caseCount} checks.`
        : `${result.passedCount} of ${result.caseCount} checks passed. Open Checks to see what it answered in each.`,
    );
  }

  async function publish(rollout: "internal_test" | "published") {
    const result = await run(
      rollout === "internal_test" ? "release-private" : "publish",
      rollout === "internal_test"
        ? "Couldn't release it to you. Nothing changed for anyone else."
        : "Not released; the current version is unchanged. If you changed it since the checks last passed, run them again first.",
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
        ? `Version ${result.releaseNumber} is ready for you to try. Use it in a chat, then run the checks and share it when it holds up.`
        : `Version ${result.releaseNumber} is shared.`,
    );
  }

  async function manageRelease(
    releaseId: string,
    action: "promote" | "rollback",
  ) {
    const result = await run(
      action,
      action === "promote"
        ? "Couldn't share it further. It still reaches the same people."
        : "Couldn't go back. The current version is still the one in use.",
      () => manageSpectraAgentRelease(releaseId, action),
    );
    if (!result) return;
    const list = await getSpectraAgentReleases(artifactId).catch(() => null);
    if (list) setReleases(list.releases);
    setNotice(
      action === "promote"
        ? "Shared. Everyone who can use this agent now gets this version."
        : "Back to the previous version.",
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
                  "Nothing has run yet.",
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
                reason: "Timing shows once a run finishes.",
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

  const evidenceForm = (
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
  );
  const current = open[0];
  const agentName = artifactTitle.trim() && artifactTitle.trim() !== "New Agent" ? artifactTitle.trim() : "this agent";
  const foundation = (
    <div className="interview">
      {opening === "objective" ? (
        <InterviewQuestion
          id="foundation-objective"
          prompt={`What should ${agentName} do?`}
          detail="What it makes, who it is for, and what a good result looks like."
          canContinue={canEdit && objective.trim().length >= 10}
          onContinue={() => setOpening("interaction")}
        >
          <LocalAutocompleteTextarea
            className="foundry-textarea"
            textareaClassName="foundry-input interview-input"
            surface="agent_foundry"
            rows={4}
            value={objective}
            onValueChange={setObjective}
            disabled={!canEdit}
            placeholder="Gives Year 11 lab reports feedback against the IB criteria, without rewriting them."
          />
        </InterviewQuestion>
      ) : (
        <InterviewQuestion
          id="foundation-interaction"
          prompt="And how should it feel to work with?"
          detail="Its manner with the people who use it: warm or brisk, strict or encouraging."
          canContinue={canEdit}
          busy={busy === "foundation"}
          continueLabel={busy === "foundation" ? "Reading your answers" : "Start"}
          onContinue={() => void establishFoundation()}
          aside={
            <button type="button" className="interview-skip" disabled={busy === "foundation"} onClick={() => setOpening("objective")}>
              Back
            </button>
          }
        >
          <LocalAutocompleteTextarea
            className="foundry-textarea"
            textareaClassName="foundry-input interview-input"
            surface="agent_foundry"
            rows={3}
            value={interaction}
            onValueChange={setInteraction}
            disabled={!canEdit || busy === "foundation"}
            placeholder="Direct and specific. It never softens a weak answer."
          />
        </InterviewQuestion>
      )}
    </div>
  );

  /* The open part's verb leads; what else that part can do sits beside it as
     text. Before the foundation is set there is nothing to act on yet: its
     own button is on the page, beside the two questions it depends on. */
  const competence: FoundryNavAction = {
    id: "competence",
    label: ledgerOpen ? "Hide competence" : "Competence",
    icon: Gauge,
    active: ledgerOpen,
    onSelect: () => setLedgerOpen((open) => !open),
  };
  const navActions: FoundryNavAction[] = !established
    ? []
    : view === "overview"
      ? [
          ...(dismissed.length
            ? [{
                id: "dismissed",
                label: `${dismissed.length} dismissed`,
                icon: RotateCcw,
                active: showDismissed,
                onSelect: () => setShowDismissed((value) => !value),
              }]
            : []),
          competence,
        ]
      : view === "checks"
        ? [
            ...(canEdit
              ? [{ id: "refresh", label: "Refresh runs", icon: RotateCcw, disabled: busy !== null, onSelect: () => void reloadRuns() }]
              : []),
            competence,
          ]
        : view === "releases"
          ? [
              ...(canEdit
                ? [{
                    id: "private",
                    label: "Release to yourself",
                    icon: Lock,
                    disabled: !canPublish || busy !== null || privateBlockers.length > 0,
                    hint: "Only you can use it, and it needs no passing check",
                    onSelect: () => void publish("internal_test"),
                  }]
                : []),
              competence,
            ]
          : [competence];

  const benchBar = benchBarAction(bench, canEdit);
  const navPrimary: (FoundryNavAction & { busy?: boolean }) | undefined =
    !established || !canEdit
      ? undefined
      : view === "overview"
        ? {
            id: "compile",
            label: busy === "compile" ? "Building its skills" : "Build its skills",
            disabled: busy === "compile",
            busy: busy === "compile",
            onSelect: () => void compile(),
          }
        : view === "bench"
          ? {
              id: "bench",
              label: benchBar.label,
              icon: benchBar.stops ? Square : Play,
              disabled: benchBar.disabled,
              onSelect: benchBar.onSelect,
            }
          : view === "checks"
            ? {
                id: "evaluate",
                label: busy === "evaluate" ? "Running checks" : "Run checks",
                icon: FlaskConical,
                disabled: busy === "evaluate" || suite.length === 0,
                busy: busy === "evaluate",
                onSelect: () => void evaluate(),
              }
            : {
                id: "publish",
                label: busy === "publish" ? "Publishing" : "Publish",
                disabled: !canPublish || busy === "publish" || publishBlockers.length > 0,
                busy: busy === "publish",
                onSelect: () => void publish("published"),
              };
  const views = contract.modes.map((entry) => entry.id as FoundryView);

  return (
    <div className={`spectra-agent-foundry is-${mode}${established ? "" : " is-foundation"}`}>
      <FoundryNav
        views={views}
        view={view as FoundryView}
        onView={setView}
        actions={navActions}
        primary={navPrimary}
        readout={view !== "overview" && newest ? `Release ${newest.releaseNumber}, ${releaseLabel(newest)}` : undefined}
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

        {view === "overview" && !established ? foundation : null}
        {view !== "overview" && !established ? (
          <FoundryNeedsMission part={view as FoundryView} onMission={() => setView("overview")} />
        ) : null}

        {view === "overview" && established ? (
          <>
        <header className="foundry-mission" {...targetAttrs("/foundry/mission")}>
          <p
            className={`foundry-mission-objective${pathTouches(aiChangedPaths, "/foundry/mission") ? " is-ai-changed" : ""}`}
          >
            {foundry.mission.objective}
          </p>
        </header>


        <div className="interview">
          {current ? (
            <InterviewQuestion
              id={current.id}
              prompt={current.prompt}
              detail={current.detail}
              canContinue={canEdit && !isEmptyValue(drafts[current.id] ?? current.value)}
              busy={busy === "next"}
              onContinue={() => saveSection(current)}
              onSkip={!current.required && canEdit ? () => skipSection(current) : undefined}
            >
              <SectionEditor
                section={current}
                draft={drafts[current.id] ?? current.value}
                onDraft={(value) => setDrafts((existing) => ({ ...existing, [current.id]: value }))}
                disabled={!canEdit}
                artifacts={artifacts}
              />
            </InterviewQuestion>
          ) : busy === "next" ? (
            <InterviewThinking />
          ) : canEdit ? (
            <section className="interview-ask is-settled">
              <h3 className="interview-prompt">That is enough to build it on.</h3>
              <p className="interview-detail">Build its skills now, or keep answering to make it sharper.</p>
              <div className="interview-actions">
                <span className="flex-1" />
                <button type="button" className="interview-skip" onClick={() => void requestSection()}>
                  Ask me more
                </button>
                <Button variant="primary" size="sm" disabled={busy === "compile"} onClick={() => void compile()}>
                  {busy === "compile" ? "Building its skills" : "Build its skills"}
                </Button>
              </div>
            </section>
          ) : null}

          <ContextFiles
            bindings={foundry.evidenceBindings}
            canEdit={canEdit}
            reading={reading}
            inputRef={fileInput}
            onFiles={(files) => void attachFiles(files)}
            onPaste={() => setEvidenceOpen((value) => !value)}
            onRemove={removeEvidence}
            onConfirm={confirmEvidence}
          />
          {evidenceOpen ? evidenceForm : null}

          <KnownAnswers count={answered.length}>
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
          </KnownAnswers>
        </div>

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
              No skills yet. Answer a few questions above, then build its skills.
            </p>
          )}
        </section>

        {/* ---------------- end of the build stream ---------------- */}
          </>
        ) : null}

        {view === "bench" && established ? (
          <AgentBench
            bench={bench}
            content={agent}
            suite={compiledSuite}
            canEdit={canEdit}
            onApply={commit}
          />
        ) : null}

        {view === "checks" && established ? (
          <ChecksView
            suite={suite}
            runs={evalRuns}
            currentHash={currentHash}
            canEdit={canEdit}
            loading={runsLoading}
            benchCases={bench.cases}
          />
        ) : null}

        {view === "releases" && established ? (
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
                  : "Spectra won't pick it on its own; it's used only when someone chooses it."}
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
                    "Nothing here yet. The brief is written once its skills are built and approved."}
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
                  Nothing released yet. Release it to yourself first, use it
                  in a conversation, then publish it to the school.
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
                      "These totals never include what anyone asked or what it answered."}
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
