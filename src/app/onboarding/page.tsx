"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, CheckCircle2, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  StepContainer,
  RadioCardGroup,
  ChipInput,
  ModeShowcase,
  LEARNING_STYLE_OPTIONS,
  DIFFICULTY_OPTIONS,
  COMMUNICATION_STYLE_OPTIONS,
} from "@/components/onboarding/steps";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOTAL_STEPS = 5;

type Prefs = {
  learningStyle: string;
  preferredDifficulty: string;
  communicationStyle: string;
  interests: string[];
};

// ---------------------------------------------------------------------------
// Progress dots
// ---------------------------------------------------------------------------

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`block rounded-full transition-all duration-300 ${
            i < current
              ? "h-2 w-2 bg-[var(--accent-cyan)]"
              : i === current
                ? "h-2 w-5 bg-[var(--accent-cyan)]"
                : "h-2 w-2 bg-[var(--border-default)]"
          }`}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 0 — Welcome
// ---------------------------------------------------------------------------

function WelcomeStep() {
  return (
    <StepContainer className="text-center">
      {/* Gradient orb hero */}
      <div className="relative mx-auto mb-8 h-32 w-32">
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: "var(--gradient-brand)",
            filter: "blur(18px)",
            opacity: 0.45,
            transform: "scale(1.3)",
          }}
        />
        <div
          className="relative flex h-full w-full items-center justify-center rounded-full"
          style={{ background: "var(--gradient-brand)" }}
        >
          <BookOpen className="h-14 w-14 text-white" />
        </div>
      </div>

      <h1 className="font-display mb-3 text-4xl font-bold tracking-tight text-[var(--text-primary)]">
        Welcome to AI School
      </h1>
      <p className="mx-auto max-w-md text-base leading-relaxed text-[var(--text-secondary)]">
        Your personalized AI learning companion — powered by the world's best language models,
        tailored to your style, your subjects, and your pace.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          { emoji: "🎓", title: "Personalized Tutor", desc: "Guided explanations at your level" },
          { emoji: "⚡", title: "Instant Feedback", desc: "Real-time help on any subject" },
          { emoji: "🧠", title: "Remembers You", desc: "Learns your strengths over time" },
        ].map((feature) => (
          <div
            key={feature.title}
            className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-4"
          >
            <p className="mb-1.5 text-2xl">{feature.emoji}</p>
            <p className="text-sm font-semibold text-[var(--text-primary)]">{feature.title}</p>
            <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{feature.desc}</p>
          </div>
        ))}
      </div>
    </StepContainer>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Learning Preferences
// ---------------------------------------------------------------------------

type PrefsStepProps = {
  prefs: Prefs;
  onChange: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
};

function LearningPrefsStep({ prefs, onChange }: PrefsStepProps) {
  return (
    <StepContainer>
      <h2 className="mb-1 text-2xl font-bold text-[var(--text-primary)]">
        How do you learn best?
      </h2>
      <p className="mb-6 text-sm text-[var(--text-secondary)]">
        We'll personalize every response to match your learning style.
      </p>

      <div className="space-y-6">
        <div>
          <label className="mb-3 block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
            Learning Style
          </label>
          <RadioCardGroup
            options={LEARNING_STYLE_OPTIONS}
            value={prefs.learningStyle}
            onChange={(value) => onChange("learningStyle", value)}
          />
        </div>

        <div>
          <label className="mb-3 block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
            Preferred Difficulty
          </label>
          <RadioCardGroup
            options={DIFFICULTY_OPTIONS}
            value={prefs.preferredDifficulty}
            onChange={(value) => onChange("preferredDifficulty", value)}
          />
        </div>

        <div>
          <label className="mb-3 block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
            Communication Style
          </label>
          <RadioCardGroup
            options={COMMUNICATION_STYLE_OPTIONS}
            value={prefs.communicationStyle}
            onChange={(value) => onChange("communicationStyle", value)}
          />
        </div>
      </div>
    </StepContainer>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Interests
// ---------------------------------------------------------------------------

type InterestsStepProps = {
  interests: string[];
  onChange: (interests: string[]) => void;
};

const SUGGESTED_INTERESTS = [
  "Mathematics",
  "Physics",
  "Chemistry",
  "Biology",
  "History",
  "Literature",
  "Computer Science",
  "Economics",
  "Psychology",
  "Philosophy",
];

function InterestsStep({ interests, onChange }: InterestsStepProps) {
  return (
    <StepContainer>
      <h2 className="mb-1 text-2xl font-bold text-[var(--text-primary)]">
        What interests you?
      </h2>
      <p className="mb-6 text-sm text-[var(--text-secondary)]">
        Add topics you're studying or curious about. Type and press Enter, or click a suggestion.
      </p>

      <ChipInput
        chips={interests}
        onChange={onChange}
        placeholder="e.g. Calculus, Ancient Rome, Machine Learning..."
      />

      <div className="mt-4">
        <p className="mb-2 text-xs text-[var(--text-secondary)]">Quick add:</p>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_INTERESTS.filter((s) => !interests.includes(s)).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onChange([...interests, suggestion])}
              className="cursor-pointer rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-cyan)] hover:bg-[color-mix(in_oklab,var(--accent-cyan)_8%,var(--bg-elevated))] hover:text-[var(--text-primary)]"
            >
              + {suggestion}
            </button>
          ))}
        </div>
      </div>
    </StepContainer>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Mode Tour
// ---------------------------------------------------------------------------

function ModeTourStep() {
  return (
    <StepContainer>
      <h2 className="mb-1 text-2xl font-bold text-[var(--text-primary)]">
        Meet your learning modes
      </h2>
      <p className="mb-6 text-sm text-[var(--text-secondary)]">
        AI School adapts to exactly what you need — choose a mode, or let Auto decide for you.
      </p>
      <ModeShowcase />
    </StepContainer>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Ready
// ---------------------------------------------------------------------------

function ReadyStep() {
  return (
    <StepContainer className="text-center">
      {/* Confetti-style celebration icon */}
      <div className="confetti-pop mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--success)_18%,var(--bg-elevated))]">
        <CheckCircle2 className="h-12 w-12 text-[var(--success)]" />
      </div>

      <h2 className="font-display mb-2 text-3xl font-bold text-[var(--text-primary)]">
        You're all set!
      </h2>
      <p className="mx-auto mb-8 max-w-sm text-base leading-relaxed text-[var(--text-secondary)]">
        Your preferences are saved. The AI will use them to personalize every interaction. You can
        always update them in Settings.
      </p>

      <div className="mx-auto grid max-w-sm gap-3">
        {[
          { emoji: "✅", text: "Learning preferences saved" },
          { emoji: "✅", text: "Interests recorded" },
          { emoji: "✅", text: "Modes tour complete" },
        ].map((item) => (
          <div
            key={item.text}
            className="flex items-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-2.5"
          >
            <span className="text-base">{item.emoji}</span>
            <p className="text-sm font-medium text-[var(--text-primary)]">{item.text}</p>
          </div>
        ))}
      </div>
    </StepContainer>
  );
}

// ---------------------------------------------------------------------------
// Main OnboardingPage
// ---------------------------------------------------------------------------

export default function OnboardingPage() {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>({
    learningStyle: "",
    preferredDifficulty: "",
    communicationStyle: "",
    interests: [],
  });

  function updatePref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  }

  function canAdvance(): boolean {
    if (step === 1) {
      return Boolean(
        prefs.learningStyle && prefs.preferredDifficulty && prefs.communicationStyle,
      );
    }
    return true;
  }

  async function handleNext() {
    if (step < TOTAL_STEPS - 1) {
      setStep((s) => s + 1);
      return;
    }
    // Final step — save preferences then mark onboarding complete
    setSaving(true);
    try {
      const saveResp = await fetch("/api/personal-soul", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          learningStyle: prefs.learningStyle || undefined,
          preferredDifficulty: prefs.preferredDifficulty || undefined,
          communicationStyle: prefs.communicationStyle || undefined,
          interests: prefs.interests.length > 0 ? prefs.interests : undefined,
        }),
      });
      if (!saveResp.ok) throw new Error(await saveResp.text());

      const patchResp = await fetch("/api/personal-soul", { method: "PATCH" });
      if (!patchResp.ok) throw new Error(await patchResp.text());

      toast.success("Welcome aboard! Your preferences are saved.");
      router.push("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save preferences");
    } finally {
      setSaving(false);
    }
  }

  const stepLabel =
    step === 0
      ? "Welcome"
      : step === 1
        ? "Learning Preferences"
        : step === 2
          ? "Interests"
          : step === 3
            ? "Mode Tour"
            : "Ready";

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 py-12"
      style={{
        background: `
          radial-gradient(circle at 10% 0%, color-mix(in oklab, var(--accent-cyan) 18%, transparent), transparent 42%),
          radial-gradient(circle at 90% 90%, color-mix(in oklab, var(--accent-coral) 14%, transparent), transparent 40%),
          var(--bg-primary)
        `,
      }}
    >
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <ProgressDots current={step} total={TOTAL_STEPS} />
          <p className="mt-3 text-xs font-medium uppercase tracking-widest text-[var(--text-secondary)]">
            Step {step + 1} of {TOTAL_STEPS} &mdash; {stepLabel}
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl border border-[var(--border-default)] p-6 sm:p-8"
          style={{
            background: "var(--gradient-surface)",
            backdropFilter: "var(--glass-blur)",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          {step === 0 && <WelcomeStep />}
          {step === 1 && <LearningPrefsStep prefs={prefs} onChange={updatePref} />}
          {step === 2 && (
            <InterestsStep
              interests={prefs.interests}
              onChange={(interests) => updatePref("interests", interests)}
            />
          )}
          {step === 3 && <ModeTourStep />}
          {step === 4 && <ReadyStep />}

          {/* Navigation */}
          <div className="mt-8 flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={() => setStep((s) => s - 1)}
              disabled={step === 0 || saving}
              className="cursor-pointer gap-1.5"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>

            <Button
              onClick={() => void handleNext()}
              disabled={!canAdvance() || saving}
              className="cursor-pointer gap-1.5"
              size="lg"
            >
              {saving ? (
                "Saving..."
              ) : step === TOTAL_STEPS - 1 ? (
                "Start Learning"
              ) : (
                <>
                  {step === 0 ? "Get Started" : "Continue"}
                  <ChevronRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Skip link */}
        {step < TOTAL_STEPS - 1 && (
          <p className="mt-4 text-center text-xs text-[var(--text-secondary)]">
            <button
              type="button"
              onClick={() => router.push("/")}
              className="cursor-pointer underline underline-offset-2 hover:text-[var(--text-primary)]"
            >
              Skip onboarding for now
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
