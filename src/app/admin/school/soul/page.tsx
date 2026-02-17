"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  Heart,
  Lightbulb,
  FlaskConical,
  FileText,
  Sparkles,
  Send,
  RefreshCw,
  Upload,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  icon: React.ReactNode;
  description: string;
  placeholder: string;
};

// ---------------------------------------------------------------------------
// Sections configuration
// ---------------------------------------------------------------------------

const SECTIONS: SoulSection[] = [
  {
    section: "values_mission",
    title: "Values & Mission",
    icon: <Heart className="h-4 w-4" />,
    description:
      "Define the core values and educational mission that shape every AI interaction at your school.",
    placeholder: `Example:
Our school believes every student deserves patient, non-judgmental support.
We value academic integrity, curiosity, and growth mindset.
The AI should encourage effort over innate ability, and celebrate mistakes as learning opportunities.`,
  },
  {
    section: "teaching_philosophy",
    title: "Teaching Philosophy",
    icon: <Lightbulb className="h-4 w-4" />,
    description:
      "Describe your pedagogical approach — Socratic, inquiry-based, Bloom's taxonomy alignment, etc.",
    placeholder: `Example:
Use the Socratic method: guide students with questions rather than giving direct answers.
Align feedback to Bloom's taxonomy levels.
Prioritize conceptual understanding before procedural fluency.`,
  },
  {
    section: "subject_guidelines",
    title: "Subject Guidelines",
    icon: <BookOpen className="h-4 w-4" />,
    description: "Subject-specific instructions: notation standards, preferred methods, rubrics.",
    placeholder: `Example:
Mathematics: always show working step by step, emphasize units and significant figures.
Science: distinguish theory from experimental evidence.
Humanities: require evidence-based arguments with source evaluation.`,
  },
  {
    section: "tone_voice",
    title: "Tone & Voice",
    icon: <FileText className="h-4 w-4" />,
    description: "Set the communication register: formal/informal, encouraging, concise, etc.",
    placeholder: `Example:
Use warm but professional language suitable for secondary students.
Avoid jargon unless introducing it explicitly.
Always close tutor responses with a reflective question.`,
  },
  {
    section: "academic_policies",
    title: "Academic Policies",
    icon: <FlaskConical className="h-4 w-4" />,
    description: "Academic integrity rules, citation standards, what the AI should refuse.",
    placeholder: `Example:
Never write essays or assignments on behalf of students.
Always encourage students to cite sources.
Flag plagiarism risks and redirect to originality.`,
  },
];

const STARTER_TEMPLATES: Record<string, string> = {
  values_mission: [
    "Our school believes in student-centered learning where every voice matters.",
    "We value intellectual curiosity, resilience, and academic integrity above all.",
    "The AI should model empathy, celebrate effort, and never shame mistakes.",
  ].join("\n"),
  teaching_philosophy: [
    "Use guided discovery over direct instruction wherever possible.",
    "Ask one targeted question before giving a full solution in tutor mode.",
    "Align all feedback to Bloom's revised taxonomy — remember, understand, apply, analyze, evaluate, create.",
  ].join("\n"),
  subject_guidelines: [
    "Math/Science: show all working, emphasize units and assumptions.",
    "Humanities: prioritize argument structure, evidence quality, and counterarguments.",
    "Languages: focus on grammar patterns, clarity, and concise revision cycles.",
  ].join("\n"),
  tone_voice: [
    "Use concise, supportive language suitable for secondary students (ages 14–18).",
    "Prioritize clarity over verbosity; avoid unnecessary jargon.",
    "End every tutoring response with a reflective follow-up question.",
  ].join("\n"),
  academic_policies: [
    "Do not write essays, coursework, or assignments on behalf of students.",
    "When uncertain about facts, state uncertainty explicitly.",
    "Encourage original reasoning and flag AI-generated content risks.",
  ].join("\n"),
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function SchoolSoulPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [docs, setDocs] = useState<SoulDoc[]>([]);
  const [activeSection, setActiveSection] = useState(SECTIONS[0]!.section);
  const [title, setTitle] = useState(SECTIONS[0]!.title);
  const [content, setContent] = useState("");

  // Test SOUL panel
  const [testQuery, setTestQuery] = useState(
    "A student just submitted a history essay with no sources. How should the AI respond?",
  );
  const [testBullets, setTestBullets] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);

  // Active section config
  const activeSectionConfig = SECTIONS.find((s) => s.section === activeSection)!;

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  async function loadDocs() {
    const response = await fetch("/api/admin/soul");
    if (!response.ok) throw new Error(await response.text());
    const data = (await response.json()) as { docs: SoulDoc[] };
    setDocs(data.docs ?? []);
  }

  async function runTest(query: string) {
    if (!query.trim()) return;
    setTesting(true);
    try {
      const response = await fetch(`/api/admin/soul?preview=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as { preview?: { bullets?: string[] } };
      setTestBullets((data.preview?.bullets ?? []).slice(0, 10));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Test failed");
    } finally {
      setTesting(false);
    }
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

  // Sync editor when section changes
  useEffect(() => {
    const section = SECTIONS.find((item) => item.section === activeSection);
    const existing = docs.find((doc) => doc.section === activeSection);
    setTitle(existing?.title ?? section?.title ?? "Untitled");
    setContent(existing?.content ?? "");
  }, [activeSection, docs]);

  const versions = useMemo(
    () =>
      [...docs].sort(
        (a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0) || b.updatedAt - a.updatedAt,
      ),
    [docs],
  );

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

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
      toast.success(`"${title}" saved successfully`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save section");
    } finally {
      setSaving(false);
    }
  }

  async function seedAllSections() {
    setSeeding(true);
    try {
      const existingBySection = new Map(docs.map((doc) => [doc.section, doc]));
      const tasks = SECTIONS
        .map((section) => {
          const existing = existingBySection.get(section.section);
          if (existing?.content?.trim()) {
            return null;
          }
          const starter = (STARTER_TEMPLATES[section.section] ?? "").trim();
          if (!starter) return null;
          return fetch("/api/admin/soul", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: existing?.title?.trim() || section.title,
              section: section.section,
              content: starter,
            }),
          });
        })
        .filter(Boolean) as Promise<Response>[];

      if (tasks.length === 0) {
        toast.info("All sections already have content");
        return;
      }

      const responses = await Promise.all(tasks);
      const failed = responses.find((response) => !response.ok);
      if (failed) {
        throw new Error(await failed.text());
      }

      await loadDocs();
      toast.success(`Added starter content to ${tasks.length} section${tasks.length === 1 ? "" : "s"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to seed SOUL sections");
    } finally {
      setSeeding(false);
    }
  }

  async function publishSoul() {
    setPublishing(true);
    try {
      const response = await fetch("/api/admin/soul", { method: "PATCH" });
      if (!response.ok) throw new Error(await response.text());
      await loadDocs();
      toast.success("School SOUL published — AI will use these guidelines immediately");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to publish soul");
    } finally {
      setPublishing(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ background: "var(--gradient-brand)" }}
              >
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <h1 className="font-display text-3xl text-[var(--text-primary)]">School SOUL</h1>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              Institutional AI guidance — hidden from students, injected at runtime into every
              interaction.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                setContent((current) =>
                  current.trim() ? current : (STARTER_TEMPLATES[activeSection] ?? ""),
                )
              }
              disabled={loading}
              className="cursor-pointer gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Auto-generate Starter
            </Button>
            <Button
              variant="secondary"
              onClick={() => void seedAllSections()}
              disabled={seeding || loading}
              className="cursor-pointer gap-1.5"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {seeding ? "Preparing..." : "Quick Setup All"}
            </Button>
            <Button
              onClick={() => void saveSection()}
              disabled={saving || loading}
              className="cursor-pointer gap-1.5"
            >
              {saving ? "Saving..." : "Save Section"}
            </Button>
            <Button
              onClick={() => void publishSoul()}
              disabled={publishing || loading}
              className="cursor-pointer gap-1.5"
              style={{ background: "var(--gradient-brand)" }}
            >
              <Upload className="h-3.5 w-3.5" />
              {publishing ? "Publishing..." : "Publish SOUL"}
            </Button>
          </div>
        </div>

        {/* Section Nav Pills */}
        <div className="flex flex-wrap gap-2">
          {SECTIONS.map((item) => {
            const hasContent = docs.some((d) => d.section === item.section && d.content.trim());
            const isActive = activeSection === item.section;
            return (
              <button
                key={item.section}
                type="button"
                onClick={() => setActiveSection(item.section)}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-150 ${
                  isActive
                    ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_14%,transparent)] text-[var(--text-primary)] shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent-cyan)_30%,transparent)]"
                    : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                <span className={isActive ? "text-[var(--accent-cyan)]" : ""}>{item.icon}</span>
                {item.title}
                {hasContent && (
                  <CheckCircle2
                    className={`h-3 w-3 ${isActive ? "text-[var(--accent-cyan)]" : "text-[var(--success)]"}`}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Main grid */}
        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          {/* Left: Editor */}
          <div className="space-y-4">
            {/* Section info card */}
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5">
              <div className="mb-4 flex items-start gap-3">
                <div
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
                  style={{
                    background:
                      "color-mix(in oklab, var(--accent-cyan) 14%, var(--bg-secondary))",
                    color: "var(--accent-cyan)",
                  }}
                >
                  {activeSectionConfig.icon}
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                    {activeSectionConfig.title}
                  </h2>
                  <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                    {activeSectionConfig.description}
                  </p>
                </div>
              </div>

              <label className="mb-3 block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                  Section Title
                </span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-cyan)]"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                  Guidance Content
                </span>
                <textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder={activeSectionConfig.placeholder}
                  className="min-h-[320px] w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-none transition-colors focus:border-[var(--accent-cyan)] resize-none leading-relaxed"
                />
              </label>

              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-[var(--text-secondary)]">
                  {content.length} characters
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setContent(STARTER_TEMPLATES[activeSection] ?? "")
                  }
                  className="cursor-pointer text-xs text-[var(--accent-cyan)] underline underline-offset-2 hover:opacity-80"
                >
                  Load starter template
                </button>
              </div>
            </div>
          </div>

          {/* Right: Test panel + Version history */}
          <div className="space-y-4">
            {/* Test SOUL panel */}
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5">
              <div className="mb-3 flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-[var(--accent-cyan)]" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Test This SOUL
                </h2>
              </div>
              <p className="mb-3 text-xs text-[var(--text-secondary)]">
                Enter a sample student query and see how the published SOUL shapes the AI&apos;s
                injected guidelines.
              </p>

              <div className="mb-3">
                <label className="mb-1.5 block text-xs text-[var(--text-secondary)]">
                  Sample student query
                </label>
                <div className="flex gap-2">
                  <input
                    value={testQuery}
                    onChange={(event) => setTestQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void runTest(testQuery);
                    }}
                    className="h-9 flex-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-cyan)]"
                  />
                  <Button
                    size="sm"
                    onClick={() => void runTest(testQuery)}
                    disabled={testing || !testQuery.trim()}
                    className="cursor-pointer flex-shrink-0 gap-1"
                  >
                    {testing ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    {testing ? "Testing..." : "Test"}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {testBullets.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--border-default)] px-4 py-6 text-center">
                    <p className="text-xs text-[var(--text-secondary)]">
                      Click &quot;Test&quot; to preview how the SOUL guidance would be injected for this
                      query.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs font-medium text-[var(--text-secondary)]">
                      Injected guidelines ({testBullets.length}):
                    </p>
                    {testBullets.map((bullet, index) => (
                      <div
                        key={`${bullet}-${index}`}
                        className="flex items-start gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5"
                      >
                        <ChevronRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--accent-cyan)]" />
                        <p className="text-xs leading-relaxed text-[var(--text-primary)]">
                          {bullet}
                        </p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* Version History */}
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5">
              <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
                Version History
              </h2>
              <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
                {versions.length === 0 ? (
                  <p className="text-xs text-[var(--text-secondary)]">
                    No sections saved yet. Start writing and save a section above.
                  </p>
                ) : (
                  versions.map((doc) => (
                    <div
                      key={doc._id}
                      className="group rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-[var(--text-primary)]">
                            {doc.title}
                          </p>
                          <p className="text-[11px] text-[var(--text-secondary)]">
                            {SECTIONS.find((s) => s.section === doc.section)?.title ??
                              doc.section}{" "}
                            &bull; v{doc.version}
                          </p>
                        </div>
                        <span
                          className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            doc.publishedAt
                              ? "bg-[color-mix(in_oklab,var(--success)_14%,transparent)] text-[var(--success)]"
                              : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                          }`}
                        >
                          {doc.publishedAt ? "published" : "draft"}
                        </span>
                      </div>
                      {doc.publishedAt && (
                        <p className="mt-1 text-[10px] text-[var(--text-secondary)]">
                          Published{" "}
                          {new Date(doc.publishedAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Publish CTA */}
            <div
              className="rounded-2xl border border-[var(--border-default)] p-5"
              style={{
                background: "color-mix(in oklab, var(--accent-cyan) 6%, var(--bg-elevated))",
              }}
            >
              <div className="mb-2 flex items-center gap-2">
                <Upload className="h-4 w-4 text-[var(--accent-cyan)]" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Ready to go live?
                </h3>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                Save all your sections first, then publish. The AI will begin using your SOUL
                guidelines on the next student interaction.
              </p>
              <Button
                onClick={() => void publishSoul()}
                disabled={publishing || loading || docs.length === 0}
                className="w-full cursor-pointer gap-1.5"
                style={{ background: "var(--gradient-brand)" }}
              >
                <Upload className="h-3.5 w-3.5" />
                {publishing ? "Publishing..." : "Publish School SOUL"}
              </Button>
              {docs.length === 0 && (
                <p className="mt-2 text-center text-xs text-[var(--text-secondary)]">
                  Save at least one section to enable publishing.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
