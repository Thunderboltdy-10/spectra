"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Visibility = "public" | "private";
type BuilderMode = "assisted" | "manual";

export type AgentEditValues = {
  name: string;
  description: string;
  category: string;
  systemPrompt: string;
  avatarEmoji?: string;
  visibility: Visibility;
};

type AgentEditFormProps = {
  submitLabel: string;
  initialValues?: Partial<AgentEditValues>;
  onSubmit: (values: AgentEditValues) => Promise<void>;
  onCancelHref?: string;
};

function buildPromptFromAssisted(input: {
  name: string;
  purpose: string;
  audience: string;
  success: string;
  boundaries: string;
  responseStyle: string;
}) {
  return `You are ${input.name}, an educational AI agent for ${input.audience}.

Primary purpose:
- ${input.purpose}

Success criteria for each response:
- ${input.success}

Instructional behavior:
- Start by clarifying the learner's goal and level.
- Use concise step-by-step support with checks for understanding.
- If the learner asks for direct answers too early, provide guided hints first.
- Keep outputs structured and classroom-appropriate.

Boundaries and safety:
- ${input.boundaries}

Response style:
- ${input.responseStyle}
- Use headings and compact bullet points when helpful.
- End with one concrete next step for the student.`;
}

export function AgentEditForm({
  submitLabel,
  initialValues,
  onSubmit,
  onCancelHref = "/agents",
}: AgentEditFormProps) {
  const [mode, setMode] = useState<BuilderMode>(initialValues?.systemPrompt ? "manual" : "assisted");
  const [submitting, setSubmitting] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);

  const [name, setName] = useState(initialValues?.name ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [category, setCategory] = useState(initialValues?.category ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initialValues?.systemPrompt ?? "");
  const [avatarEmoji, setAvatarEmoji] = useState(initialValues?.avatarEmoji ?? "");
  const [visibility, setVisibility] = useState<Visibility>(initialValues?.visibility ?? "public");

  const [purpose, setPurpose] = useState("");
  const [audience, setAudience] = useState("secondary school students");
  const [success, setSuccess] = useState("The learner can apply the concept independently in a similar problem.");
  const [boundaries, setBoundaries] = useState(
    "Do not fabricate sources or facts. If uncertain, state limits and ask for context.",
  );
  const [responseStyle, setResponseStyle] = useState(
    "Clear, supportive, and academically precise with short examples.",
  );

  const generatedPreview = useMemo(
    () =>
      buildPromptFromAssisted({
        name: name || "this agent",
        purpose: purpose || "Support student learning goals.",
        audience,
        success,
        boundaries,
        responseStyle,
      }),
    [audience, boundaries, name, purpose, responseStyle, success],
  );

  async function handleGeneratePromptWithAI() {
    if (!name.trim() || !description.trim() || !category.trim()) {
      toast.error("Add name, description, and category first.");
      return;
    }

    setGeneratingPrompt(true);
    try {
      const response = await fetch("/api/agents/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          category: category.trim(),
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data = (await response.json()) as { prompt?: string };
      if (!data.prompt?.trim()) {
        throw new Error("Prompt generation returned empty output.");
      }
      setSystemPrompt(data.prompt.trim());
      toast.success("System prompt generated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to generate system prompt");
    } finally {
      setGeneratingPrompt(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const cleanName = name.trim();
    const cleanDescription = description.trim();
    const cleanCategory = category.trim();
    const cleanEmoji = avatarEmoji.trim();

    if (!cleanName || !cleanDescription || !cleanCategory) {
      toast.error("Name, description, and category are required.");
      return;
    }

    let finalPrompt = systemPrompt.trim();
    if (mode === "assisted") {
      if (!purpose.trim() || !audience.trim() || !success.trim() || !boundaries.trim() || !responseStyle.trim()) {
        toast.error("Complete all assisted-creation questions.");
        return;
      }
      finalPrompt = generatedPreview.trim();
    }

    if (!finalPrompt) {
      toast.error("System prompt is required.");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name: cleanName,
        description: cleanDescription,
        category: cleanCategory,
        systemPrompt: finalPrompt,
        avatarEmoji: cleanEmoji || undefined,
        visibility,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save agent");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("assisted")}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
              mode === "assisted"
                ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]"
                : "border-[var(--border-default)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <p className="font-medium text-[var(--text-primary)]">Assisted creation</p>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Guided questionnaire, no AI generation required.
            </p>
          </button>
          <button
            type="button"
            onClick={() => setMode("manual")}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
              mode === "manual"
                ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]"
                : "border-[var(--border-default)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <p className="font-medium text-[var(--text-primary)]">Manual setup</p>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Write your own system prompt and fine-tune behavior.
            </p>
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">Name</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Physics Coach" />
        </label>

        <label className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">Category</span>
          <Input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Science" />
        </label>
      </div>

      <label className="space-y-1">
        <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">Description</span>
        <Textarea
          className="min-h-[92px] resize-none font-inherit"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What this agent helps with and for whom."
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            Avatar (optional)
          </span>
          <Input
            value={avatarEmoji}
            onChange={(event) => setAvatarEmoji(event.target.value)}
            maxLength={12}
            placeholder="e.g. 🎓 or PG"
          />
          <p className="pt-1 text-[11px] text-[var(--text-secondary)]">
            Use any emoji or short initials. Preconfigured emoji presets were removed.
          </p>
        </label>

        <label className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">Visibility</span>
          <select
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as Visibility)}
            className="h-10 w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-sm"
          >
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </label>
      </div>

      {mode === "assisted" ? (
        <section className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Assisted brief (required)</h3>

          <label className="space-y-1">
            <span className="text-xs text-[var(--text-secondary)]">What is this agent for?</span>
            <Textarea
              className="min-h-[84px] resize-none font-inherit"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              placeholder="Example: Help students reason through GCSE math proofs with guided hints."
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-[var(--text-secondary)]">Who is the audience?</span>
            <Input value={audience} onChange={(event) => setAudience(event.target.value)} />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-[var(--text-secondary)]">How do we define a successful response?</span>
            <Textarea
              className="min-h-[78px] resize-none font-inherit"
              value={success}
              onChange={(event) => setSuccess(event.target.value)}
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-[var(--text-secondary)]">What boundaries must it follow?</span>
            <Textarea
              className="min-h-[78px] resize-none font-inherit"
              value={boundaries}
              onChange={(event) => setBoundaries(event.target.value)}
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-[var(--text-secondary)]">Preferred response style</span>
            <Textarea
              className="min-h-[78px] resize-none font-inherit"
              value={responseStyle}
              onChange={(event) => setResponseStyle(event.target.value)}
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-[var(--text-secondary)]">Generated system prompt preview</span>
            <Textarea readOnly className="min-h-[180px] resize-none font-inherit" value={generatedPreview} />
          </label>
        </section>
      ) : (
        <section className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">System prompt</h3>
              <p className="text-xs text-[var(--text-secondary)]">
                The system prompt is the hidden instruction set that defines the agent&apos;s behavior and limits.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="gap-1.5"
              onClick={handleGeneratePromptWithAI}
              disabled={generatingPrompt}
            >
              {generatingPrompt ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Generate with AI
            </Button>
          </div>

          <Textarea
            className="min-h-[220px] resize-none font-inherit"
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
            placeholder="Define persona, teaching strategy, boundaries, and response format."
          />
        </section>
      )}

      <div className="flex items-center justify-between pt-1">
        <Button type="button" variant="ghost" asChild>
          <Link href={onCancelHref}>Exit</Link>
        </Button>
        <Button type="submit" disabled={submitting} className="gap-1.5">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
