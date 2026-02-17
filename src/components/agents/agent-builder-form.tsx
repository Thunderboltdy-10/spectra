"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Sparkles, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type WizardStep = "audience" | "purpose" | "personality" | "expertise" | "boundaries" | "review";

const STEP_ORDER: WizardStep[] = ["audience", "purpose", "personality", "expertise", "boundaries", "review"];
const STEP_LABELS: Record<WizardStep, string> = {
  audience: "Audience",
  purpose: "Purpose",
  personality: "Personality",
  expertise: "Expertise",
  boundaries: "Boundaries",
  review: "Review",
};

const SUBJECT_EMOJIS: Record<string, string> = {
  math: "🧮",
  science: "🔬",
  english: "📝",
  history: "🏛️",
  cs: "💻",
  languages: "🌍",
  arts: "🎨",
  economics: "📈",
  philosophy: "🤔",
  default: "🎓",
};

const COMMUNICATION_STYLES = ["Formal", "Friendly", "Encouraging", "Direct", "Socratic"] as const;
const TEACHING_STYLES = ["Step-by-step", "Discovery-based", "Example-driven", "Discussion-oriented"] as const;
const SUBJECTS = ["Math", "Science", "English", "History", "CS", "Languages", "Arts", "Economics", "Philosophy", "Other"] as const;
const LEVELS = ["Primary", "Secondary", "A-Level", "University", "Professional"] as const;
const AUDIENCE_OPTIONS = ["Students", "Teachers", "Parents", "Administrators", "General"] as const;
const PATIENCE_LABELS: Record<number, string> = {
  1: "Quick & Direct",
  2: "Concise",
  3: "Balanced",
  4: "Patient",
  5: "Very Patient & Thorough",
};
const STRICTNESS_LABELS: Record<number, string> = {
  1: "Lenient",
  2: "Relaxed",
  3: "Balanced",
  4: "Firm",
  5: "Strict",
};
const BOUNDARY_OPTIONS = [
  { id: "no-homework-answers", label: "Don't give direct homework answers — guide instead" },
  { id: "no-inappropriate", label: "Don't generate inappropriate content" },
  { id: "no-fabrication", label: "Don't fabricate sources or facts" },
  { id: "stay-on-topic", label: "Don't go off-topic" },
  { id: "ask-clarification", label: "Always ask for clarification when unsure" },
] as const;

// ---------------------------------------------------------------------------
// Public types (consumed by parent page)
// ---------------------------------------------------------------------------

export type AgentBuilderValues = {
  name: string;
  description: string;
  category: string;
  systemPrompt: string;
  avatarEmoji?: string;
  visibility: "public" | "private";
  preferredMode?: string;
};

type AgentBuilderFormProps = {
  onSubmit: (values: AgentBuilderValues) => Promise<void>;
  onCancelHref?: string;
};

// ---------------------------------------------------------------------------
// Generated result shape
// ---------------------------------------------------------------------------

type GeneratedAgent = {
  name: string;
  description: string;
  systemPrompt: string;
  suggestedMode: string;
  suggestedCategory: string;
  avatarEmoji: string;
};

// ---------------------------------------------------------------------------
// Chip component
// ---------------------------------------------------------------------------

function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded-full border px-4 py-1.5 text-sm font-medium transition-all duration-150 select-none ${
        selected
          ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_15%,transparent)] text-[var(--accent-cyan)]"
          : "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--accent-cyan)] hover:text-[var(--text-primary)]"
      }`}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Slider component
// ---------------------------------------------------------------------------

function LabeledSlider({
  value,
  min,
  max,
  labels,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  labels: Record<number, string>;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-[var(--text-secondary)]">
        <span>{labels[min]}</span>
        <span className="font-semibold text-[var(--accent-cyan)]">{labels[value]}</span>
        <span>{labels[max]}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--border-default)] accent-[var(--accent-cyan)]"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function ProgressBar({ currentStepIndex }: { currentStepIndex: number }) {
  return (
    <div className="mb-8">
      <div className="flex gap-2 mb-3">
        {STEP_ORDER.map((step, i) => (
          <div
            key={step}
            className={`flex-1 h-1.5 rounded-full transition-all duration-300 ${
              i <= currentStepIndex ? "bg-[var(--accent-cyan)]" : "bg-[var(--border-default)]"
            }`}
          />
        ))}
      </div>
      <div className="flex justify-between">
        {STEP_ORDER.map((step, i) => (
          <span
            key={step}
            className={`text-xs font-medium transition-colors duration-150 ${
              i === currentStepIndex
                ? "text-[var(--accent-cyan)]"
                : i < currentStepIndex
                ? "text-[var(--text-secondary)]"
                : "text-[var(--text-secondary)] opacity-40"
            }`}
          >
            {STEP_LABELS[step]}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Audience
// ---------------------------------------------------------------------------

function StepAudience({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">Who is this agent for?</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Select the primary audience this agent will serve.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {AUDIENCE_OPTIONS.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={value === option}
            onClick={() => onChange(option)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Purpose
// ---------------------------------------------------------------------------

function StepPurpose({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const charCount = value.length;
  const minLength = 50;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">What should this agent help students with?</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Describe the agent's primary teaching goal in plain language.
        </p>
      </div>
      <div className="space-y-2">
        <Textarea
          className="min-h-[140px] resize-none font-inherit text-base leading-relaxed"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Help students understand calculus concepts through worked examples and guided practice, building confidence step by step."
          autoFocus
        />
        <div className="flex items-center justify-between text-xs">
          <span className={charCount < minLength ? "text-[var(--text-secondary)]" : "text-[var(--accent-cyan)]"}>
            {charCount < minLength ? `${minLength - charCount} more characters needed` : "Looks good"}
          </span>
          <span className="text-[var(--text-secondary)]">{charCount} characters</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Personality
// ---------------------------------------------------------------------------

function StepPersonality({
  communication,
  teachingStyle,
  patience,
  onCommunicationChange,
  onTeachingStyleChange,
  onPatienceChange,
}: {
  communication: string;
  teachingStyle: string;
  patience: number;
  onCommunicationChange: (v: string) => void;
  onTeachingStyleChange: (v: string) => void;
  onPatienceChange: (v: number) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">How should it communicate?</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Shape the agent's voice and teaching approach.
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-[var(--text-primary)]">Communication style</p>
        <div className="flex flex-wrap gap-2">
          {COMMUNICATION_STYLES.map((style) => (
            <Chip
              key={style}
              label={style}
              selected={communication === style}
              onClick={() => onCommunicationChange(style)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-[var(--text-primary)]">Teaching style</p>
        <div className="flex flex-wrap gap-2">
          {TEACHING_STYLES.map((style) => (
            <Chip
              key={style}
              label={style}
              selected={teachingStyle === style}
              onClick={() => onTeachingStyleChange(style)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-[var(--text-primary)]">Patience level</p>
        <LabeledSlider
          value={patience}
          min={1}
          max={5}
          labels={PATIENCE_LABELS}
          onChange={onPatienceChange}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Expertise
// ---------------------------------------------------------------------------

function StepExpertise({
  subjects,
  level,
  onSubjectsChange,
  onLevelChange,
}: {
  subjects: string[];
  level: string;
  onSubjectsChange: (v: string[]) => void;
  onLevelChange: (v: string) => void;
}) {
  function toggleSubject(subject: string) {
    if (subjects.includes(subject)) {
      onSubjectsChange(subjects.filter((s) => s !== subject));
    } else {
      onSubjectsChange([...subjects, subject]);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">What is this agent expert in?</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Select the subjects and the level of students it will teach.
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-[var(--text-primary)]">Subjects</p>
        <div className="flex flex-wrap gap-2">
          {SUBJECTS.map((subject) => (
            <Chip
              key={subject}
              label={subject}
              selected={subjects.includes(subject)}
              onClick={() => toggleSubject(subject)}
            />
          ))}
        </div>
        {subjects.length === 0 && (
          <p className="text-xs text-[var(--text-secondary)]">Select at least one subject</p>
        )}
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-[var(--text-primary)]">Education level</p>
        <div className="flex flex-wrap gap-2">
          {LEVELS.map((lvl) => (
            <Chip
              key={lvl}
              label={lvl}
              selected={level === lvl}
              onClick={() => onLevelChange(lvl)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Boundaries
// ---------------------------------------------------------------------------

function StepBoundaries({
  selected,
  strictness,
  onToggle,
  onStrictnessChange,
}: {
  selected: string[];
  strictness: number;
  onToggle: (id: string) => void;
  onStrictnessChange: (v: number) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">Set agent boundaries</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Define what this agent should and should not do.
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-[var(--text-primary)]">What should it NOT do?</p>
        <div className="space-y-2">
          {BOUNDARY_OPTIONS.map((option) => {
            const isChecked = selected.includes(option.id);
            return (
              <label
                key={option.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-all duration-150 ${
                  isChecked
                    ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_8%,transparent)]"
                    : "border-[var(--border-default)] bg-[var(--bg-secondary)] hover:border-[var(--accent-cyan)] hover:bg-[var(--bg-elevated)]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => onToggle(option.id)}
                  className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--accent-cyan)]"
                />
                <span className="text-sm text-[var(--text-primary)]">{option.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-[var(--text-primary)]">Enforcement strictness</p>
        <LabeledSlider
          value={strictness}
          min={1}
          max={5}
          labels={STRICTNESS_LABELS}
          onChange={onStrictnessChange}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Review & Generate
// ---------------------------------------------------------------------------

function StepReview({
  purpose,
  communication,
  teachingStyle,
  patience,
  subjects,
  level,
  boundaries,
  strictness,
  generated,
  generating,
  editedSystemPrompt,
  onEditedSystemPromptChange,
  onGenerate,
  onSubmit,
  submitting,
}: {
  purpose: string;
  communication: string;
  teachingStyle: string;
  patience: number;
  subjects: string[];
  level: string;
  boundaries: string[];
  strictness: number;
  generated: GeneratedAgent | null;
  generating: boolean;
  editedSystemPrompt: string;
  onEditedSystemPromptChange: (v: string) => void;
  onGenerate: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const [promptExpanded, setPromptExpanded] = useState(false);

  const boundaryLabels = BOUNDARY_OPTIONS.filter((o) => boundaries.includes(o.id)).map((o) => o.label);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">Review & Generate</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Review your choices then generate your agent's full configuration with AI.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryCard label="Purpose" value={purpose} />
        <SummaryCard
          label="Personality"
          value={`${communication} • ${teachingStyle} • Patience ${patience}/5`}
        />
        <SummaryCard
          label="Expertise"
          value={subjects.length ? `${subjects.join(", ")} — ${level}` : `${level} (no subjects selected)`}
        />
        <SummaryCard
          label="Boundaries"
          value={
            boundaryLabels.length
              ? `${boundaryLabels.length} rule${boundaryLabels.length > 1 ? "s" : ""} — Strictness ${strictness}/5`
              : `No rules set — Strictness ${strictness}/5`
          }
        />
      </div>

      {/* Generate button */}
      {!generated && (
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className={`relative w-full cursor-pointer overflow-hidden rounded-xl border px-6 py-4 text-center transition-all duration-200 ${
            generating
              ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,transparent)]"
              : "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_8%,transparent)] hover:bg-[color-mix(in_oklab,var(--accent-cyan)_15%,transparent)]"
          }`}
        >
          {generating ? (
            <span className="flex items-center justify-center gap-2 text-[var(--accent-cyan)]">
              <SparklesAnimation />
              <span className="font-semibold">Generating agent configuration...</span>
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2 font-semibold text-[var(--accent-cyan)]">
              <Sparkles className="h-5 w-5" />
              Generate Agent
            </span>
          )}
        </button>
      )}

      {/* Generated result */}
      {generated && (
        <div className="space-y-4 rounded-xl border border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_6%,transparent)] p-4">
          <div className="flex items-start gap-3">
            <span className="text-3xl leading-none">{generated.avatarEmoji}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-[var(--text-primary)]">{generated.name}</h3>
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-[var(--accent-cyan)]" />
              </div>
              <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{generated.description}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Tag label={generated.suggestedCategory} />
                <Tag label={generated.suggestedMode} />
              </div>
            </div>
          </div>

          {/* Collapsible prompt editor */}
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)]">
            <button
              type="button"
              onClick={() => setPromptExpanded((p) => !p)}
              className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                System prompt preview
              </span>
              {promptExpanded ? (
                <ChevronUp className="h-4 w-4 text-[var(--text-secondary)]" />
              ) : (
                <ChevronDown className="h-4 w-4 text-[var(--text-secondary)]" />
              )}
            </button>
            {promptExpanded && (
              <div className="border-t border-[var(--border-default)] p-3">
                <Textarea
                  className="min-h-[200px] resize-y font-mono text-xs"
                  value={editedSystemPrompt}
                  onChange={(e) => onEditedSystemPromptChange(e.target.value)}
                />
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  You can edit the prompt before creating the agent.
                </p>
              </div>
            )}
          </div>

          {/* Regenerate + Create */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              className="gap-1.5"
              onClick={onGenerate}
              disabled={generating || submitting}
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Regenerate
            </Button>
            <Button
              type="button"
              onClick={onSubmit}
              disabled={submitting || generating}
              className="flex-1 gap-1.5 sm:flex-none"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Create Agent
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helper components
// ---------------------------------------------------------------------------

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">{label}</p>
      <p className="mt-1 text-sm text-[var(--text-primary)] line-clamp-3">{value}</p>
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
      {label}
    </span>
  );
}

function SparklesAnimation() {
  return (
    <span className="inline-flex gap-0.5">
      {["✦", "✦", "✦"].map((star, i) => (
        <span
          key={i}
          className="inline-block animate-pulse text-[var(--accent-cyan)]"
          style={{ animationDelay: `${i * 150}ms` }}
        >
          {star}
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main wizard component
// ---------------------------------------------------------------------------

export function AgentBuilderForm({ onSubmit, onCancelHref = "/agents" }: AgentBuilderFormProps) {
  // Wizard navigation
  const [currentStep, setCurrentStep] = useState<WizardStep>("audience");
  const currentStepIndex = STEP_ORDER.indexOf(currentStep);

  // Step 1: Audience
  const [audience, setAudience] = useState("Students");

  // Step 2: Purpose
  const [purpose, setPurpose] = useState("");

  // Step 3: Personality
  const [communication, setCommunication] = useState("Friendly");
  const [teachingStyle, setTeachingStyle] = useState("Step-by-step");
  const [patience, setPatience] = useState(3);

  // Step 4: Expertise
  const [subjects, setSubjects] = useState<string[]>([]);
  const [level, setLevel] = useState("Secondary");

  // Step 5: Boundaries
  const [boundaries, setBoundaries] = useState<string[]>([
    "no-homework-answers",
    "no-fabrication",
  ]);
  const [strictness, setStrictness] = useState(3);

  // Step 6: Review / Generate
  const [generated, setGenerated] = useState<GeneratedAgent | null>(null);
  const [generating, setGenerating] = useState(false);
  const [editedSystemPrompt, setEditedSystemPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // -------------------------------------------------------------------------
  // Validation per step
  // -------------------------------------------------------------------------

  function canProceed(): boolean {
    switch (currentStep) {
      case "audience":
        return Boolean(audience);
      case "purpose":
        return purpose.trim().length >= 50;
      case "personality":
        return Boolean(communication && teachingStyle);
      case "expertise":
        return subjects.length > 0 && Boolean(level);
      case "boundaries":
        return true;
      case "review":
        return false;
    }
  }

  function goNext() {
    if (!canProceed()) return;
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEP_ORDER.length) {
      setCurrentStep(STEP_ORDER[nextIndex]!);
    }
  }

  function goBack() {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(STEP_ORDER[prevIndex]!);
    }
  }

  function goToStep(index: number) {
    if (index <= currentStepIndex) {
      setCurrentStep(STEP_ORDER[index]!);
    }
  }

  function toggleBoundary(id: string) {
    setBoundaries((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id],
    );
  }

  // -------------------------------------------------------------------------
  // Generate
  // -------------------------------------------------------------------------

  async function handleGenerate() {
    setGenerating(true);
    try {
      const boundaryLabels = BOUNDARY_OPTIONS.filter((o) => boundaries.includes(o.id)).map((o) => o.label);
      const response = await fetch("/api/agents/generate-full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience,
          purpose: purpose.trim(),
          personality: communication,
          teachingStyle,
          patience,
          subjects: subjects.map((s) => s.toLowerCase()),
          level,
          boundaries: boundaryLabels,
          strictness,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data = (await response.json()) as GeneratedAgent;
      setGenerated(data);
      setEditedSystemPrompt(data.systemPrompt);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to generate agent");
    } finally {
      setGenerating(false);
    }
  }

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  async function handleSubmit() {
    if (!generated) return;
    if (submitting) return;

    setSubmitting(true);
    try {
      const primarySubject = subjects[0]?.toLowerCase() ?? "default";
      const avatarEmoji = SUBJECT_EMOJIS[primarySubject] ?? SUBJECT_EMOJIS.default;

      await onSubmit({
        name: generated.name,
        description: generated.description,
        category: generated.suggestedCategory,
        systemPrompt: editedSystemPrompt.trim() || generated.systemPrompt,
        avatarEmoji: generated.avatarEmoji || avatarEmoji,
        visibility: "public",
        preferredMode: generated.suggestedMode,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save agent");
    } finally {
      setSubmitting(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStep === "review";

  return (
    <div className="space-y-2">
      {/* Progress indicator with clickable step labels */}
      <div className="mb-8">
        <div className="flex gap-2 mb-3">
          {STEP_ORDER.map((step, i) => (
            <div
              key={step}
              className={`flex-1 h-1.5 rounded-full transition-all duration-300 ${
                i <= currentStepIndex ? "bg-[var(--accent-cyan)]" : "bg-[var(--border-default)]"
              }`}
            />
          ))}
        </div>
        <div className="flex justify-between">
          {STEP_ORDER.map((step, i) => (
            <button
              key={step}
              type="button"
              onClick={() => goToStep(i)}
              disabled={i > currentStepIndex}
              className={`cursor-pointer text-xs font-medium transition-colors duration-150 disabled:cursor-default ${
                i === currentStepIndex
                  ? "text-[var(--accent-cyan)]"
                  : i < currentStepIndex
                  ? "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] opacity-40"
              }`}
            >
              {STEP_LABELS[step]}
            </button>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="min-h-[320px]">
        {currentStep === "audience" && (
          <StepAudience value={audience} onChange={setAudience} />
        )}

        {currentStep === "purpose" && (
          <StepPurpose value={purpose} onChange={setPurpose} />
        )}

        {currentStep === "personality" && (
          <StepPersonality
            communication={communication}
            teachingStyle={teachingStyle}
            patience={patience}
            onCommunicationChange={setCommunication}
            onTeachingStyleChange={setTeachingStyle}
            onPatienceChange={setPatience}
          />
        )}

        {currentStep === "expertise" && (
          <StepExpertise
            subjects={subjects}
            level={level}
            onSubjectsChange={setSubjects}
            onLevelChange={setLevel}
          />
        )}

        {currentStep === "boundaries" && (
          <StepBoundaries
            selected={boundaries}
            strictness={strictness}
            onToggle={toggleBoundary}
            onStrictnessChange={setStrictness}
          />
        )}

        {currentStep === "review" && (
          <StepReview
            purpose={purpose}
            communication={communication}
            teachingStyle={teachingStyle}
            patience={patience}
            subjects={subjects}
            level={level}
            boundaries={boundaries}
            strictness={strictness}
            generated={generated}
            generating={generating}
            editedSystemPrompt={editedSystemPrompt}
            onEditedSystemPromptChange={setEditedSystemPrompt}
            onGenerate={handleGenerate}
            onSubmit={handleSubmit}
            submitting={submitting}
          />
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between border-t border-[var(--border-default)] pt-5">
        <Button
          type="button"
          variant="ghost"
          onClick={isFirstStep ? undefined : goBack}
          asChild={isFirstStep}
          className="gap-1.5"
        >
          {isFirstStep ? (
            <a href={onCancelHref}>Cancel</a>
          ) : (
            <>
              <ChevronLeft className="h-4 w-4" />
              Back
            </>
          )}
        </Button>

        {!isLastStep && (
          <Button
            type="button"
            onClick={goNext}
            disabled={!canProceed()}
            className="gap-1.5"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
