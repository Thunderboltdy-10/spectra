"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  RadioCardGroup,
  ChipInput,
  LEARNING_STYLE_OPTIONS,
  DIFFICULTY_OPTIONS,
  COMMUNICATION_STYLE_OPTIONS,
} from "@/components/onboarding/steps";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Preferences = {
  learningStyle: string;
  preferredDifficulty: string;
  communicationStyle: string;
  interests: string[];
  weakAreas: string[];
  customGuidance: string;
};

type SectionLabelProps = {
  children: React.ReactNode;
};

// ---------------------------------------------------------------------------
// Section Label helper
// ---------------------------------------------------------------------------

function SectionLabel({ children }: SectionLabelProps) {
  return (
    <label className="mb-3 block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// PersonalPreferences
// ---------------------------------------------------------------------------

export function PersonalPreferences() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>({
    learningStyle: "",
    preferredDifficulty: "",
    communicationStyle: "",
    interests: [],
    weakAreas: [],
    customGuidance: "",
  });

  // Load on mount
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/personal-soul");
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as {
        prefs: {
          learningStyle?: string;
          preferredDifficulty?: string;
          communicationStyle?: string;
          interests?: string[];
          weakAreas?: string[];
          customGuidance?: string;
        } | null;
      };
      if (data.prefs) {
        setPrefs({
          learningStyle: data.prefs.learningStyle ?? "",
          preferredDifficulty: data.prefs.preferredDifficulty ?? "",
          communicationStyle: data.prefs.communicationStyle ?? "",
          interests: data.prefs.interests ?? [],
          weakAreas: data.prefs.weakAreas ?? [],
          customGuidance: data.prefs.customGuidance ?? "",
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load preferences");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const response = await fetch("/api/personal-soul", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          learningStyle: prefs.learningStyle || undefined,
          preferredDifficulty: prefs.preferredDifficulty || undefined,
          communicationStyle: prefs.communicationStyle || undefined,
          interests: prefs.interests.length > 0 ? prefs.interests : undefined,
          weakAreas: prefs.weakAreas.length > 0 ? prefs.weakAreas : undefined,
          customGuidance: prefs.customGuidance.trim() || undefined,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      toast.success("Preferences saved — the AI will adapt to your style.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save preferences");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[280px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--text-secondary)]" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Learning Style */}
      <section>
        <h3 className="mb-1 text-base font-semibold text-[var(--text-primary)]">Learning Style</h3>
        <p className="mb-4 text-sm text-[var(--text-secondary)]">
          How do you prefer to take in new information?
        </p>
        <RadioCardGroup
          options={LEARNING_STYLE_OPTIONS}
          value={prefs.learningStyle}
          onChange={(value) => update("learningStyle", value)}
        />
      </section>

      <hr className="border-[var(--border-default)]" />

      {/* Preferred Difficulty */}
      <section>
        <h3 className="mb-1 text-base font-semibold text-[var(--text-primary)]">
          Preferred Difficulty
        </h3>
        <p className="mb-4 text-sm text-[var(--text-secondary)]">
          How challenging should explanations and exercises be?
        </p>
        <RadioCardGroup
          options={DIFFICULTY_OPTIONS}
          value={prefs.preferredDifficulty}
          onChange={(value) => update("preferredDifficulty", value)}
        />
      </section>

      <hr className="border-[var(--border-default)]" />

      {/* Communication Style */}
      <section>
        <h3 className="mb-1 text-base font-semibold text-[var(--text-primary)]">
          Communication Style
        </h3>
        <p className="mb-4 text-sm text-[var(--text-secondary)]">
          How should the AI structure its responses to you?
        </p>
        <RadioCardGroup
          options={COMMUNICATION_STYLE_OPTIONS}
          value={prefs.communicationStyle}
          onChange={(value) => update("communicationStyle", value)}
        />
      </section>

      <hr className="border-[var(--border-default)]" />

      {/* Interests */}
      <section>
        <h3 className="mb-1 text-base font-semibold text-[var(--text-primary)]">Interests</h3>
        <p className="mb-4 text-sm text-[var(--text-secondary)]">
          Topics you&apos;re studying or passionate about. The AI will use these for context.
        </p>
        <SectionLabel>Your Interests</SectionLabel>
        <ChipInput
          chips={prefs.interests}
          onChange={(chips) => update("interests", chips)}
          placeholder="e.g. Calculus, World War II, Machine Learning..."
        />
      </section>

      <hr className="border-[var(--border-default)]" />

      {/* Weak Areas */}
      <section>
        <h3 className="mb-1 text-base font-semibold text-[var(--text-primary)]">Weak Areas</h3>
        <p className="mb-4 text-sm text-[var(--text-secondary)]">
          Topics you struggle with. The AI will offer extra support and be more patient here.
        </p>
        <SectionLabel>Topics to improve</SectionLabel>
        <ChipInput
          chips={prefs.weakAreas}
          onChange={(chips) => update("weakAreas", chips)}
          placeholder="e.g. Integration by parts, Essay structure..."
        />
      </section>

      <hr className="border-[var(--border-default)]" />

      {/* Custom Notes */}
      <section>
        <h3 className="mb-1 text-base font-semibold text-[var(--text-primary)]">Custom Notes</h3>
        <p className="mb-4 text-sm text-[var(--text-secondary)]">
          Anything else the AI should know about you — study goals, exam dates, preferred examples,
          etc.
        </p>
        <SectionLabel>Additional guidance</SectionLabel>
        <textarea
          value={prefs.customGuidance}
          onChange={(event) => update("customGuidance", event.target.value)}
          placeholder="e.g. I'm preparing for the IB exam in May. I prefer examples from sports science. Please always check my working..."
          rows={4}
          className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-none transition-colors focus:border-[var(--accent-cyan)] focus:shadow-[0_0_0_2px_color-mix(in_oklab,var(--accent-cyan)_25%,transparent)] resize-none"
        />
        <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
          {prefs.customGuidance.length} / 1000 characters
        </p>
      </section>

      {/* Save button */}
      <div className="flex justify-end pt-2">
        <Button
          onClick={() => void handleSave()}
          disabled={saving}
          className="cursor-pointer gap-2"
          size="lg"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save Preferences
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
