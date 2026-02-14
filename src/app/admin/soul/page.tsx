"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

type SoulDoc = {
  _id: string;
  title: string;
  section: string;
  content: string;
  version: number;
  publishedAt?: number;
  updatedAt: number;
};

type SoulSection = {
  section: string;
  title: string;
};

const SECTIONS: SoulSection[] = [
  { section: "tone_voice", title: "Tone & Voice" },
  { section: "academic_policies", title: "Academic Policies" },
  { section: "subject_guidelines", title: "Subject Guidelines" },
  { section: "misconceptions", title: "Misconceptions" },
  { section: "rubric_standards", title: "Rubric Standards" },
];

const STARTER_TEMPLATES: Record<string, string> = {
  tone_voice: [
    "Use concise, supportive language suitable for secondary students.",
    "Prioritize clarity over verbosity and avoid unnecessary jargon.",
    "Challenge gently: ask one follow-up question before giving full solutions in tutor mode.",
  ].join("\n"),
  academic_policies: [
    "Do not fabricate citations, facts, or external references.",
    "When uncertain, state uncertainty and request more context.",
    "Encourage academic integrity and original student reasoning.",
  ].join("\n"),
  subject_guidelines: [
    "Math/Science: emphasize units, assumptions, and step-by-step checks.",
    "Humanities: emphasize argument structure, evidence quality, and counterpoints.",
    "Language: emphasize grammar, clarity, and concise revision cycles.",
  ].join("\n"),
  misconceptions: [
    "Flag common misconceptions explicitly and correct them with brief examples.",
    "When a misconception is detected, give one micro-drill question for reinforcement.",
    "Do not proceed until the misconception is addressed clearly.",
  ].join("\n"),
  rubric_standards: [
    "Marker mode must include score band rationale and specific rubric alignment.",
    "Feedback must be actionable with concrete next improvements.",
    "Use confidence signals when evidence is incomplete.",
  ].join("\n"),
};

export default function SoulAdminPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [docs, setDocs] = useState<SoulDoc[]>([]);
  const [activeSection, setActiveSection] = useState(SECTIONS[0]!.section);
  const [title, setTitle] = useState(SECTIONS[0]!.title);
  const [content, setContent] = useState("");
  const [previewQuery, setPreviewQuery] = useState("How should the assistant mark a borderline answer?");
  const [previewBullets, setPreviewBullets] = useState<string[]>([]);

  async function loadDocs() {
    const response = await fetch("/api/admin/soul");
    if (!response.ok) throw new Error(await response.text());
    const data = (await response.json()) as { docs: SoulDoc[] };
    setDocs(data.docs ?? []);
  }

  async function loadPreview(query: string) {
    const response = await fetch(`/api/admin/soul?preview=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error(await response.text());
    const data = (await response.json()) as { preview?: { bullets?: string[] } };
    setPreviewBullets((data.preview?.bullets ?? []).slice(0, 10));
  }

  useEffect(() => {
    void (async () => {
      try {
        await loadDocs();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load soul docs");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const clean = previewQuery.trim();
    if (!clean) {
      setPreviewBullets([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadPreview(clean).catch(() => {});
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [previewQuery]);

  useEffect(() => {
    const section = SECTIONS.find((item) => item.section === activeSection);
    const existing = docs.find((doc) => doc.section === activeSection);
    setTitle(existing?.title ?? section?.title ?? "Untitled Section");
    setContent(existing?.content ?? "");
  }, [activeSection, docs]);

  const versions = useMemo(
    () => [...docs].sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0) || b.updatedAt - a.updatedAt),
    [docs],
  );

  async function saveSection() {
    if (!title.trim() || !content.trim()) {
      toast.error("Title and content are required");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/admin/soul", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          section: activeSection,
          content: content.trim(),
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      await loadDocs();
      await loadPreview(previewQuery);
      toast.success("Section saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save section");
    } finally {
      setSaving(false);
    }
  }

  async function publishSoul() {
    setPublishing(true);
    try {
      const response = await fetch("/api/admin/soul", {
        method: "PATCH",
      });
      if (!response.ok) throw new Error(await response.text());
      await loadDocs();
      await loadPreview(previewQuery);
      toast.success("Soul published");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to publish soul");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl text-[var(--text-primary)]">School Soul</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Teacher-controlled institutional guidance injected at runtime and hidden from students.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setContent((current) => (current.trim() ? current : STARTER_TEMPLATES[activeSection] ?? ""))}
              disabled={loading}
            >
              Auto-generate Starter
            </Button>
            <Button onClick={() => void saveSection()} disabled={saving || loading}>
              {saving ? "Saving..." : "Save Section"}
            </Button>
            <Button variant="secondary" onClick={() => void publishSoul()} disabled={publishing || loading}>
              {publishing ? "Publishing..." : "Publish"}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {SECTIONS.map((item) => (
                <button
                  key={item.section}
                  type="button"
                  onClick={() => setActiveSection(item.section)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    activeSection === item.section
                      ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-[var(--text-primary)]"
                      : "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  {item.title}
                </button>
              ))}
            </div>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-sm"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Section Content</span>
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                className="min-h-[320px] w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
                placeholder="Write internal guidance for this section..."
              />
            </label>
          </section>

          <section className="space-y-4">
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Injection Preview</h2>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void loadPreview(previewQuery)}
                  disabled={loading}
                >
                  Refresh
                </Button>
              </div>
              <label className="mb-3 block">
                <span className="mb-1 block text-xs text-[var(--text-secondary)]">Student query for preview</span>
                <input
                  value={previewQuery}
                  onChange={(event) => setPreviewQuery(event.target.value)}
                  className="h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-sm"
                />
              </label>
              <div className="space-y-2">
                {previewBullets.length === 0 ? (
                  <p className="text-xs text-[var(--text-secondary)]">No preview bullets yet.</p>
                ) : (
                  previewBullets.map((bullet, index) => (
                    <p key={`${bullet}-${index}`} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-2 text-xs text-[var(--text-primary)]">
                      {bullet}
                    </p>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
              <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Version History</h2>
              <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
                {versions.length === 0 ? (
                  <p className="text-xs text-[var(--text-secondary)]">No docs yet.</p>
                ) : (
                  versions.map((doc) => (
                    <div key={doc._id} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-2">
                      <p className="text-xs font-medium text-[var(--text-primary)]">{doc.title}</p>
                      <p className="text-[11px] text-[var(--text-secondary)]">
                        {doc.section} • v{doc.version} • {doc.publishedAt ? "published" : "draft"}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
