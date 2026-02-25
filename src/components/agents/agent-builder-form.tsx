"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, Loader2, MessageSquareText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { defaultAvatarIconForCategory } from "@/components/agents/agent-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type BuilderStep =
  | "goal"
  | "audience"
  | "curriculum"
  | "ib_focus"
  | "level"
  | "expertise"
  | "tone"
  | "boundaries"
  | "context"
  | "review";

const EXPERTISE_CHOICES = [
  "Math",
  "Science",
  "Biology",
  "Chemistry",
  "Physics",
  "Computer Science",
  "English Literature",
  "History",
  "Economics",
  "Business",
  "Essay Writing",
  "Exam Prep",
] as const;

const AUDIENCE_CHOICES = ["Users", "Teachers", "Parents", "School Staff", "General"] as const;
const CURRICULUM_CHOICES = ["General Academic", "IB", "GCSE", "A-Level", "AP", "University", "Professional"] as const;
const LEVEL_CHOICES = ["Middle School", "Secondary", "IB DP", "Undergraduate", "Graduate", "Professional"] as const;
const TONE_CHOICES = ["Friendly coach", "Socratic guide", "Direct and concise", "Formal tutor", "High-energy motivator"] as const;

export type AgentBuilderValues = {
  name: string;
  description: string;
  category: string;
  systemPrompt: string;
  avatarEmoji?: string;
  avatarIcon?: string;
  visibility: "public" | "private";
  preferredMode?: string;
};

type AgentBuilderFormProps = {
  onSubmit: (values: AgentBuilderValues) => Promise<void>;
  onCancelHref?: string;
};

type GeneratedAgent = {
  name: string;
  description: string;
  systemPrompt: string;
  suggestedMode: string;
  suggestedCategory: string;
  avatarEmoji: string;
};

type Answers = {
  goal: string;
  audience: string;
  curriculum: string;
  ibFocus: string;
  level: string;
  expertise: string[];
  customExpertise: string;
  tone: string;
  boundaries: string;
  context: string;
};

function Bubble({
  role,
  text,
}: {
  role: "assistant" | "user";
  text: string;
}) {
  return (
    <div className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm ${role === "assistant"
      ? "mr-auto border border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-primary)]"
      : "ml-auto border border-[color-mix(in_oklab,var(--accent-cyan)_38%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,transparent)] text-[var(--text-primary)]"}`}>
      {text}
    </div>
  );
}

function ChoiceRow({
  values,
  activeValue,
  onSelect,
}: {
  values: readonly string[];
  activeValue: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => {
        const selected = activeValue === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onSelect(value)}
            className={`rounded-full border px-3 py-1.5 text-xs transition ${selected
              ? "border-[color-mix(in_oklab,var(--accent-cyan)_42%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_14%,transparent)] text-[var(--text-primary)]"
              : "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
          >
            {value}
          </button>
        );
      })}
    </div>
  );
}

function readableStepTitle(step: BuilderStep) {
  if (step === "ib_focus") return "IB Focus";
  return step.charAt(0).toUpperCase() + step.slice(1);
}

export function AgentBuilderForm({ onSubmit, onCancelHref = "/agents" }: AgentBuilderFormProps) {
  const [builderMode, setBuilderMode] = useState<"guided" | "manual">("guided");
  const [answers, setAnswers] = useState<Answers>({
    goal: "",
    audience: "Users",
    curriculum: "General Academic",
    ibFocus: "",
    level: "Secondary",
    expertise: [],
    customExpertise: "",
    tone: "Friendly coach",
    boundaries: "Do not fabricate facts or sources.",
    context: "",
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [freeText, setFreeText] = useState("");
  const [generated, setGenerated] = useState<GeneratedAgent | null>(null);
  const [editedSystemPrompt, setEditedSystemPrompt] = useState("");
  const [manualValues, setManualValues] = useState({
    name: "",
    description: "",
    category: "General",
    preferredMode: "general",
    systemPrompt: "",
  });
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const steps = useMemo(() => {
    const base: BuilderStep[] = ["goal", "audience", "curriculum"];
    if (answers.curriculum === "IB") {
      base.push("ib_focus");
    }
    base.push("level", "expertise", "tone", "boundaries", "context", "review");
    return base;
  }, [answers.curriculum]);

  const currentStep = steps[Math.min(stepIndex, Math.max(steps.length - 1, 0))] ?? "goal";
  const atReview = currentStep === "review";
  const isFirstStep = stepIndex === 0;

  const answeredPairs = useMemo(() => {
    const items: Array<{ step: BuilderStep; question: string; answer: string }> = [];
    const push = (step: BuilderStep, question: string, answer: string) => {
      if (!steps.includes(step)) return;
      if (!answer.trim()) return;
      items.push({ step, question, answer });
    };
    push("goal", "What should this agent help users with?", answers.goal);
    push("audience", "Who is this mainly for?", answers.audience);
    push("curriculum", "Which curriculum or track should it align with?", answers.curriculum);
    if (steps.includes("ib_focus")) {
      push("ib_focus", "What IB focus should it prioritize?", answers.ibFocus);
    }
    push("level", "What level should explanations target?", answers.level);
    push("expertise", "Which expertise areas should it include?", [...answers.expertise, answers.customExpertise].filter(Boolean).join(", "));
    push("tone", "How should it communicate?", answers.tone);
    push("boundaries", "Any boundaries or safeguards?", answers.boundaries);
    push("context", "Any extra context to improve output?", answers.context);
    return items;
  }, [answers, steps]);

  function questionForStep(step: BuilderStep) {
    switch (step) {
      case "goal":
        return "What should this agent help users with?";
      case "audience":
        return "Who is this mainly for?";
      case "curriculum":
        return "Which curriculum or track should it align with?";
      case "ib_focus":
        return "You selected IB. Should this focus on HL, SL, TOK, EE, IA support, or exam technique?";
      case "level":
        return "What level should explanations target?";
      case "expertise":
        return "Pick expertise areas and add custom ones if needed.";
      case "tone":
        return "How should it communicate?";
      case "boundaries":
        return "Any hard boundaries or safety rules?";
      case "context":
        return "Any additional context to improve generation quality?";
      case "review":
        return "Review this setup, then generate the agent.";
      default:
        return "";
    }
  }

  function valueForStep(step: BuilderStep) {
    if (step === "goal") return answers.goal;
    if (step === "ib_focus") return answers.ibFocus;
    if (step === "boundaries") return answers.boundaries;
    if (step === "context") return answers.context;
    if (step === "expertise") return answers.customExpertise;
    return "";
  }

  useEffect(() => {
    if (currentStep === "review") return;
    const needsTextEntry =
      currentStep === "goal" ||
      currentStep === "ib_focus" ||
      currentStep === "boundaries" ||
      currentStep === "context" ||
      currentStep === "expertise";
    if (!needsTextEntry) {
      setFreeText("");
      return;
    }
    setFreeText(valueForStep(currentStep));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  function persistCurrentStep() {
    const clean = freeText.trim();
    if (currentStep === "goal") {
      if (clean.length < 20) {
        toast.error("Add a clearer goal (at least 20 characters).");
        return false;
      }
      setAnswers((prev) => ({ ...prev, goal: clean }));
      return true;
    }
    if (currentStep === "ib_focus") {
      if (!clean) {
        toast.error("Add IB focus details.");
        return false;
      }
      setAnswers((prev) => ({ ...prev, ibFocus: clean }));
      return true;
    }
    if (currentStep === "boundaries") {
      if (!clean) {
        toast.error("Add at least one boundary.");
        return false;
      }
      setAnswers((prev) => ({ ...prev, boundaries: clean }));
      return true;
    }
    if (currentStep === "context") {
      setAnswers((prev) => ({ ...prev, context: clean }));
      return true;
    }
    if (currentStep === "expertise") {
      const hasAny = answers.expertise.length > 0 || clean.length > 0 || answers.customExpertise.trim().length > 0;
      if (!hasAny) {
        toast.error("Select at least one expertise area or type your own.");
        return false;
      }
      if (clean.length > 0 && clean !== answers.customExpertise.trim()) {
        setAnswers((prev) => ({ ...prev, customExpertise: clean }));
      }
      return true;
    }
    return true;
  }

  function goNext() {
    if (!atReview && !persistCurrentStep()) return;
    setStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
  }

  function goBack() {
    setStepIndex((prev) => Math.max(0, prev - 1));
  }

  function toggleExpertise(value: string) {
    setAnswers((prev) => {
      const has = prev.expertise.includes(value);
      return {
        ...prev,
        expertise: has ? prev.expertise.filter((item) => item !== value) : [...prev.expertise, value],
      };
    });
  }

  async function generateAgent() {
    setGenerating(true);
    try {
      const payload = {
        goal: answers.goal.trim(),
        audience: answers.audience,
        curriculum: answers.curriculum,
        ibFocus: answers.ibFocus.trim(),
        level: answers.level,
        expertise: [
          ...answers.expertise,
          ...answers.customExpertise.split(",").map((item) => item.trim()).filter(Boolean),
        ],
        tone: answers.tone,
        boundaries: answers.boundaries.trim(),
        contextNotes: answers.context.trim(),
        builderStyle: "conversation",
      };

      const response = await fetch("/api/agents/generate-full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

  async function createAgent() {
    if (!generated) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: generated.name,
        description: generated.description,
        category: generated.suggestedCategory,
        systemPrompt: editedSystemPrompt.trim() || generated.systemPrompt,
        avatarEmoji: generated.avatarEmoji,
        avatarIcon: defaultAvatarIconForCategory(generated.suggestedCategory),
        visibility: "public",
        preferredMode: generated.suggestedMode,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save agent");
    } finally {
      setSubmitting(false);
    }
  }

  async function createManualAgent() {
    const name = manualValues.name.trim();
    const description = manualValues.description.trim();
    const systemPrompt = manualValues.systemPrompt.trim();
    if (name.length < 3) {
      toast.error("Name must be at least 3 characters.");
      return;
    }
    if (description.length < 12) {
      toast.error("Add a clearer description.");
      return;
    }
    if (systemPrompt.length < 80) {
      toast.error("Manual system prompt must be at least 80 characters.");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name,
        description,
        category: manualValues.category.trim() || "General",
        systemPrompt,
        avatarEmoji: "🧠",
        avatarIcon: defaultAvatarIconForCategory(manualValues.category.trim() || "General"),
        visibility: "public",
        preferredMode: manualValues.preferredMode,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save agent");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
        <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Build mode</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            variant={builderMode === "guided" ? "default" : "secondary"}
            size="sm"
            onClick={() => setBuilderMode("guided")}
          >
            Guided Builder (Recommended)
          </Button>
          <Button
            type="button"
            variant={builderMode === "manual" ? "default" : "secondary"}
            size="sm"
            onClick={() => setBuilderMode("manual")}
          >
            Manual system prompt
          </Button>
        </div>
        {builderMode === "manual" ? (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            Manual mode skips guidance and expects a complete prompt design.
          </p>
        ) : (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            Guided mode asks adaptive questions and generates a structured prompt draft.
          </p>
        )}
      </div>

      {builderMode === "manual" ? (
        <div className="space-y-3 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Name</span>
              <Input
                value={manualValues.name}
                onChange={(event) => setManualValues((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Agent name"
                className="focus-visible:border-[var(--border-default)] focus-visible:ring-0"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Category</span>
              <Input
                value={manualValues.category}
                onChange={(event) => setManualValues((prev) => ({ ...prev, category: event.target.value }))}
                placeholder="Category (e.g., IB Essay Coach)"
                className="focus-visible:border-[var(--border-default)] focus-visible:ring-0"
              />
            </label>
          </div>
          <label className="space-y-1">
            <span className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Description</span>
            <Textarea
              value={manualValues.description}
              onChange={(event) => setManualValues((prev) => ({ ...prev, description: event.target.value }))}
              className="min-h-[84px] max-h-[180px] resize-none overflow-y-auto"
              placeholder="What this agent does and when it should be used."
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">System prompt</span>
            <Textarea
              value={manualValues.systemPrompt}
              onChange={(event) => setManualValues((prev) => ({ ...prev, systemPrompt: event.target.value }))}
              className="min-h-[220px] max-h-[520px] resize-y overflow-y-auto font-inherit leading-relaxed"
              placeholder="Write a full system prompt with role, boundaries, behavior rules, and output format."
            />
          </label>
          <div className="flex items-center justify-between border-t border-[var(--border-default)] pt-3">
            <Button type="button" variant="ghost" asChild>
              <a href={onCancelHref}>Cancel</a>
            </Button>
            <Button type="button" onClick={() => void createManualAgent()} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create Agent
            </Button>
          </div>
        </div>
      ) : (
      <>
      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            <MessageSquareText className="h-3.5 w-3.5" />
            Conversational Builder
          </p>
          <span className="text-xs text-[var(--text-secondary)]">
            Step {Math.min(stepIndex + 1, steps.length)} / {steps.length}
          </span>
        </div>
        <p className="mb-3 text-xs text-[var(--text-secondary)]">
          Answer one question at a time. The builder uses your answers in the background and then generates a full system prompt draft for review.
        </p>

        <div className="space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
          <Bubble role="assistant" text={questionForStep(currentStep)} />
          {currentStep !== "goal" && answeredPairs.length > 0 ? (
            <div className="pt-1">
              <p className="mb-1 text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">Captured so far</p>
              <div className="flex flex-wrap gap-1.5">
                {answeredPairs.slice(0, 6).map((pair) => (
                  <span key={pair.step} className="rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
                    {readableStepTitle(pair.step)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {!atReview ? (
          <div className="mt-3 space-y-3">
            {currentStep === "audience" ? (
              <ChoiceRow values={AUDIENCE_CHOICES} activeValue={answers.audience} onSelect={(value) => setAnswers((prev) => ({ ...prev, audience: value }))} />
            ) : null}
            {currentStep === "curriculum" ? (
              <ChoiceRow values={CURRICULUM_CHOICES} activeValue={answers.curriculum} onSelect={(value) => setAnswers((prev) => ({ ...prev, curriculum: value }))} />
            ) : null}
            {currentStep === "level" ? (
              <ChoiceRow values={LEVEL_CHOICES} activeValue={answers.level} onSelect={(value) => setAnswers((prev) => ({ ...prev, level: value }))} />
            ) : null}
            {currentStep === "tone" ? (
              <ChoiceRow values={TONE_CHOICES} activeValue={answers.tone} onSelect={(value) => setAnswers((prev) => ({ ...prev, tone: value }))} />
            ) : null}
            {currentStep === "expertise" ? (
              <div className="space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                <div className="flex flex-wrap gap-2">
                  {EXPERTISE_CHOICES.map((value) => {
                    const selected = answers.expertise.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => toggleExpertise(value)}
                        className={`rounded-full border px-2.5 py-1 text-xs transition ${selected
                          ? "border-[color-mix(in_oklab,var(--accent-cyan)_42%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_14%,transparent)] text-[var(--text-primary)]"
                          : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                      >
                        {value}
                      </button>
                    );
                  })}
                </div>
                <Textarea
                  value={answers.customExpertise}
                  onChange={(event) => setAnswers((prev) => ({ ...prev, customExpertise: event.target.value }))}
                  className="min-h-[72px] max-h-[180px] resize-none overflow-y-auto"
                  placeholder="Type your own expertise areas, comma-separated (e.g., TOK essay feedback, IA rubric coaching, SAT reading)."
                />
              </div>
            ) : null}

            {currentStep === "goal" || currentStep === "ib_focus" || currentStep === "boundaries" || currentStep === "context" || currentStep === "expertise" ? (
              <Textarea
                value={freeText}
                onChange={(event) => setFreeText(event.target.value)}
                className="min-h-[88px] max-h-[220px] resize-none overflow-y-auto"
                placeholder={
                  currentStep === "goal"
                    ? "Describe exactly what this agent should help users achieve."
                    : currentStep === "ib_focus"
                      ? "Example: Prioritize HL Math IA structure, TOK claims/evidence, and exam strategy."
                      : currentStep === "boundaries"
                        ? "Example: No fabricated citations, no direct homework answers, ask clarifying questions when context is missing."
                        : currentStep === "expertise"
                          ? "Optional: add extra expertise not listed above."
                          : "Optional extra context to improve generation quality."
                }
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {atReview ? (
        <div className="space-y-3 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Review Summary</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {answeredPairs.map((pair) => (
              <div key={`summary-${pair.step}`} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2.5">
                <p className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">{readableStepTitle(pair.step)}</p>
                <p className="mt-1 text-sm text-[var(--text-primary)]">{pair.answer}</p>
              </div>
            ))}
          </div>

          {!generated ? (
            <Button type="button" onClick={() => void generateAgent()} disabled={generating} className="gap-1.5">
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate Agent
            </Button>
          ) : (
            <div className="space-y-3 rounded-xl border border-[color-mix(in_oklab,var(--accent-cyan)_42%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,transparent)] p-3">
              <div>
                <p className="text-lg font-semibold text-[var(--text-primary)]">{generated.name}</p>
                <p className="text-sm text-[var(--text-secondary)]">{generated.description}</p>
              </div>
              <Textarea
                value={editedSystemPrompt}
                onChange={(event) => setEditedSystemPrompt(event.target.value)}
                className="min-h-[220px] max-h-[420px] resize-y overflow-y-auto text-sm leading-relaxed font-inherit"
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => void generateAgent()} disabled={generating || submitting} className="gap-1.5">
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Regenerate
                </Button>
                <Button type="button" onClick={() => void createAgent()} disabled={submitting || generating} className="gap-1.5">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Create Agent
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div className="flex items-center justify-between border-t border-[var(--border-default)] pt-4">
        <Button type="button" variant="ghost" className="gap-1.5" onClick={isFirstStep ? undefined : goBack} asChild={isFirstStep}>
          {isFirstStep ? <a href={onCancelHref}>Cancel</a> : <><ChevronLeft className="h-4 w-4" />Back</>}
        </Button>
        {!atReview ? (
          <Button type="button" onClick={goNext}>
            Continue
          </Button>
        ) : null}
      </div>
      </>
      )}
    </div>
  );
}
