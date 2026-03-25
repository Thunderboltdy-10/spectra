"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, Plus, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { defaultAvatarIconForCategory } from "@/components/agents/agent-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSidebar } from "@/context/sidebar-context";

type AccessLevel = "private" | "class" | "school";
type Visibility = "public" | "private" | "shared";
type ResourceStatus = "uploaded" | "processing" | "processed" | "failed";
type CapabilityId = "search" | "flashcards" | "quiz" | "document" | "diagram";

const WIZARD_STEPS = [
  "Identity",
  "Resources",
  "Behavior",
  "Capabilities",
  "Access",
  "Preview",
] as const;

const CAPABILITIES: Array<{ id: CapabilityId; label: string; description: string; studentSafe?: boolean }> = [
  { id: "search", label: "Web Search", description: "Find and verify current information." },
  { id: "flashcards", label: "Flashcards", description: "Generate spaced-repetition cards.", studentSafe: true },
  { id: "quiz", label: "Quiz Builder", description: "Create formative quizzes.", studentSafe: true },
  { id: "document", label: "Document Generation", description: "Produce structured docs and study sheets." },
  { id: "diagram", label: "Diagram Creation", description: "Generate visual diagrams and concept maps." },
];

const SUBJECT_EMOJI: Array<{ pattern: RegExp; emoji: string }> = [
  { pattern: /\b(math|algebra|geometry|calculus|statistics)\b/i, emoji: "🧮" },
  { pattern: /\b(physics|chemistry|biology|science)\b/i, emoji: "🔬" },
  { pattern: /\b(history|politics|geography)\b/i, emoji: "🏛️" },
  { pattern: /\b(english|literature|essay|writing)\b/i, emoji: "📝" },
  { pattern: /\b(code|coding|computer|programming)\b/i, emoji: "💻" },
  { pattern: /\b(language|spanish|french|german)\b/i, emoji: "🌍" },
];

type WizardResource = {
  _id: string;
  filename: string;
  status: ResourceStatus;
  error?: string;
  updatedAt?: number;
  processingAttempts?: number;
};

type AgentExtractionResponse = {
  topicMap?: string[];
  rubricHints?: string[];
  misconceptions?: string[];
  vocabulary?: string[];
  examStructure?: string[];
  guidelinesSummary?: string;
  systemPromptDraft?: string;
  resourceCoverage?: {
    total: number;
    processed: number;
    pending: number;
  };
};

type PreviewResponse = {
  reply?: string;
  model?: string;
};

export type AgentBuilderValues = {
  name: string;
  description: string;
  category: string;
  subjectArea?: string;
  gradeLevel?: string;
  systemPrompt: string;
  avatarEmoji?: string;
  avatarIcon?: string;
  visibility: Visibility;
  accessLevel?: AccessLevel;
  moderationStatus?: "approved" | "pending";
  preferredMode?: string;
  allowedTools?: string[];
  guidelinesSummary?: string;
  guidelinesTopicMap?: string[];
  guidelinesRubricHints?: string[];
  guidelinesMisconceptions?: string[];
  guidelinesVocabulary?: string[];
  guidelinesExamStructure?: string[];
  resourceIds?: string[];
};

type AgentBuilderFormProps = {
  onSubmit: (values: AgentBuilderValues) => Promise<void>;
  onCancelHref?: string;
};

function pickSubjectEmoji(subjectArea: string) {
  for (const item of SUBJECT_EMOJI) {
    if (item.pattern.test(subjectArea)) return item.emoji;
  }
  return "🎓";
}

function dedupeStrings(values: string[], max = 20) {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ).slice(0, max);
}

function textAreaListValue(values: string[]) {
  return values.join("\n");
}

function parseTextAreaList(value: string, max = 20) {
  return dedupeStrings(value.split("\n"), max);
}

function statusTone(status: ResourceStatus) {
  if (status === "processed") return "text-[var(--success)]";
  if (status === "failed") return "text-[var(--danger)]";
  if (status === "processing") return "text-[var(--accent-cyan)]";
  return "text-[var(--text-secondary)]";
}

export function AgentBuilderForm({ onSubmit, onCancelHref = "/agents" }: AgentBuilderFormProps) {
  const sidebar = useSidebar();
  const isStudent = sidebar.role === "student";
  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingResources, setUploadingResources] = useState(false);
  const [extractingBehavior, setExtractingBehavior] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [name, setName] = useState("");
  const [subjectArea, setSubjectArea] = useState("");
  const [gradeLevel, setGradeLevel] = useState(isStudent ? "Student level" : "Secondary");
  const [description, setDescription] = useState("");

  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [resources, setResources] = useState<WizardResource[]>([]);

  const [systemPrompt, setSystemPrompt] = useState("");
  const [guidelinesSummary, setGuidelinesSummary] = useState("");
  const [topicMap, setTopicMap] = useState<string[]>([]);
  const [rubricHints, setRubricHints] = useState<string[]>([]);
  const [misconceptions, setMisconceptions] = useState<string[]>([]);
  const [vocabulary, setVocabulary] = useState<string[]>([]);
  const [examStructure, setExamStructure] = useState<string[]>([]);

  const [capabilities, setCapabilities] = useState<CapabilityId[]>(
    isStudent ? ["flashcards", "quiz"] : ["search", "flashcards", "quiz"],
  );
  const [accessLevel, setAccessLevel] = useState<AccessLevel>(isStudent ? "private" : "class");
  const [previewMessage, setPreviewMessage] = useState("Can you explain this topic in a clear step-by-step way?");
  const [previewReply, setPreviewReply] = useState("");
  const [previewModel, setPreviewModel] = useState("");

  const visibleCapabilities = useMemo(
    () => (isStudent ? CAPABILITIES.filter((item) => item.studentSafe) : CAPABILITIES),
    [isStudent],
  );

  const refreshResourceStatuses = useCallback(async () => {
    if (resourceIds.length === 0) {
      setResources([]);
      return;
    }
    const response = await fetch("/api/resources?scope=personal");
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const payload = (await response.json()) as {
      resources?: Array<{
        _id: string;
        filename: string;
        status: ResourceStatus;
        error?: string;
        updatedAt?: number;
        processingAttempts?: number;
      }>;
    };
    const index = new Map((payload.resources ?? []).map((item) => [item._id, item] as const));
    setResources(
      resourceIds
        .map((resourceId) => {
          const found = index.get(resourceId);
          if (!found) return null;
          return {
            _id: found._id,
            filename: found.filename,
            status: found.status,
            error: found.error,
            updatedAt: found.updatedAt,
            processingAttempts: found.processingAttempts,
          };
        })
        .filter((row) => row !== null) as WizardResource[],
    );
  }, [resourceIds]);

  useEffect(() => {
    if (resourceIds.length === 0) return;
    const hasPending = resources.some((resource) => resource.status === "uploaded" || resource.status === "processing");
    if (!hasPending) return;
    const interval = window.setInterval(() => {
      void refreshResourceStatuses().catch(() => {});
    }, 3200);
    return () => window.clearInterval(interval);
  }, [refreshResourceStatuses, resourceIds.length, resources]);

  function updateResourceIds(ids: string[]) {
    setResourceIds((prev) => dedupeStrings([...prev, ...ids], 20));
  }

  async function handleUploadResources(files: File[]) {
    if (files.length === 0) return;
    setUploadingResources(true);
    try {
      const formData = new FormData();
      formData.set("scope", "personal");
      formData.set("saveToLibrary", "1");
      for (const file of files) {
        formData.append("files", file);
      }
      const response = await fetch("/api/resources", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = (await response.json()) as {
        results?: Array<{ resourceId?: string; status?: string; file?: string; error?: string }>;
      };

      const uploadedIds = (payload.results ?? [])
        .map((item) => item.resourceId)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0);
      updateResourceIds(uploadedIds);
      if (uploadedIds.length > 0) {
        toast.success(`Added ${uploadedIds.length} resource${uploadedIds.length === 1 ? "" : "s"} to wizard.`);
      }
      const failed = (payload.results ?? []).filter((item) => item.status === "failed");
      if (failed.length > 0) {
        toast.warning(`${failed.length} file${failed.length === 1 ? "" : "s"} failed validation.`);
      }
      await refreshResourceStatuses();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Resource upload failed");
    } finally {
      setUploadingResources(false);
    }
  }

  function removeResource(resourceId: string) {
    setResourceIds((prev) => prev.filter((id) => id !== resourceId));
    setResources((prev) => prev.filter((resource) => resource._id !== resourceId));
  }

  async function generateBehaviorFromResources() {
    if (!name.trim()) {
      toast.error("Fill identity details first.");
      return;
    }
    setExtractingBehavior(true);
    try {
      const response = await fetch("/api/agents/extract-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          subjectArea: subjectArea.trim(),
          gradeLevel: gradeLevel.trim(),
          description: description.trim(),
          capabilities,
          resourceIds,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = (await response.json()) as AgentExtractionResponse;
      if (payload.systemPromptDraft?.trim()) {
        setSystemPrompt(payload.systemPromptDraft.trim());
      }
      setGuidelinesSummary(payload.guidelinesSummary?.trim() ?? "");
      setTopicMap(dedupeStrings(payload.topicMap ?? [], 16));
      setRubricHints(dedupeStrings(payload.rubricHints ?? [], 12));
      setMisconceptions(dedupeStrings(payload.misconceptions ?? [], 12));
      setVocabulary(dedupeStrings(payload.vocabulary ?? [], 20));
      setExamStructure(dedupeStrings(payload.examStructure ?? [], 12));

      if (payload.resourceCoverage && payload.resourceCoverage.pending > 0) {
        toast.info(
          `Generated from ${payload.resourceCoverage.processed}/${payload.resourceCoverage.total} processed resources. Remaining files are still processing.`,
        );
      } else {
        toast.success("Behavior and metadata generated.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to generate behavior");
    } finally {
      setExtractingBehavior(false);
    }
  }

  async function runPreview() {
    if (!systemPrompt.trim()) {
      toast.error("Generate or write the behavior prompt first.");
      return;
    }
    if (!previewMessage.trim()) {
      toast.error("Enter a preview question.");
      return;
    }
    setPreviewLoading(true);
    try {
      const response = await fetch("/api/agents/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          message: previewMessage.trim(),
          systemPrompt: systemPrompt.trim(),
          guidelinesSummary: guidelinesSummary.trim(),
          topicMap,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = (await response.json()) as PreviewResponse;
      setPreviewReply(payload.reply?.trim() ?? "");
      setPreviewModel(payload.model ?? "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }

  function visibilityFromAccess(level: AccessLevel): Visibility {
    if (level === "private") return "private";
    if (level === "class") return "shared";
    return "public";
  }

  function validateStep(index: number) {
    if (index === 0) {
      if (name.trim().length < 3) {
        toast.error("Agent name must be at least 3 characters.");
        return false;
      }
      if (subjectArea.trim().length < 2) {
        toast.error("Subject area is required.");
        return false;
      }
      if (description.trim().length < 12) {
        toast.error("Add a clearer description.");
        return false;
      }
    }
    if (index === 2 && systemPrompt.trim().length < 120) {
      toast.error("Behavior prompt is too short. Generate it or write a fuller prompt.");
      return false;
    }
    if (index === 3 && capabilities.length === 0) {
      toast.error("Select at least one capability.");
      return false;
    }
    return true;
  }

  function toggleCapability(id: CapabilityId) {
    setCapabilities((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      return [...prev, id];
    });
  }

  function nextStep() {
    if (!validateStep(stepIndex)) return;
    setStepIndex((prev) => Math.min(WIZARD_STEPS.length - 1, prev + 1));
  }

  function prevStep() {
    setStepIndex((prev) => Math.max(0, prev - 1));
  }

  async function publishAgent() {
    if (!validateStep(0) || !validateStep(2) || !validateStep(3)) return;
    setSubmitting(true);
    try {
      const cleanSubject = subjectArea.trim();
      const category = cleanSubject || "General";
      const visibility = visibilityFromAccess(accessLevel);
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        category,
        subjectArea: cleanSubject || undefined,
        gradeLevel: gradeLevel.trim() || undefined,
        systemPrompt: systemPrompt.trim(),
        avatarEmoji: pickSubjectEmoji(cleanSubject || category),
        avatarIcon: defaultAvatarIconForCategory(category),
        visibility,
        accessLevel,
        moderationStatus: isStudent && accessLevel === "school" ? "pending" : undefined,
        preferredMode: "tutor",
        allowedTools: capabilities,
        guidelinesSummary: guidelinesSummary.trim() || undefined,
        guidelinesTopicMap: topicMap,
        guidelinesRubricHints: rubricHints,
        guidelinesMisconceptions: misconceptions,
        guidelinesVocabulary: vocabulary,
        guidelinesExamStructure: examStructure,
        resourceIds,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create agent");
    } finally {
      setSubmitting(false);
    }
  }

  const processedCount = resources.filter((resource) => resource.status === "processed").length;
  const pendingCount = resources.filter((resource) => resource.status === "uploaded" || resource.status === "processing").length;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.11em] text-[var(--text-secondary)]">Guided Agent Wizard</p>
          <span className="text-xs text-[var(--text-secondary)]">Step {stepIndex + 1} / {WIZARD_STEPS.length}</span>
        </div>
        {isStudent ? (
          <p className="mb-2 text-xs text-[var(--text-secondary)]">
            Student simplified flow is active: access and capabilities are limited for safety.
          </p>
        ) : null}
        <div className="grid gap-1.5 sm:grid-cols-6">
          {WIZARD_STEPS.map((step, index) => (
            <div
              key={step}
              className={`rounded-md border px-2 py-1 text-center text-[10px] uppercase tracking-[0.08em] ${
                index === stepIndex
                  ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)] text-[var(--text-primary)]"
                  : index < stepIndex
                    ? "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
                    : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-tertiary)]"
              }`}
            >
              {step}
            </div>
          ))}
        </div>
      </div>

      {stepIndex === 0 ? (
        <section className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">1. Identity</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--text-secondary)]">Agent name</span>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Physics Exam Coach" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--text-secondary)]">Subject area</span>
              <Input value={subjectArea} onChange={(event) => setSubjectArea(event.target.value)} placeholder="Physics" />
            </label>
          </div>
          <label className="space-y-1">
            <span className="text-xs text-[var(--text-secondary)]">Grade level</span>
            <Input value={gradeLevel} onChange={(event) => setGradeLevel(event.target.value)} placeholder="IB DP / Year 12" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-[var(--text-secondary)]">Description</span>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-[92px] resize-none"
              placeholder="What this agent should help with and what success looks like."
            />
          </label>
        </section>
      ) : null}

      {stepIndex === 1 ? (
        <section className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">2. Resources</h3>
          <p className="text-xs text-[var(--text-secondary)]">
            Upload mark schemes, specs, textbooks, and exam papers. Processing status updates in real time.
          </p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]">
            <Upload className="h-4 w-4" />
            {uploadingResources ? "Uploading..." : "Upload resources"}
            <input
              type="file"
              className="hidden"
              multiple
              disabled={uploadingResources}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                void handleUploadResources(files);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
            {resources.length} selected · {processedCount} processed · {pendingCount} pending
          </div>
          <div className="space-y-2">
            {resources.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--border-default)] px-3 py-4 text-xs text-[var(--text-secondary)]">
                No resources added yet. You can continue without files, but extraction quality will be lower.
              </p>
            ) : (
              resources.map((resource) => (
                <div
                  key={resource._id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[var(--text-primary)]">{resource.filename}</p>
                    <p className={`text-xs capitalize ${statusTone(resource.status)}`}>{resource.status}</p>
                    {resource.error ? <p className="text-xs text-[var(--danger)]">{resource.error}</p> : null}
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeResource(resource._id)}>
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      {stepIndex === 2 ? (
        <section className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">3. Behavior</h3>
              <p className="text-xs text-[var(--text-secondary)]">
                Generate a system prompt and extracted metadata from uploaded resources.
              </p>
            </div>
            <Button type="button" variant="secondary" onClick={() => void generateBehaviorFromResources()} disabled={extractingBehavior} className="gap-1.5">
              {extractingBehavior ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate from resources
            </Button>
          </div>
          <label className="space-y-1">
            <span className="text-xs text-[var(--text-secondary)]">System prompt (editable)</span>
            <Textarea
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              className="min-h-[210px] resize-y leading-relaxed"
              placeholder="Generate from resources or write your own behavior prompt."
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-[var(--text-secondary)]">Guidelines summary</span>
            <Textarea
              value={guidelinesSummary}
              onChange={(event) => setGuidelinesSummary(event.target.value)}
              className="min-h-[84px] resize-none"
              placeholder="High-level summary extracted from uploaded files."
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--text-secondary)]">Topic map</span>
              <Textarea
                value={textAreaListValue(topicMap)}
                onChange={(event) => setTopicMap(parseTextAreaList(event.target.value, 16))}
                className="min-h-[100px] resize-none"
                placeholder="One topic per line"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--text-secondary)]">Rubric hints</span>
              <Textarea
                value={textAreaListValue(rubricHints)}
                onChange={(event) => setRubricHints(parseTextAreaList(event.target.value, 12))}
                className="min-h-[100px] resize-none"
                placeholder="One hint per line"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--text-secondary)]">Common misconceptions</span>
              <Textarea
                value={textAreaListValue(misconceptions)}
                onChange={(event) => setMisconceptions(parseTextAreaList(event.target.value, 12))}
                className="min-h-[100px] resize-none"
                placeholder="One misconception per line"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--text-secondary)]">Vocabulary</span>
              <Textarea
                value={textAreaListValue(vocabulary)}
                onChange={(event) => setVocabulary(parseTextAreaList(event.target.value, 20))}
                className="min-h-[100px] resize-none"
                placeholder="One term per line"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--text-secondary)]">Exam structure</span>
              <Textarea
                value={textAreaListValue(examStructure)}
                onChange={(event) => setExamStructure(parseTextAreaList(event.target.value, 12))}
                className="min-h-[100px] resize-none"
                placeholder="One structure item per line"
              />
            </label>
          </div>
        </section>
      ) : null}

      {stepIndex === 3 ? (
        <section className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">4. Capabilities</h3>
          <p className="text-xs text-[var(--text-secondary)]">
            Choose what this agent can do.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {visibleCapabilities.map((capability) => {
              const selected = capabilities.includes(capability.id);
              return (
                <button
                  key={capability.id}
                  type="button"
                  onClick={() => toggleCapability(capability.id)}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    selected
                      ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)]"
                      : "border-[var(--border-default)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <p className="text-sm font-medium text-[var(--text-primary)]">{capability.label}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{capability.description}</p>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {stepIndex === 4 ? (
        <section className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">5. Access</h3>
          <p className="text-xs text-[var(--text-secondary)]">
            Choose who can use this agent.
          </p>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setAccessLevel("private")}
              className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                accessLevel === "private"
                  ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)]"
                  : "border-[var(--border-default)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <p className="text-sm font-medium text-[var(--text-primary)]">Private</p>
              <p className="text-xs text-[var(--text-secondary)]">Only you can use this agent.</p>
            </button>
            {!isStudent ? (
              <button
                type="button"
                onClick={() => setAccessLevel("class")}
                className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                  accessLevel === "class"
                    ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)]"
                    : "border-[var(--border-default)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                <p className="text-sm font-medium text-[var(--text-primary)]">Class</p>
                <p className="text-xs text-[var(--text-secondary)]">Shared with your class/collaborators.</p>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setAccessLevel("school")}
              className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                accessLevel === "school"
                  ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)]"
                  : "border-[var(--border-default)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <p className="text-sm font-medium text-[var(--text-primary)]">{isStudent ? "Public (School)" : "School"}</p>
              <p className="text-xs text-[var(--text-secondary)]">
                {isStudent
                  ? "Visible to students in your school (admin moderation required)."
                  : "Visible to all students in your school."}
              </p>
            </button>
          </div>
        </section>
      ) : null}

      {stepIndex === 5 ? (
        <section className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">6. Preview</h3>
          <p className="text-xs text-[var(--text-secondary)]">
            Test a message with this agent before publishing.
          </p>
          <label className="space-y-1">
            <span className="text-xs text-[var(--text-secondary)]">Test message</span>
            <Textarea
              value={previewMessage}
              onChange={(event) => setPreviewMessage(event.target.value)}
              className="min-h-[88px] resize-none"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => void runPreview()} disabled={previewLoading} className="gap-1.5">
              {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Run preview
            </Button>
            {previewModel ? <span className="text-xs text-[var(--text-secondary)]">Model: {previewModel}</span> : null}
          </div>
          <div className="space-y-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
            <div className="ml-auto max-w-[92%] rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]">
              {previewMessage || "Ask a test question to preview this agent."}
            </div>
            <div className="mr-auto max-w-[92%] rounded-xl border border-[color-mix(in_oklab,var(--accent-cyan)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_8%,transparent)] px-3 py-2 text-sm text-[var(--text-primary)]">
              {previewReply || "Preview response will appear here."}
            </div>
          </div>
        </section>
      ) : null}

      <div className="flex items-center justify-between border-t border-[var(--border-default)] pt-4">
        <Button type="button" variant="ghost" className="gap-1.5" onClick={stepIndex === 0 ? undefined : prevStep} asChild={stepIndex === 0}>
          {stepIndex === 0 ? <Link href={onCancelHref}>Cancel</Link> : <><ChevronLeft className="h-4 w-4" />Back</>}
        </Button>
        <div className="flex items-center gap-2">
          {stepIndex < WIZARD_STEPS.length - 1 ? (
            <Button type="button" onClick={nextStep} className="gap-1.5">
              Continue
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="button" onClick={() => void publishAgent()} disabled={submitting} className="gap-1.5">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Publish agent
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
