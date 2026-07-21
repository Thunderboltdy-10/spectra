"use client";

import {
  AlertCircle,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  Eye,
  Loader2,
  Plus,
  Rocket,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Trash2,
  Upload,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  agentConfigurationIssues,
  normalizeAgentContent,
  type AgentContent,
  type AgentSkill,
  type AgentTool,
} from "../agents/model";
import {
  abortArtifactImportUpload,
  beginArtifactImportOriginal,
  completeArtifactImport,
  decideSpectraAgentImprovement,
  evaluateSpectraAgent,
  generateSpectraAgentEvalSuite,
  getSpectraAgentAnalytics,
  getSpectraAgentEvalRuns,
  getSpectraAgentResourceHealth,
  getSpectraAgentReleases,
  manageSpectraAgentRelease,
  publishSpectraAgent,
  proposeSpectraAgentImprovement,
  signSpectraAgentManifest,
  uploadArtifactImportOriginal,
  verifySpectraAgentManifest,
  type SpectraAgentAnalytics,
  type SpectraAgentEvalRun,
  type SpectraAgentResourceHealth,
  type SpectraAgentRelease,
  type SpectraArtifact,
} from "../data/api";

const STEPS = [
  { title: "Purpose", detail: "Goal, scope and outcomes", icon: Sparkles },
  {
    title: "Users & access",
    detail: "Audience and automatic routing",
    icon: Users,
  },
  {
    title: "Knowledge & resources",
    detail: "Permissioned source material",
    icon: BookOpen,
  },
  {
    title: "Capabilities",
    detail: "Skills, tools and approvals",
    icon: Wrench,
  },
  {
    title: "Tone & behavior",
    detail: "Instructions and boundaries",
    icon: ShieldCheck,
  },
  {
    title: "Review & publish",
    detail: "Evals, release and recovery",
    icon: Rocket,
  },
] as const;

const TOOL_CATALOG: Array<{
  key: AgentTool["key"];
  label: string;
  detail: string;
}> = [
  {
    key: "artifact_search",
    label: "Find artifacts",
    detail: "Search only content the invoking user can access",
  },
  {
    key: "artifact_read",
    label: "Read artifacts",
    detail: "Inspect permissioned artifact regions",
  },
  {
    key: "artifact_create",
    label: "Create artifacts",
    detail: "Create typed Spectra work",
  },
  {
    key: "artifact_edit",
    label: "Edit artifacts",
    detail: "Propose or apply region-safe changes",
  },
  {
    key: "memory_retrieve",
    label: "Use personal memory",
    detail: "Retrieve only the invoking user's permission-bound memory",
  },
  {
    key: "school_data",
    label: "Read school data",
    detail: "Use the invoking user's verified, read-only school records",
  },
  {
    key: "web_search",
    label: "Web research",
    detail: "Retrieve current public sources",
  },
];

function identifier(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function sha256Blob(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ChipsEditor({
  label,
  values,
  onChange,
  tone = "green",
  placeholder = "Add item",
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  tone?: "green" | "orange" | "violet";
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onChange(Array.from(new Set([...values, value])));
    setDraft("");
  };
  return (
    <label className="agent-field">
      <span>{label}</span>
      <div className="agent-chip-editor" data-tone={tone}>
        {values.map((value) => (
          <button
            type="button"
            key={value}
            onClick={() => onChange(values.filter((item) => item !== value))}
            title={`Remove ${value}`}
          >
            {value} <X />
          </button>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
        />
        <button type="button" className="agent-chip-add" onClick={add}>
          <Plus />
        </button>
      </div>
    </label>
  );
}

export function AgentStudio({
  artifactId,
  artifactTitle,
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
  artifacts: SpectraArtifact[];
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
  readOnly?: boolean;
  canPublish?: boolean;
  onActiveRegionChange?: (regionId: string) => void;
}) {
  const normalized = useMemo(() => normalizeAgentContent(content), [content]);
  const [agent, setAgent] = useState(normalized);
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [generatingSuite, setGeneratingSuite] = useState(false);
  const [releaseMessage, setReleaseMessage] = useState<string>();
  const [releases, setReleases] = useState<SpectraAgentRelease[]>([]);
  const [evalRuns, setEvalRuns] = useState<SpectraAgentEvalRun[]>([]);
  const [currentContentHash, setCurrentContentHash] = useState("");
  const [analytics, setAnalytics] = useState<SpectraAgentAnalytics>();
  const [resourceHealth, setResourceHealth] = useState<
    SpectraAgentResourceHealth[]
  >([]);
  const [rollout, setRollout] = useState<
    "internal_test" | "limited" | "published"
  >("published");
  const [releaseBusy, setReleaseBusy] = useState<string>();
  const [proposalBusy, setProposalBusy] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalEvidence, setProposalEvidence] = useState("");
  const [proposalImpact, setProposalImpact] = useState("");
  const [proposalInstructions, setProposalInstructions] = useState("");
  const [skillDraft, setSkillDraft] = useState("");
  const [importMessage, setImportMessage] = useState<string>();
  const [manifestBusy, setManifestBusy] = useState<"export" | "import" | null>(
    null,
  );
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => setAgent(normalized), [normalized]);
  useEffect(() => {
    onActiveRegionChange?.(
      [
        "profile",
        "audience",
        "resources",
        "capabilities",
        "behavior",
        "release",
      ][step]!,
    );
  }, [onActiveRegionChange, step]);
  useEffect(() => {
    let active = true;
    void getSpectraAgentReleases(artifactId)
      .then((response) => {
        if (active) setReleases(response.releases);
      })
      .catch(() => undefined);
    if (!readOnly)
      void Promise.all([
        getSpectraAgentEvalRuns(artifactId),
        getSpectraAgentAnalytics(artifactId),
        getSpectraAgentResourceHealth(artifactId),
      ])
        .then(([evaluationResponse, analyticsResponse, resourceResponse]) => {
          if (!active) return;
          setEvalRuns(evaluationResponse.runs);
          setCurrentContentHash(evaluationResponse.currentContentHash);
          setAnalytics(analyticsResponse.analytics);
          setResourceHealth(resourceResponse.resources);
        })
        .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [artifactId, readOnly]);

  const issues = agentConfigurationIssues(agent);
  const linkedResources = agent.resources.map((resource) => ({
    resource,
    artifact: artifacts.find(
      (artifact) => artifact._id === resource.artifactId,
    ),
    health: resourceHealth.find(
      (candidate) =>
        candidate.id === resource.id ||
        candidate.artifactId === resource.artifactId,
    ),
  }));
  const hasPassingCurrentEval = evalRuns.some(
    (run) =>
      run.status === "passed" &&
      Boolean(currentContentHash) &&
      run.contentHash === currentContentHash,
  );
  const publishNeedsEval = rollout !== "internal_test";

  function commit(next: AgentContent) {
    if (readOnly) return;
    setAgent(next);
    onChange(next);
  }

  function updateProfile(patch: Partial<AgentContent["profile"]>) {
    commit({ ...agent, profile: { ...agent.profile, ...patch } });
  }

  function addSkill() {
    const name = skillDraft.trim();
    if (!name) return;
    const skill: AgentSkill = {
      id: identifier("skill"),
      name,
      instructions: "",
      enabled: true,
    };
    commit({ ...agent, skills: [...agent.skills, skill] });
    setSkillDraft("");
  }

  function toggleTool(key: AgentTool["key"]) {
    const existing = agent.tools.find((tool) => tool.key === key);
    commit({
      ...agent,
      tools: existing
        ? agent.tools.map((tool) =>
            tool.key === key ? { ...tool, enabled: !tool.enabled } : tool,
          )
        : [
            ...agent.tools,
            {
              id: identifier("tool"),
              key,
              enabled: true,
              approval:
                key === "artifact_create" || key === "artifact_edit"
                  ? "consequential"
                  : "never",
            },
          ],
    });
  }

  async function publish() {
    if (
      !canPublish ||
      issues.length ||
      publishing ||
      (publishNeedsEval && !hasPassingCurrentEval)
    )
      return;
    setPublishing(true);
    setReleaseMessage(undefined);
    try {
      const result = await publishSpectraAgent(
        artifactId,
        agent.releaseNotes || undefined,
        rollout,
      );
      const response = await getSpectraAgentReleases(artifactId);
      setReleases(response.releases);
      setReleaseMessage(
        rollout === "published"
          ? `Release ${result.releaseNumber} is live. Automatic routing now loads this immutable package, not the live draft.`
          : `Release ${result.releaseNumber} entered ${rollout === "limited" ? "limited rollout" : "internal testing"}.`,
      );
    } catch (error) {
      setReleaseMessage(
        error instanceof Error
          ? error.message
          : "The agent could not be published.",
      );
    } finally {
      setPublishing(false);
    }
  }

  async function runEvaluation() {
    if (evaluating || readOnly || issues.length || !agent.evals.length) return;
    setEvaluating(true);
    setReleaseMessage(undefined);
    try {
      const result = await evaluateSpectraAgent(artifactId);
      const response = await getSpectraAgentEvalRuns(artifactId);
      setEvalRuns(response.runs);
      setCurrentContentHash(response.currentContentHash);
      setReleaseMessage(
        result.status === "passed"
          ? `${result.passedCount}/${result.caseCount} cases passed with an average score of ${Math.round(result.averageScore * 100)}%. This exact draft can now enter rollout.`
          : `${result.passedCount}/${result.caseCount} cases passed. Review the failed evidence before publishing.`,
      );
    } catch (error) {
      setReleaseMessage(
        error instanceof Error
          ? error.message
          : "The evaluation suite could not run.",
      );
    } finally {
      setEvaluating(false);
    }
  }

  async function generateEvaluationSuite() {
    if (evaluating || generatingSuite || readOnly || issues.length) return;
    setGeneratingSuite(true);
    setReleaseMessage(undefined);
    try {
      const response = await generateSpectraAgentEvalSuite(artifactId);
      commit({ ...agent, evals: response.cases });
      setReleaseMessage(
        "Generated eight synthetic quality, boundary, privacy, injection, and source-truthfulness cases. Review their observable criteria before running them.",
      );
    } catch (error) {
      setReleaseMessage(
        error instanceof Error
          ? error.message
          : "The synthetic suite could not be generated.",
      );
    } finally {
      setGeneratingSuite(false);
    }
  }

  async function manageRelease(
    release: SpectraAgentRelease,
    action: "promote" | "rollback" | "suspend" | "deprecate",
  ) {
    if (!canPublish || releaseBusy) return;
    setReleaseBusy(release.releaseId);
    setReleaseMessage(undefined);
    try {
      await manageSpectraAgentRelease(release.releaseId, action);
      const response = await getSpectraAgentReleases(artifactId);
      setReleases(response.releases);
      setReleaseMessage(
        action === "rollback"
          ? `New invocations now use release ${release.releaseNumber}; later history remains intact.`
          : `Release ${release.releaseNumber} was ${action === "promote" ? "promoted" : action === "suspend" ? "suspended" : "deprecated"}.`,
      );
    } catch (error) {
      setReleaseMessage(
        error instanceof Error
          ? error.message
          : "The release could not be updated.",
      );
    } finally {
      setReleaseBusy(undefined);
    }
  }

  async function createImprovementProposal() {
    if (
      proposalBusy ||
      readOnly ||
      proposalEvidence.trim().length < 10 ||
      proposalImpact.trim().length < 10 ||
      proposalInstructions.trim().length < 40
    )
      return;
    setProposalBusy(true);
    try {
      await proposeSpectraAgentImprovement({
        agentId: artifactId,
        evidence: proposalEvidence,
        expectedImpact: proposalImpact,
        proposedPatch: { instructionsText: proposalInstructions },
        evalRunId: evalRuns.find((run) => run.status === "passed")?._id,
      });
      const response = await getSpectraAgentAnalytics(artifactId);
      setAnalytics(response.analytics);
      setProposalOpen(false);
      setProposalEvidence("");
      setProposalImpact("");
      setProposalInstructions("");
      setReleaseMessage(
        "Improvement proposed. Accepting it updates only the draft; a fresh passing suite is still required before rollout.",
      );
    } catch (error) {
      setReleaseMessage(
        error instanceof Error
          ? error.message
          : "The improvement proposal could not be saved.",
      );
    } finally {
      setProposalBusy(false);
    }
  }

  async function decideImprovement(
    proposalId: string,
    decision: "accepted" | "rejected",
  ) {
    if (proposalBusy || readOnly) return;
    setProposalBusy(true);
    try {
      await decideSpectraAgentImprovement(proposalId, decision);
      const [analyticsResponse, evalResponse] = await Promise.all([
        getSpectraAgentAnalytics(artifactId),
        getSpectraAgentEvalRuns(artifactId),
      ]);
      setAnalytics(analyticsResponse.analytics);
      setEvalRuns(evalResponse.runs);
      setCurrentContentHash(evalResponse.currentContentHash);
      if (decision === "accepted")
        window.dispatchEvent(new Event("spectra:artifacts-changed"));
      setReleaseMessage(
        decision === "accepted"
          ? "The proposal is now in the live draft. Review it here and run the complete suite before publishing."
          : "The proposal was rejected without changing the draft.",
      );
    } catch (error) {
      setReleaseMessage(
        error instanceof Error
          ? error.message
          : "The proposal decision could not be saved.",
      );
    } finally {
      setProposalBusy(false);
    }
  }

  async function exportManifest() {
    if (manifestBusy) return;
    setManifestBusy("export");
    setImportMessage(undefined);
    try {
      const response = await signSpectraAgentManifest({
        format: "spectra.agent",
        version: 1,
        exportedAt: new Date().toISOString(),
        content: agent,
        resources: agent.resources.map(
          ({ artifactId, label, mode, versionPolicy, pinnedVersionId }) => ({
            artifactId,
            label,
            mode,
            versionPolicy,
            pinnedVersionId,
          }),
        ),
      });
      downloadJson(
        `${artifactTitle.replace(/[^a-z0-9-_]+/gi, "-") || "agent"}.spectra-agent.json`,
        response.manifest,
      );
      setImportMessage(
        "Exported a server-signed portable manifest without secrets, private invocations, prompts, memory, or copied resource content.",
      );
    } catch (error) {
      setImportMessage(
        error instanceof Error
          ? error.message
          : "The signed manifest could not be exported.",
      );
    } finally {
      setManifestBusy(null);
    }
  }

  async function importManifest(file: File) {
    if (manifestBusy || readOnly) return;
    setManifestBusy("import");
    setImportMessage(undefined);
    let jobId: string | undefined;
    let originalRetained = false;
    try {
      if (!file.size) throw new Error("The manifest is empty.");
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Manifest exceeds the 5 MB parsing safety ceiling.");
      const beginning = await beginArtifactImportOriginal({
        artifactId,
        typeKey: "agent",
        format: "spectra-agent-json",
        name: file.name,
        mimeType: file.type || "application/json",
        bytes: file.size,
        sha256: await sha256Blob(file),
      });
      jobId = beginning.jobId;
      try {
        await uploadArtifactImportOriginal(jobId, file);
        originalRetained = true;
      } catch (error) {
        await abortArtifactImportUpload(
          jobId,
          error instanceof Error ? error.message : "Original upload failed.",
        ).catch(() => undefined);
        throw error;
      }
      const parsed = JSON.parse(await file.text()) as unknown;
      const verified = await verifySpectraAgentManifest(parsed);
      const imported = normalizeAgentContent(verified.manifest.content);
      const missing = imported.resources.filter(
        (resource) =>
          !artifacts.some((artifact) => artifact._id === resource.artifactId),
      );
      if (missing.length)
        throw new Error(
          `${missing.length} referenced resource${missing.length === 1 ? " is" : "s are"} unavailable or inaccessible in this school.`,
        );
      const configurationIssues = agentConfigurationIssues(imported);
      await completeArtifactImport({
        jobId,
        typeKey: "agent",
        status: "imported",
        fidelityReport: [
          {
            scope: "Manifest integrity",
            level: "exact",
            message:
              "The server signature is valid and the portable configuration is unchanged.",
          },
          {
            scope: "Resource bindings",
            level: "exact",
            message: `${imported.resources.length} referenced resource${imported.resources.length === 1 ? " is" : "s are"} available under the importing user's current permissions.`,
          },
          ...(configurationIssues.length
            ? [
                {
                  scope: "Release readiness",
                  level: "adapted" as const,
                  message: `${configurationIssues.length} release gate${configurationIssues.length === 1 ? " remains" : "s remain"}; the configuration is imported as a draft and cannot publish until resolved.`,
                },
              ]
            : []),
        ],
        unsupportedFeatures: [],
        importedContent: imported,
      });
      commit(imported);
      setImportMessage(
        `Signed manifest imported as a live draft. The exact original is retained privately.${configurationIssues.length ? ` Resolve ${configurationIssues.length} release gate${configurationIssues.length === 1 ? "" : "s"} before publishing.` : " It is ready for final review."}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON.";
      if (jobId && originalRetained)
        await completeArtifactImport({
          jobId,
          typeKey: "agent",
          status: "quarantined",
          fidelityReport: [
            {
              scope: "Signature, schema, and permissions",
              level: "unsupported",
              message,
            },
          ],
          unsupportedFeatures: ["Unverified or inaccessible manifest content"],
          quarantineReason: message,
        }).catch(() => undefined);
      setImportMessage(
        `Manifest quarantined: ${message} The live draft was not changed.`,
      );
    } finally {
      setManifestBusy(null);
    }
  }

  const currentStep = STEPS[step]!;
  const latestRelease = releases[0];

  return (
    <div className="spectra-agent-studio" data-step={step + 1}>
      <header className="agent-studio-topline">
        <div>
          <span
            className="agent-status"
            data-published={Boolean(latestRelease)}
          >
            <span />{" "}
            {latestRelease ? `Release ${latestRelease.releaseNumber}` : "Draft"}
          </span>
          <p>
            Published releases are immutable; edits remain in this live draft
            until the next release.
          </p>
        </div>
        <div>
          <button type="button" onClick={() => setPreview(true)}>
            <Eye /> Preview agent
          </button>
          <button
            type="button"
            onClick={() => void exportManifest()}
            disabled={Boolean(manifestBusy)}
          >
            {manifestBusy === "export" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Download />
            )}{" "}
            Export
          </button>
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            disabled={readOnly || Boolean(manifestBusy)}
          >
            {manifestBusy === "import" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Upload />
            )}{" "}
            Import
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json,.spectra-agent.json"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void importManifest(file);
              event.currentTarget.value = "";
            }}
          />
        </div>
      </header>
      {importMessage ? (
        <div className="agent-notice" role="status">
          {importMessage}
          <button type="button" onClick={() => setImportMessage(undefined)}>
            <X />
          </button>
        </div>
      ) : null}
      <div className="agent-studio-layout">
        <nav aria-label="Agent creation steps">
          {STEPS.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.title}
                className={index === step ? "is-active" : ""}
                onClick={() => setStep(index)}
              >
                <span className="agent-step-number">
                  {index < step ? <Check /> : index + 1}
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <Icon />
              </button>
            );
          })}
        </nav>
        <main
          data-ai-region={
            aiChangedPaths.some((path) =>
              path.startsWith(
                [
                  "/profile",
                  "/routing",
                  "/resources",
                  "/skills",
                  "/behavior",
                  "/evals",
                ][step]!,
              ),
            ) || undefined
          }
        >
          <header>
            <span>{step + 1}</span>
            <div>
              <h2>{currentStep.title}</h2>
              <p>{currentStep.detail}</p>
            </div>
          </header>

          {step === 0 ? (
            <div className="agent-step-content">
              <div className="agent-two-column">
                <label className="agent-field">
                  <span>What is the primary purpose of this agent?</span>
                  <textarea
                    value={agent.profile.purpose}
                    readOnly={readOnly}
                    maxLength={4000}
                    onChange={(event) =>
                      updateProfile({ purpose: event.target.value })
                    }
                    placeholder="Explain the specialist goal and what this agent should help people achieve."
                  />
                  <small>{agent.profile.purpose.length}/4000</small>
                </label>
                <ChipsEditor
                  label="What outcomes should this agent help users achieve?"
                  values={agent.profile.outcomes}
                  onChange={(outcomes) => updateProfile({ outcomes })}
                  placeholder="Add outcome"
                />
              </div>
              <div className="agent-two-column">
                <ChipsEditor
                  label="What is in scope?"
                  values={agent.profile.inScope}
                  onChange={(inScope) => updateProfile({ inScope })}
                  placeholder="Topic or task"
                  tone="violet"
                />
                <ChipsEditor
                  label="What is out of scope?"
                  values={agent.profile.outOfScope}
                  onChange={(outOfScope) => updateProfile({ outOfScope })}
                  placeholder="Excluded topic"
                  tone="orange"
                />
              </div>
              <div className="agent-field">
                <span>When should the agent ask for clarification?</span>
                <div className="agent-choice-grid">
                  {[
                    [
                      "ask_when_needed",
                      "Ask when needed",
                      "Ask focused questions only when the request is ambiguous.",
                    ],
                    [
                      "confirm",
                      "Proceed and confirm",
                      "Make an educated assumption, then confirm understanding.",
                    ],
                    [
                      "never_ask",
                      "Do not ask",
                      "Answer directly unless safety or permissions block progress.",
                    ],
                  ].map(([value, label, detail]) => (
                    <button
                      type="button"
                      key={value}
                      className={
                        agent.behavior.clarification === value
                          ? "is-selected"
                          : ""
                      }
                      onClick={() =>
                        commit({
                          ...agent,
                          behavior: {
                            ...agent.behavior,
                            clarification:
                              value as AgentContent["behavior"]["clarification"],
                          },
                        })
                      }
                    >
                      <span>
                        {agent.behavior.clarification === value ? (
                          <CheckCircle2 />
                        ) : null}
                      </span>
                      <strong>{label}</strong>
                      <small>{detail}</small>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="agent-step-content">
              <label className="agent-field">
                <span>Who is this agent designed to help?</span>
                <textarea
                  value={agent.profile.audienceIntent}
                  readOnly={readOnly}
                  onChange={(event) =>
                    updateProfile({ audienceIntent: event.target.value })
                  }
                  placeholder="Describe needs and context, not a product-role restriction."
                />
                <small>
                  Students, teachers, and admins retain the same ordinary
                  ability to create and use agents.
                </small>
              </label>
              <div className="agent-routing-card">
                <label>
                  <input
                    type="checkbox"
                    checked={agent.routing.enabled}
                    disabled={readOnly || !canPublish}
                    onChange={(event) =>
                      commit({
                        ...agent,
                        routing: {
                          ...agent.routing,
                          enabled: event.target.checked,
                        },
                      })
                    }
                  />
                  <span>
                    <strong>Allow automatic routing</strong>
                    <small>
                      Spectra selects this release only at medium-to-high
                      confidence, visibly and reversibly.
                    </small>
                  </span>
                </label>
                <label className="agent-field">
                  <span>
                    When is this agent substantially better than ordinary
                    Spectra?
                  </span>
                  <textarea
                    value={agent.routing.description}
                    readOnly={readOnly}
                    onChange={(event) =>
                      commit({
                        ...agent,
                        routing: {
                          ...agent.routing,
                          description: event.target.value,
                        },
                      })
                    }
                    placeholder="Use concrete domains, tasks, constraints, and signals."
                  />
                </label>
              </div>
              <div className="agent-two-column">
                <ChipsEditor
                  label="Requests that should route here"
                  values={agent.routing.examples}
                  onChange={(examples) =>
                    commit({
                      ...agent,
                      routing: { ...agent.routing, examples },
                    })
                  }
                  placeholder="Example request"
                />
                <ChipsEditor
                  label="Requests that should not route here"
                  values={agent.routing.negativeExamples}
                  onChange={(negativeExamples) =>
                    commit({
                      ...agent,
                      routing: { ...agent.routing, negativeExamples },
                    })
                  }
                  placeholder="Counter-example"
                  tone="orange"
                />
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="agent-step-content">
              <div className="agent-resource-picker">
                <select
                  value=""
                  disabled={readOnly}
                  onChange={(event) => {
                    const artifact = artifacts.find(
                      (item) => item._id === event.target.value,
                    );
                    if (
                      !artifact ||
                      agent.resources.some(
                        (item) => item.artifactId === artifact._id,
                      )
                    )
                      return;
                    commit({
                      ...agent,
                      resources: [
                        ...agent.resources,
                        {
                          id: identifier("resource"),
                          artifactId: artifact._id,
                          label: artifact.title,
                          mode: "read",
                          versionPolicy: "reviewed",
                          pinnedVersionId: artifact.currentVersionId,
                        },
                      ],
                    });
                  }}
                >
                  <option value="">Bind a permissioned artifact…</option>
                  {artifacts
                    .filter(
                      (artifact) =>
                        artifact._id !== artifactId &&
                        artifact.blueprintKey !== "agent",
                    )
                    .map((artifact) => (
                      <option key={artifact._id} value={artifact._id}>
                        {artifact.title} · {artifact.blueprintKey}
                      </option>
                    ))}
                </select>
                <p>
                  Bindings never copy inaccessible content. Invocation re-checks
                  the user and source permissions.
                </p>
              </div>
              <div className="agent-resource-list">
                {linkedResources.map(({ resource, artifact, health }) => (
                  <article key={resource.id}>
                    <BookOpen />
                    <div>
                      <strong>{artifact?.title ?? resource.label}</strong>
                      <small>
                        {health?.health === "available"
                          ? `${artifact?.blueprintKey ?? health.blueprintKey ?? "artifact"} · access verified`
                          : health?.health === "permission_revoked"
                            ? "Permission revoked · unavailable to invocations"
                            : health?.health === "version_unavailable"
                              ? "Reviewed version unavailable"
                              : artifact
                                ? `${artifact.blueprintKey} · checking access`
                                : "Resource missing"}
                      </small>
                    </div>
                    <select
                      value={resource.versionPolicy}
                      disabled={readOnly}
                      onChange={(event) =>
                        commit({
                          ...agent,
                          resources: agent.resources.map((item) =>
                            item.id === resource.id
                              ? {
                                  ...item,
                                  versionPolicy: event.target.value as
                                    "reviewed" | "latest",
                                  pinnedVersionId:
                                    event.target.value === "reviewed"
                                      ? artifact?.currentVersionId
                                      : undefined,
                                }
                              : item,
                          ),
                        })
                      }
                    >
                      <option value="reviewed">Reviewed version</option>
                      <option value="latest">Track latest</option>
                    </select>
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() =>
                        commit({
                          ...agent,
                          resources: agent.resources.filter(
                            (item) => item.id !== resource.id,
                          ),
                        })
                      }
                      aria-label={`Remove ${resource.label}`}
                    >
                      <Trash2 />
                    </button>
                  </article>
                ))}
                {!agent.resources.length ? (
                  <div className="agent-empty-state">
                    <BookOpen />
                    <span>
                      No resources bound. The agent will rely on its
                      instructions and allowed tools.
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="agent-step-content">
              <section className="agent-capability-section">
                <header>
                  <div>
                    <h3>Skills</h3>
                    <p>
                      On-demand specialist instructions loaded only when this
                      agent is selected.
                    </p>
                  </div>
                </header>
                <div className="agent-add-row">
                  <input
                    value={skillDraft}
                    onChange={(event) => setSkillDraft(event.target.value)}
                    placeholder="Add a skill, e.g. Explain cellular biology"
                  />
                  <button type="button" onClick={addSkill}>
                    <Plus /> Add skill
                  </button>
                </div>
                <div className="agent-skill-list">
                  {agent.skills.map((skill) => (
                    <article key={skill.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={skill.enabled}
                          disabled={readOnly}
                          onChange={() =>
                            commit({
                              ...agent,
                              skills: agent.skills.map((item) =>
                                item.id === skill.id
                                  ? { ...item, enabled: !item.enabled }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                      <input
                        value={skill.name}
                        readOnly={readOnly}
                        onChange={(event) =>
                          commit({
                            ...agent,
                            skills: agent.skills.map((item) =>
                              item.id === skill.id
                                ? { ...item, name: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                      <textarea
                        value={skill.instructions}
                        readOnly={readOnly}
                        onChange={(event) =>
                          commit({
                            ...agent,
                            skills: agent.skills.map((item) =>
                              item.id === skill.id
                                ? { ...item, instructions: event.target.value }
                                : item,
                            ),
                          })
                        }
                        placeholder="When and how should this skill operate?"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          commit({
                            ...agent,
                            skills: agent.skills.filter(
                              (item) => item.id !== skill.id,
                            ),
                          })
                        }
                      >
                        <Trash2 />
                      </button>
                    </article>
                  ))}
                </div>
              </section>
              <section className="agent-capability-section">
                <header>
                  <div>
                    <h3>Allowed tools</h3>
                    <p>
                      Secrets remain server-side. Tool approval is enforced
                      during every invocation.
                    </p>
                  </div>
                </header>
                <div className="agent-tool-grid">
                  {TOOL_CATALOG.map((catalog) => {
                    const tool = agent.tools.find(
                      (item) => item.key === catalog.key,
                    );
                    return (
                      <article
                        key={catalog.key}
                        className={tool?.enabled ? "is-enabled" : ""}
                      >
                        <button
                          type="button"
                          onClick={() => toggleTool(catalog.key)}
                          disabled={readOnly}
                          aria-pressed={tool?.enabled === true}
                        >
                          <span>{tool?.enabled ? <Check /> : null}</span>
                          <div>
                            <strong>{catalog.label}</strong>
                            <small>{catalog.detail}</small>
                          </div>
                        </button>
                        {tool?.enabled &&
                        (tool.key === "artifact_create" ||
                          tool.key === "artifact_edit") ? (
                          <select
                            value={tool.approval}
                            disabled={readOnly}
                            onChange={(event) =>
                              commit({
                                ...agent,
                                tools: agent.tools.map((item) =>
                                  item.id === tool.id
                                    ? {
                                        ...item,
                                        approval: event.target
                                          .value as AgentTool["approval"],
                                      }
                                    : item,
                                ),
                              })
                            }
                          >
                            <option value="never">No extra approval</option>
                            <option value="consequential">
                              Approve consequential use
                            </option>
                            <option value="always">Always approve</option>
                          </select>
                        ) : tool?.enabled ? (
                          <small className="agent-tool-runtime-note">
                            Permission checked for every invocation
                          </small>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
                <details className="agent-runtime-budget">
                  <summary>Reliability guardrails</summary>
                  <p>
                    Safety ceilings prevent a malformed agent from running
                    indefinitely. They are not commercial usage limits.
                  </p>
                  <div>
                    <label>
                      <span>Model turns</span>
                      <input
                        type="number"
                        min={4}
                        max={40}
                        value={agent.runtimeBudget.maxTurns}
                        disabled={readOnly}
                        onChange={(event) =>
                          commit({
                            ...agent,
                            runtimeBudget: {
                              ...agent.runtimeBudget,
                              maxTurns: Math.max(
                                4,
                                Math.min(40, Number(event.target.value) || 4),
                              ),
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Tool calls</span>
                      <input
                        type="number"
                        min={4}
                        max={100}
                        value={agent.runtimeBudget.maxToolCalls}
                        disabled={readOnly}
                        onChange={(event) =>
                          commit({
                            ...agent,
                            runtimeBudget: {
                              ...agent.runtimeBudget,
                              maxToolCalls: Math.max(
                                4,
                                Math.min(100, Number(event.target.value) || 4),
                              ),
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Minutes</span>
                      <input
                        type="number"
                        min={0.5}
                        max={10}
                        step={0.5}
                        value={agent.runtimeBudget.maxElapsedMs / 60_000}
                        disabled={readOnly}
                        onChange={(event) =>
                          commit({
                            ...agent,
                            runtimeBudget: {
                              ...agent.runtimeBudget,
                              maxElapsedMs:
                                Math.max(
                                  0.5,
                                  Math.min(
                                    10,
                                    Number(event.target.value) || 0.5,
                                  ),
                                ) * 60_000,
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Total tokens</span>
                      <input
                        type="number"
                        min={20_000}
                        max={500_000}
                        step={10_000}
                        value={agent.runtimeBudget.maxTotalTokens}
                        disabled={readOnly}
                        onChange={(event) =>
                          commit({
                            ...agent,
                            runtimeBudget: {
                              ...agent.runtimeBudget,
                              maxTotalTokens: Math.max(
                                20_000,
                                Math.min(
                                  500_000,
                                  Number(event.target.value) || 20_000,
                                ),
                              ),
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                </details>
              </section>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="agent-step-content">
              <div className="agent-two-column">
                <label className="agent-field">
                  <span>Tone</span>
                  <select
                    value={agent.behavior.tone}
                    disabled={readOnly}
                    onChange={(event) =>
                      commit({
                        ...agent,
                        behavior: {
                          ...agent.behavior,
                          tone: event.target
                            .value as AgentContent["behavior"]["tone"],
                        },
                      })
                    }
                  >
                    <option value="warm">Warm and encouraging</option>
                    <option value="direct">Direct and practical</option>
                    <option value="socratic">Socratic</option>
                    <option value="formal">Formal</option>
                    <option value="playful">Playful</option>
                  </select>
                </label>
                <label className="agent-field">
                  <span>Response depth</span>
                  <select
                    value={agent.behavior.responseLength}
                    disabled={readOnly}
                    onChange={(event) =>
                      commit({
                        ...agent,
                        behavior: {
                          ...agent.behavior,
                          responseLength: event.target
                            .value as AgentContent["behavior"]["responseLength"],
                        },
                      })
                    }
                  >
                    <option value="concise">Concise</option>
                    <option value="balanced">Balanced</option>
                    <option value="detailed">Detailed</option>
                  </select>
                </label>
              </div>
              <label className="agent-field">
                <span>Complete agent instructions</span>
                <textarea
                  className="agent-instructions"
                  value={agent.instructions.text}
                  readOnly={readOnly}
                  onChange={(event) =>
                    commit({
                      ...agent,
                      instructions: {
                        ...agent.instructions,
                        text: event.target.value,
                      },
                    })
                  }
                  placeholder="Define behavior, methods, preservation rules, source handling, quality checks, and boundaries."
                />
                <small>
                  {agent.instructions.text.length.toLocaleString()} / 120,000
                </small>
              </label>
              <ChipsEditor
                label="Hard boundaries"
                values={agent.behavior.boundaries}
                onChange={(boundaries) =>
                  commit({
                    ...agent,
                    behavior: { ...agent.behavior, boundaries },
                  })
                }
                placeholder="Add boundary"
                tone="orange"
              />
              <div className="agent-two-column">
                <label className="agent-field">
                  <span>Model policy</span>
                  <select
                    value={agent.modelPolicy.mode}
                    disabled={readOnly}
                    onChange={(event) =>
                      commit({
                        ...agent,
                        modelPolicy: {
                          ...agent.modelPolicy,
                          mode: event.target
                            .value as AgentContent["modelPolicy"]["mode"],
                        },
                      })
                    }
                  >
                    <option value="spectra_default">Spectra default</option>
                    <option value="reasoning">Prioritise reasoning</option>
                    <option value="fast">Prioritise speed</option>
                  </select>
                </label>
                <label className="agent-check-field">
                  <input
                    type="checkbox"
                    checked={agent.modelPolicy.allowFallback}
                    disabled={readOnly}
                    onChange={(event) =>
                      commit({
                        ...agent,
                        modelPolicy: {
                          ...agent.modelPolicy,
                          allowFallback: event.target.checked,
                        },
                      })
                    }
                  />
                  <span>
                    <strong>Allow model fallback</strong>
                    <small>
                      Use an approved alternative if the preferred model is
                      unavailable.
                    </small>
                  </span>
                </label>
              </div>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="agent-step-content">
              <section className="agent-review-summary">
                <div>
                  <Bot />
                  <span>
                    <strong>{artifactTitle}</strong>
                    <small>
                      {agent.profile.purpose || "Purpose not defined"}
                    </small>
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Skills</dt>
                    <dd>
                      {agent.skills.filter((item) => item.enabled).length}
                    </dd>
                  </div>
                  <div>
                    <dt>Tools</dt>
                    <dd>{agent.tools.filter((item) => item.enabled).length}</dd>
                  </div>
                  <div>
                    <dt>Resources</dt>
                    <dd>{agent.resources.length}</dd>
                  </div>
                  <div>
                    <dt>Routing examples</dt>
                    <dd>{agent.routing.examples.length}</dd>
                  </div>
                </dl>
              </section>
              <section className="agent-eval-section">
                <header>
                  <div>
                    <h3>Evaluation suite</h3>
                    <p>
                      Cases become release gates and never expose real private
                      invocations.
                    </p>
                  </div>
                  <div className="agent-eval-actions">
                    <button
                      type="button"
                      disabled={
                        generatingSuite ||
                        evaluating ||
                        readOnly ||
                        Boolean(issues.length)
                      }
                      onClick={() => void generateEvaluationSuite()}
                    >
                      {generatingSuite ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Sparkles />
                      )}
                      {agent.evals.length
                        ? "Regenerate suite"
                        : "Generate suite"}
                    </button>
                    <button
                      type="button"
                      className="agent-run-evals"
                      disabled={
                        evaluating ||
                        generatingSuite ||
                        readOnly ||
                        Boolean(issues.length) ||
                        !agent.evals.length
                      }
                      onClick={() => void runEvaluation()}
                    >
                      {evaluating ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <TestTube2 />
                      )}
                      {evaluating ? "Running suite…" : "Run test suite"}
                    </button>
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() =>
                        commit({
                          ...agent,
                          evals: [
                            ...agent.evals,
                            {
                              id: identifier("eval"),
                              prompt: "",
                              expected: "",
                              category: "quality",
                              required: true,
                            },
                          ],
                        })
                      }
                    >
                      <Plus /> Add case
                    </button>
                  </div>
                </header>
                {agent.evals.map((evaluation, index) => (
                  <article key={evaluation.id}>
                    <span>{index + 1}</span>
                    <input
                      value={evaluation.prompt}
                      readOnly={readOnly}
                      onChange={(event) =>
                        commit({
                          ...agent,
                          evals: agent.evals.map((item) =>
                            item.id === evaluation.id
                              ? { ...item, prompt: event.target.value }
                              : item,
                          ),
                        })
                      }
                      placeholder="Synthetic test prompt"
                    />
                    <input
                      value={evaluation.expected}
                      readOnly={readOnly}
                      onChange={(event) =>
                        commit({
                          ...agent,
                          evals: agent.evals.map((item) =>
                            item.id === evaluation.id
                              ? { ...item, expected: event.target.value }
                              : item,
                          ),
                        })
                      }
                      placeholder="Observable success criteria"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        commit({
                          ...agent,
                          evals: agent.evals.filter(
                            (item) => item.id !== evaluation.id,
                          ),
                        })
                      }
                    >
                      <Trash2 />
                    </button>
                  </article>
                ))}
                {evalRuns.length ? (
                  <div className="agent-eval-runs">
                    {evalRuns.slice(0, 5).map((run) => (
                      <details key={run._id}>
                        <summary>
                          <span data-status={run.status}>
                            {run.status === "passed" ? (
                              <CheckCircle2 />
                            ) : run.status === "running" ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <AlertCircle />
                            )}
                            {run.status === "running"
                              ? "Evaluation running"
                              : `${run.passedCount}/${run.caseCount} passed`}
                          </span>
                          <small>
                            {Math.round(run.averageScore * 100)}% ·{" "}
                            {new Date(run.startedAt).toLocaleString()}
                          </small>
                        </summary>
                        <div>
                          {run.results.map((result) => (
                            <article key={result.caseId}>
                              <span data-passed={result.passed}>
                                {result.passed ? <Check /> : <X />}
                              </span>
                              <div>
                                <strong>
                                  {result.category} ·{" "}
                                  {Math.round(result.score * 100)}%
                                </strong>
                                <p>{result.reason}</p>
                                {result.responseExcerpt ? (
                                  <details>
                                    <summary>Response evidence</summary>
                                    <blockquote>
                                      {result.responseExcerpt}
                                    </blockquote>
                                  </details>
                                ) : null}
                              </div>
                            </article>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                ) : null}
              </section>
              <section className="agent-publish-panel">
                <div className="agent-issues" data-ready={!issues.length}>
                  {issues.length ? <AlertCircle /> : <CheckCircle2 />}
                  <div>
                    <strong>
                      {issues.length
                        ? `${issues.length} release gate${issues.length === 1 ? "" : "s"} remain`
                        : "Configuration gates passed"}
                    </strong>
                    {issues.length ? (
                      <ul>
                        {issues.map((issue) => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>
                        The server will re-check tools, resources, permissions,
                        and the immutable snapshot.
                      </p>
                    )}
                  </div>
                </div>
                <label className="agent-field">
                  <span>Rollout</span>
                  <select
                    value={rollout}
                    disabled={readOnly}
                    onChange={(event) =>
                      setRollout(
                        event.target.value as
                          "internal_test" | "limited" | "published",
                      )
                    }
                  >
                    <option value="internal_test">
                      Internal test · creator only
                    </option>
                    <option value="limited">
                      Limited rollout · selected audience
                    </option>
                    <option value="published">
                      Published · eligible for routing
                    </option>
                  </select>
                  <small>
                    {!canPublish
                      ? "Your access can edit this draft but does not include release management."
                      : publishNeedsEval
                        ? hasPassingCurrentEval
                          ? "The passing suite matches this exact saved draft."
                          : "Run and pass the suite for this exact draft before rollout."
                        : "Internal test releases cannot be routed automatically."}
                  </small>
                </label>
                <label className="agent-field">
                  <span>Release notes</span>
                  <textarea
                    value={agent.releaseNotes}
                    readOnly={readOnly}
                    onChange={(event) =>
                      commit({ ...agent, releaseNotes: event.target.value })
                    }
                    placeholder="What changed, and what should users know?"
                  />
                </label>
                <button
                  type="button"
                  className="agent-publish-button"
                  disabled={
                    Boolean(issues.length) ||
                    publishing ||
                    !canPublish ||
                    (publishNeedsEval && !hasPassingCurrentEval)
                  }
                  onClick={() => void publish()}
                >
                  {publishing ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Rocket />
                  )}{" "}
                  {rollout === "published"
                    ? "Publish immutable release"
                    : rollout === "limited"
                      ? "Start limited rollout"
                      : "Create internal test release"}
                </button>
                {releaseMessage ? (
                  <p className="agent-release-message" role="status">
                    {releaseMessage}
                  </p>
                ) : null}
                {releases.length ? (
                  <div className="agent-release-list">
                    {releases.slice(0, 8).map((release) => (
                      <article key={release.releaseId}>
                        <span>v{release.releaseNumber}</span>
                        <div>
                          <strong>
                            {(release.rollout ?? "published")
                              .replace("_", " ")
                              .replace(/^\w/, (value) =>
                                value.toUpperCase(),
                              )}{" "}
                            · {release.status}{" "}
                            {new Date(release.publishedAt).toLocaleDateString()}
                          </strong>
                          <small>
                            {release.releaseNotes || "No release notes"}
                          </small>
                        </div>
                        <div className="agent-release-actions">
                          {release.rollout !== "published" &&
                          release.status === "published" ? (
                            <button
                              type="button"
                              disabled={Boolean(releaseBusy) || !canPublish}
                              onClick={() =>
                                void manageRelease(release, "promote")
                              }
                            >
                              Promote
                            </button>
                          ) : null}
                          {release.status === "published" ? (
                            <button
                              type="button"
                              disabled={Boolean(releaseBusy) || !canPublish}
                              onClick={() =>
                                void manageRelease(release, "rollback")
                              }
                            >
                              Use for new runs
                            </button>
                          ) : null}
                          {release.status === "published" ? (
                            <button
                              type="button"
                              disabled={Boolean(releaseBusy) || !canPublish}
                              onClick={() =>
                                void manageRelease(release, "suspend")
                              }
                            >
                              Suspend
                            </button>
                          ) : null}
                          {release.status !== "deprecated" ? (
                            <button
                              type="button"
                              disabled={Boolean(releaseBusy) || !canPublish}
                              onClick={() =>
                                void manageRelease(release, "deprecate")
                              }
                            >
                              Deprecate
                            </button>
                          ) : (
                            <CheckCircle2 />
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
                {analytics ? (
                  <details className="agent-analytics">
                    <summary>Usage & quality</summary>
                    <div>
                      <dl>
                        <div>
                          <dt>Invocations</dt>
                          <dd>{analytics.invocations.toLocaleString()}</dd>
                        </div>
                        <div>
                          <dt>Completion</dt>
                          <dd>
                            {analytics.completionRate === null
                              ? "—"
                              : `${Math.round(analytics.completionRate * 100)}%`}
                          </dd>
                        </div>
                        <div>
                          <dt>Rating</dt>
                          <dd>
                            {analytics.feedback.averageRating === null
                              ? "—"
                              : analytics.feedback.averageRating.toFixed(1)}
                          </dd>
                        </div>
                        <div>
                          <dt>Latency</dt>
                          <dd>
                            {analytics.averageLatencyMs === null
                              ? "—"
                              : `${(analytics.averageLatencyMs / 1_000).toFixed(1)}s`}
                          </dd>
                        </div>
                      </dl>
                      <p>{analytics.privacy}</p>
                      <div className="agent-improvements">
                        <header>
                          <div>
                            <strong>Improvement proposals</strong>
                            <small>
                              Evidence-backed draft changes; never silent
                              learning
                            </small>
                          </div>
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => setProposalOpen((value) => !value)}
                          >
                            <Plus /> Propose
                          </button>
                        </header>
                        {proposalOpen ? (
                          <div className="agent-improvement-form">
                            <textarea
                              value={proposalEvidence}
                              onChange={(event) =>
                                setProposalEvidence(event.target.value)
                              }
                              placeholder="Aggregate evidence or a consented feedback pattern — never paste a private prompt"
                            />
                            <textarea
                              value={proposalImpact}
                              onChange={(event) =>
                                setProposalImpact(event.target.value)
                              }
                              placeholder="Expected measurable improvement"
                            />
                            <textarea
                              value={proposalInstructions}
                              onChange={(event) =>
                                setProposalInstructions(event.target.value)
                              }
                              placeholder="Complete replacement agent instructions to test in the draft"
                            />
                            <button
                              type="button"
                              disabled={proposalBusy}
                              onClick={() => void createImprovementProposal()}
                            >
                              {proposalBusy ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                <TestTube2 />
                              )}
                              Save proposal
                            </button>
                          </div>
                        ) : null}
                        {analytics.proposals.map((proposal) => (
                          <article key={proposal._id}>
                            <div>
                              <strong>{proposal.expectedImpact}</strong>
                              <p>{proposal.evidence}</p>
                              <small>
                                Accepting changes the draft only and invalidates
                                prior release evidence.
                              </small>
                            </div>
                            <div>
                              <button
                                type="button"
                                disabled={proposalBusy || readOnly}
                                onClick={() =>
                                  void decideImprovement(
                                    proposal._id,
                                    "rejected",
                                  )
                                }
                              >
                                Reject
                              </button>
                              <button
                                type="button"
                                disabled={proposalBusy || readOnly}
                                onClick={() =>
                                  void decideImprovement(
                                    proposal._id,
                                    "accepted",
                                  )
                                }
                              >
                                Try in draft
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  </details>
                ) : null}
              </section>
            </div>
          ) : null}

          <footer>
            <button
              type="button"
              onClick={() => setStep((value) => Math.max(0, value - 1))}
              disabled={step === 0}
            >
              Back
            </button>
            <button
              type="button"
              className="agent-continue"
              onClick={() =>
                setStep((value) => Math.min(STEPS.length - 1, value + 1))
              }
              disabled={step === STEPS.length - 1}
            >
              Save & continue <ChevronRight />
            </button>
          </footer>
        </main>
      </div>

      {preview ? (
        <div
          className="agent-preview-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${artifactTitle}`}
        >
          <button
            type="button"
            className="agent-preview-backdrop"
            onClick={() => setPreview(false)}
            aria-label="Close preview"
          />
          <article>
            <header>
              <span>
                <Bot />
              </span>
              <div>
                <small>AGENT PREVIEW</small>
                <h2>{artifactTitle}</h2>
                <p>{agent.profile.purpose || "No purpose yet."}</p>
              </div>
              <button type="button" onClick={() => setPreview(false)}>
                <X />
              </button>
            </header>
            <section>
              <h3>What this agent will load</h3>
              <div className="agent-preview-metrics">
                <span>
                  {agent.skills.filter((item) => item.enabled).length}
                  <small>skills</small>
                </span>
                <span>
                  {agent.tools.filter((item) => item.enabled).length}
                  <small>tools</small>
                </span>
                <span>
                  {agent.resources.length}
                  <small>resources</small>
                </span>
              </div>
              <p>
                Only this release's enabled instructions, tools, bindings, and
                specialized context load after selection. Private prompts,
                memory, and invocation threads remain outside the artifact.
              </p>
            </section>
            <section>
              <h3>Routing</h3>
              <p>
                {agent.routing.enabled
                  ? agent.routing.description ||
                    "Routing description is incomplete."
                  : "Automatic routing is disabled."}
              </p>
            </section>
            <section>
              <h3>Behavior sample</h3>
              <blockquote>
                {agent.instructions.text.slice(0, 700) ||
                  "Add agent instructions to preview its behavior contract."}
              </blockquote>
            </section>
          </article>
        </div>
      ) : null}
    </div>
  );
}
