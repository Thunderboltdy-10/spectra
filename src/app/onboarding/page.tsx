"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  LayoutDashboard,
  PanelRight,
  Search,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/context/sidebar-context";
import {
  StepContainer,
  RadioCardGroup,
  ChipInput,
  ModeShowcase,
  LEARNING_STYLE_OPTIONS,
  DIFFICULTY_OPTIONS,
  COMMUNICATION_STYLE_OPTIONS,
} from "@/components/onboarding/steps";

const TOTAL_STEPS = 6;

type Prefs = {
  learningStyle: string;
  preferredDifficulty: string;
  communicationStyle: string;
  interests: string[];
};

const STEP_LABELS = [
  "Welcome",
  "Modes",
  "Navigation",
  "AI Features",
  "Preferences",
  "Shortcuts",
] as const;

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

function WelcomeStep({ orgName }: { orgName: string }) {
  return (
    <StepContainer className="text-center">
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
        Welcome to {orgName}
      </h1>
      <p className="mx-auto max-w-md text-base leading-relaxed text-[var(--text-secondary)]">
        You now have an AI study workspace built for your school. Let&apos;s quickly set up how you
        learn and show where everything lives.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          { emoji: "🎓", title: "Personalized", desc: "Adapts to your level and goals" },
          { emoji: "🧠", title: "Mode-based", desc: "Switch between Tutor, Quiz, Flashcards, and more" },
          { emoji: "⚡", title: "Fast workflow", desc: "Use keyboard shortcuts to move quickly" },
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

function ModesStep() {
  return (
    <StepContainer>
      <h2 className="mb-1 text-2xl font-bold text-[var(--text-primary)]">Choose the right mode</h2>
      <p className="mb-6 text-sm text-[var(--text-secondary)]">
        Learn is for explanation, Quiz is for active recall, Flashcards build memory, and Research
        adds evidence-backed sources.
      </p>
      <ModeShowcase />
    </StepContainer>
  );
}

function NavigationStep() {
  return (
    <StepContainer>
      <h2 className="mb-1 text-2xl font-bold text-[var(--text-primary)]">Navigate with confidence</h2>
      <p className="mb-6 text-sm text-[var(--text-secondary)]">
        Your workspace is designed for fast movement between chats, tools, and context panels.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <LayoutDashboard className="mb-2 h-5 w-5 text-[var(--accent-cyan)]" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Sidebar</p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Open pages, revisit recent chats, and jump between study tools.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <Search className="mb-2 h-5 w-5 text-[var(--accent-coral)]" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Command palette</p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Press Cmd/Ctrl + K to search routes and trigger quick actions.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <PanelRight className="mb-2 h-5 w-5 text-[var(--success)]" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Side panels</p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Open settings, route traces, and source details without leaving chat.
          </p>
        </div>
      </div>
    </StepContainer>
  );
}

function AIFeaturesStep() {
  return (
    <StepContainer>
      <h2 className="mb-1 text-2xl font-bold text-[var(--text-primary)]">How AI responses are built</h2>
      <p className="mb-6 text-sm text-[var(--text-secondary)]">
        Under the hood, the assistant can route between models, tools, and reasoning modes to fit
        your prompt.
      </p>

      <div className="space-y-3">
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--accent-cyan)_14%,transparent)] text-[var(--accent-cyan)]">
            <WandSparkles className="h-4 w-4" />
          </div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">Auto mode selection</p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            If you leave mode on Auto, the system chooses the best mode for each message.
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--accent-coral)_14%,transparent)] text-[var(--accent-coral)]">
            <Brain className="h-4 w-4" />
          </div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">Orchestration + reasoning</p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Complex prompts can trigger multi-step reasoning and tool-assisted synthesis.
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--success)_14%,transparent)] text-[var(--success)]">
            <Sparkles className="h-4 w-4" />
          </div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">Thinking levels</p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Low for speed, medium for balance, high for deeper analysis and harder tasks.
          </p>
        </div>
      </div>
    </StepContainer>
  );
}

type PreferencesStepProps = {
  prefs: Prefs;
  onChange: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
};

function PreferencesStep({ prefs, onChange }: PreferencesStepProps) {
  return (
    <StepContainer>
      <h2 className="mb-1 text-2xl font-bold text-[var(--text-primary)]">Set your preferences</h2>
      <p className="mb-6 text-sm text-[var(--text-secondary)]">
        We&apos;ll save these and personalize future responses to your style.
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
            Difficulty Preference
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

        <div>
          <label className="mb-3 block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
            Interests
          </label>
          <ChipInput
            chips={prefs.interests}
            onChange={(value) => onChange("interests", value)}
            placeholder="e.g. Calculus, Ancient Rome, Machine Learning..."
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTED_INTERESTS.filter((suggestion) => !prefs.interests.includes(suggestion)).map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onChange("interests", [...prefs.interests, suggestion])}
                className="cursor-pointer rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-cyan)] hover:bg-[color-mix(in_oklab,var(--accent-cyan)_8%,var(--bg-elevated))] hover:text-[var(--text-primary)]"
              >
                + {suggestion}
              </button>
            ))}
          </div>
        </div>
      </div>
    </StepContainer>
  );
}

function ShortcutsStep() {
  return (
    <StepContainer className="text-center">
      <div className="confetti-pop mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--success)_18%,var(--bg-elevated))]">
        <CheckCircle2 className="h-12 w-12 text-[var(--success)]" />
      </div>

      <h2 className="font-display mb-2 text-3xl font-bold text-[var(--text-primary)]">You&apos;re ready</h2>
      <p className="mx-auto mb-7 max-w-md text-base leading-relaxed text-[var(--text-secondary)]">
        Your onboarding setup is complete. Keep these shortcuts handy to move faster while studying.
      </p>

      <div className="mx-auto grid max-w-lg gap-3 text-left">
        {[ 
          { icon: <Search className="h-4 w-4" />, combo: "Cmd/Ctrl + K", text: "Open command palette" },
          { icon: <Keyboard className="h-4 w-4" />, combo: "Esc", text: "Close active panel or modal" },
          { icon: <WandSparkles className="h-4 w-4" />, combo: "Mode selector", text: "Switch between Tutor, Quiz, Flashcards, and more" },
        ].map((shortcut) => (
          <div
            key={shortcut.combo}
            className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3"
          >
            <span className="text-[var(--accent-cyan)]">{shortcut.icon}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--text-primary)]">{shortcut.text}</p>
              <p className="text-xs text-[var(--text-secondary)]">{shortcut.combo}</p>
            </div>
          </div>
        ))}
      </div>
    </StepContainer>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const { orgName } = useSidebar();

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
    if (step === 4) {
      return Boolean(prefs.learningStyle && prefs.preferredDifficulty);
    }
    return true;
  }

  async function handleNext() {
    if (step < TOTAL_STEPS - 1) {
      setStep((s) => s + 1);
      return;
    }

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

      toast.success("Onboarding complete. Let’s start learning.");
      router.push("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save preferences");
    } finally {
      setSaving(false);
    }
  }

  const stepLabel = STEP_LABELS[step] ?? "Onboarding";

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
      <div className="w-full max-w-3xl">
        <div className="mb-8 text-center">
          <ProgressDots current={step} total={TOTAL_STEPS} />
          <p className="mt-3 text-xs font-medium uppercase tracking-widest text-[var(--text-secondary)]">
            Step {step + 1} of {TOTAL_STEPS} &mdash; {stepLabel}
          </p>
        </div>

        <div
          className="rounded-2xl border border-[var(--border-default)] p-6 sm:p-8"
          style={{
            background: "var(--gradient-surface)",
            backdropFilter: "var(--glass-blur)",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          {step === 0 && <WelcomeStep orgName={orgName || "AI School"} />}
          {step === 1 && <ModesStep />}
          {step === 2 && <NavigationStep />}
          {step === 3 && <AIFeaturesStep />}
          {step === 4 && <PreferencesStep prefs={prefs} onChange={updatePref} />}
          {step === 5 && <ShortcutsStep />}

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
                  Continue
                  <ChevronRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>

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
