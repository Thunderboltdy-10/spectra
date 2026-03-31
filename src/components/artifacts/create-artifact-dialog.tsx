"use client";

import { useState } from "react";
import { ArrowLeft, X, Sparkles } from "lucide-react";
import { ARTIFACT_TYPE_META, type ArtifactType } from "@/lib/artifact-types";
import { cn } from "@/lib/utils";

/* ─── Template Definitions ────────────────────────────────────── */

type ArtifactTemplate = {
  id: string;
  label: string;
  description: string;
  content: unknown;
  contentPlaintext?: string;
};

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

function heading(level: number, text: string) {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
}
function paragraph(text = "") {
  if (!text) return { type: "paragraph" };
  return { type: "paragraph", content: [{ type: "text", text }] };
}
function bulletList(...items: string[]) {
  return {
    type: "bulletList",
    content: items.map((text) => ({
      type: "listItem",
      content: [paragraph(text)],
    })),
  };
}
function taskList(...items: string[]) {
  return {
    type: "taskList",
    content: items.map((text) => ({
      type: "taskItem",
      attrs: { checked: false },
      content: [paragraph(text)],
    })),
  };
}

const TEMPLATES: Partial<Record<ArtifactType, ArtifactTemplate[]>> = {
  document: [
    {
      id: "blank",
      label: "Blank Document",
      description: "Start from scratch",
      content: EMPTY_DOC,
    },
    {
      id: "essay",
      label: "Essay Outline",
      description: "Introduction, body, conclusion structure",
      content: {
        type: "doc",
        content: [
          heading(1, "Essay Title"),
          heading(2, "Introduction"),
          paragraph("Introduce your topic and state your thesis."),
          heading(2, "Body"),
          heading(3, "Point 1"),
          paragraph(""),
          heading(3, "Point 2"),
          paragraph(""),
          heading(3, "Point 3"),
          paragraph(""),
          heading(2, "Conclusion"),
          paragraph("Summarize your arguments and restate your thesis."),
          heading(2, "References"),
          bulletList("Source 1", "Source 2"),
        ],
      },
    },
    {
      id: "lab-report",
      label: "Lab Report",
      description: "Scientific report with standard sections",
      content: {
        type: "doc",
        content: [
          heading(1, "Lab Report"),
          heading(2, "Objective"),
          paragraph("State the purpose of the experiment."),
          heading(2, "Materials"),
          bulletList("Material 1", "Material 2"),
          heading(2, "Method"),
          paragraph("Describe the procedure step by step."),
          heading(2, "Results"),
          paragraph("Record your observations and data."),
          heading(2, "Analysis"),
          paragraph("Interpret the results."),
          heading(2, "Conclusion"),
          paragraph("Summarize findings and evaluate the experiment."),
        ],
      },
    },
    {
      id: "study-guide",
      label: "Study Guide",
      description: "Organized revision notes",
      content: {
        type: "doc",
        content: [
          heading(1, "Study Guide"),
          heading(2, "Key Concepts"),
          bulletList("Concept 1", "Concept 2", "Concept 3"),
          heading(2, "Important Definitions"),
          bulletList("Term: Definition", "Term: Definition"),
          heading(2, "Formulas & Rules"),
          paragraph(""),
          heading(2, "Practice Questions"),
          taskList("Question 1", "Question 2", "Question 3"),
          heading(2, "Review Checklist"),
          taskList("Reviewed notes", "Completed practice problems", "Made flashcards"),
        ],
      },
    },
    {
      id: "meeting-notes",
      label: "Meeting Notes",
      description: "Agenda, notes, and action items",
      content: {
        type: "doc",
        content: [
          heading(1, "Meeting Notes"),
          paragraph("Date: "),
          heading(2, "Agenda"),
          bulletList("Topic 1", "Topic 2"),
          heading(2, "Notes"),
          paragraph(""),
          heading(2, "Action Items"),
          taskList("Action 1", "Action 2"),
          heading(2, "Next Steps"),
          paragraph(""),
        ],
      },
    },
  ],
  note: [
    {
      id: "blank",
      label: "Blank Note",
      description: "Quick freeform note",
      content: EMPTY_DOC,
    },
    {
      id: "cornell",
      label: "Cornell Notes",
      description: "Cues, notes, and summary columns",
      content: {
        type: "doc",
        content: [
          heading(1, "Cornell Notes"),
          heading(2, "Topic"),
          paragraph(""),
          heading(2, "Key Questions / Cues"),
          bulletList("Question 1?", "Question 2?"),
          heading(2, "Notes"),
          paragraph("Write detailed notes here."),
          heading(2, "Summary"),
          paragraph("Summarize the main ideas in 2-3 sentences."),
        ],
      },
    },
  ],
  study_plan: [
    {
      id: "blank",
      label: "Blank Plan",
      description: "Start planning from scratch",
      content: { description: "", milestones: [] },
    },
    {
      id: "exam-prep",
      label: "Exam Prep",
      description: "Countdown study plan with daily goals",
      content: {
        description: "Structured exam preparation plan",
        milestones: [
          { id: "m1", title: "Review all notes and textbook chapters", done: false },
          { id: "m2", title: "Complete practice papers", done: false },
          { id: "m3", title: "Focus on weak topics", done: false },
          { id: "m4", title: "Final revision and rest", done: false },
        ],
      },
    },
  ],
  flashcard_deck: [
    {
      id: "blank",
      label: "Blank Deck",
      description: "Empty flashcard deck",
      content: { cards: [] },
    },
    {
      id: "vocabulary",
      label: "Vocabulary",
      description: "Term-definition card format",
      content: {
        cards: [
          { id: "c1", front: "Term 1", back: "Definition 1", difficulty: 0, nextReview: null },
          { id: "c2", front: "Term 2", back: "Definition 2", difficulty: 0, nextReview: null },
          { id: "c3", front: "Term 3", back: "Definition 3", difficulty: 0, nextReview: null },
        ],
      },
    },
  ],
  code_project: [
    {
      id: "blank",
      label: "Blank Project",
      description: "Empty code file",
      content: { language: "python", code: "" },
    },
    {
      id: "python",
      label: "Python Script",
      description: "Python with main guard",
      content: {
        language: "python",
        code: '#!/usr/bin/env python3\n"""Module description."""\n\n\ndef main():\n    pass\n\n\nif __name__ == "__main__":\n    main()\n',
      },
    },
  ],
};

/* ─── Creatable Types (subset users can manually create) ──────── */

const CREATABLE_TYPES: ArtifactType[] = [
  "document",
  "note",
  "study_plan",
  "flashcard_deck",
  "code_project",
  "diagram",
];

/* ─── Dialog Component ────────────────────────────────────────── */

export function CreateArtifactDialog({
  open,
  onClose,
  onCreate,
  defaultWorkstreamId,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (type: ArtifactType, title: string, tags: string[], template?: ArtifactTemplate) => void;
  defaultWorkstreamId?: string;
}) {
  const [selectedType, setSelectedType] = useState<ArtifactType | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<ArtifactTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [step, setStep] = useState<"type" | "template" | "details">("type");

  function reset() {
    setSelectedType(null);
    setSelectedTemplate(null);
    setTitle("");
    setTagsInput("");
    setStep("type");
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleTypeSelect(type: ArtifactType) {
    setSelectedType(type);
    const templates = TEMPLATES[type];
    if (templates && templates.length > 1) {
      setStep("template");
    } else {
      setSelectedTemplate(templates?.[0] ?? null);
      setStep("details");
    }
  }

  function handleTemplateSelect(template: ArtifactTemplate) {
    setSelectedTemplate(template);
    setStep("details");
  }

  function handleCreate() {
    if (!selectedType || !title.trim()) return;
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    onCreate(selectedType, title.trim(), tags, selectedTemplate ?? undefined);
    handleClose();
  }

  function handleBack() {
    if (step === "details") {
      const templates = selectedType ? TEMPLATES[selectedType] : undefined;
      if (templates && templates.length > 1) {
        setStep("template");
      } else {
        setStep("type");
      }
    } else if (step === "template") {
      setStep("type");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-soft)]">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-5 py-4">
          {step !== "type" && (
            <button
              type="button"
              className="rounded-lg p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors"
              onClick={handleBack}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <h2 className="flex-1 font-display text-lg font-semibold text-[var(--text-primary)]">
            {step === "type" && "Create New"}
            {step === "template" && selectedType && ARTIFACT_TYPE_META[selectedType].label}
            {step === "details" && "Details"}
          </h2>
          <button
            type="button"
            className="rounded-lg p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step 1: Type Selection */}
        {step === "type" && (
          <div className="p-5">
            <p className="mb-4 text-sm text-[var(--text-secondary)]">
              What would you like to create?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {CREATABLE_TYPES.map((type) => {
                const meta = ARTIFACT_TYPE_META[type];
                const Icon = meta.icon;
                return (
                  <button
                    key={type}
                    type="button"
                    className="group flex items-center gap-3 rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-left transition-all hover:border-[color-mix(in_oklab,var(--brand-primary)_40%,var(--border-default))] hover:shadow-[var(--shadow-card)] hover:scale-[1.01]"
                    onClick={() => handleTypeSelect(type)}
                  >
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] transition-transform group-hover:scale-105"
                      style={{
                        background: `color-mix(in oklab, ${meta.color} 12%, var(--bg-primary))`,
                        color: meta.color,
                      }}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--text-primary)]">
                        {meta.label}
                      </div>
                      <div className="truncate text-[10px] text-[var(--text-tertiary)]">
                        {meta.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 2: Template Selection */}
        {step === "template" && selectedType && (
          <div className="p-5">
            <p className="mb-4 text-sm text-[var(--text-secondary)]">
              Choose a starting template
            </p>
            <div className="space-y-2">
              {(TEMPLATES[selectedType] ?? []).map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="group w-full flex items-center gap-3 rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-left transition-all hover:border-[color-mix(in_oklab,var(--brand-primary)_40%,var(--border-default))] hover:shadow-[var(--shadow-card)]"
                  onClick={() => handleTemplateSelect(template)}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-secondary)]">
                    {template.id === "blank" ? (
                      <div className="h-3 w-3 rounded border-2 border-dashed border-[var(--text-tertiary)]" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 text-[var(--text-tertiary)] group-hover:text-[var(--brand-primary)] transition-colors" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      {template.label}
                    </div>
                    <div className="text-[10px] text-[var(--text-tertiary)]">
                      {template.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Details */}
        {step === "details" && selectedType && (
          <div className="p-5">
            <div className="mb-4 flex items-center gap-2">
              {(() => {
                const meta = ARTIFACT_TYPE_META[selectedType];
                const Icon = meta.icon;
                return (
                  <>
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-lg"
                      style={{
                        background: `color-mix(in oklab, ${meta.color} 12%, var(--bg-primary))`,
                        color: meta.color,
                      }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-sm font-medium text-[var(--text-secondary)]">
                      {meta.label}
                    </span>
                    {selectedTemplate && selectedTemplate.id !== "blank" && (
                      <span className="text-[10px] text-[var(--text-tertiary)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded-full">
                        {selectedTemplate.label}
                      </span>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter a title..."
                  className="w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--brand-primary)] focus:outline-none transition-colors"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                  }}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                  Tags <span className="font-normal text-[var(--text-tertiary)]">(optional)</span>
                </label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="physics, revision, chapter-3..."
                  className="w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--brand-primary)] focus:outline-none transition-colors"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-2.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                onClick={handleClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-[var(--radius-input)] px-4 py-2.5 text-sm font-medium text-white transition-all",
                  title.trim()
                    ? "bg-[var(--brand-primary)] hover:opacity-90 shadow-[0_2px_8px_-2px_rgba(14,142,232,0.3)]"
                    : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] cursor-not-allowed",
                )}
                disabled={!title.trim()}
                onClick={handleCreate}
              >
                Create
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { TEMPLATES };
export type { ArtifactTemplate };
