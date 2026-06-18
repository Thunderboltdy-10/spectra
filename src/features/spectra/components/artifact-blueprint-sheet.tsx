"use client";

import {
  BookOpen,
  CalendarCheck2,
  CheckCircle2,
  FileText,
  HelpCircle,
  Loader2,
  MessageSquare,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { blueprintMeta, type ArtifactCardView } from "./artifact-card";
import type { SpectraArtifact, SpectraBlueprintKey } from "../data/api";

type EditableBlueprintKey = SpectraBlueprintKey;
type SheetMode = "create" | "edit";

export type ArtifactPayload = {
  blueprintKey: EditableBlueprintKey;
  title: string;
  summary?: string;
  content: unknown;
  tags?: string[];
};

type DocumentBlock = { id: string; type?: string; text?: string };
type DeckCard = { id: string; front: string; back: string; hint?: string; confidence?: "unknown" | "weak" | "medium" | "strong" };
type QuizQuestion = {
  id: string;
  prompt: string;
  type?: "multiple_choice" | "short_answer";
  options?: string[];
  correctAnswer?: string;
  explanation?: string;
  difficulty?: "easy" | "medium" | "hard";
};
type PlannerTaskContent = {
  description?: string;
  dueAt?: number;
  status?: "todo" | "doing" | "done";
  priority?: "low" | "medium" | "high";
};
type ThreadReferenceContent = {
  threadId?: string | null;
  summary?: string;
  linkedArtifactIds?: string[];
};

export const blueprintChoices: Array<{ key: EditableBlueprintKey; label: string; icon: LucideIcon; description: string }> = [
  { key: "document", label: "Document", icon: FileText, description: "Notes, essay plans, and structured writing." },
  { key: "flashcard_deck", label: "Flashcard deck", icon: BookOpen, description: "A real deck with editable cards." },
  { key: "quiz", label: "Quiz", icon: HelpCircle, description: "Questions, answers, and review notes." },
  { key: "planner_task", label: "Planner task", icon: CalendarCheck2, description: "Status, due date, and priority." },
  { key: "thread_reference", label: "Thread reference", icon: MessageSquare, description: "A pinned conversation reference." },
];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object") : [];
}

function id(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultSummary(blueprintKey: EditableBlueprintKey) {
  switch (blueprintKey) {
    case "document":
      return "A structured document for notes, explanations, or drafts.";
    case "flashcard_deck":
      return "A study deck with editable prompts, answers, and hints.";
    case "quiz":
      return "A quiz with safe answer review basics.";
    case "planner_task":
      return "A task with status, priority, and a due date.";
    case "thread_reference":
      return "A reference to a useful Spectra conversation.";
  }
}

function defaultTitle(blueprintKey: EditableBlueprintKey) {
  return `New ${blueprintMeta[blueprintKey].label}`;
}

function dateInputValue(value?: number) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function dateValue(value: string) {
  return value ? new Date(`${value}T12:00:00`).getTime() : undefined;
}

function documentText(content: unknown) {
  const blocks = arrayOfRecords(record(content).blocks);
  if (blocks.length === 0) return "";
  return blocks.map((block) => typeof block.text === "string" ? block.text : "").join("\n\n");
}

function documentContent(text: string, previous: unknown) {
  const previousRecord = record(previous);
  const spectraDemo = previousRecord.spectraDemo;
  const blocks = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((textBlock, index): DocumentBlock => ({
      id: `block-${index + 1}`,
      type: index === 0 && textBlock.length < 90 ? "heading" : "paragraph",
      text: textBlock,
    }));
  return {
    ...previousRecord,
    blocks: blocks.length > 0 ? blocks : [{ id: "intro", type: "paragraph", text: "" }],
    outline: blocks.filter((block) => block.type === "heading").map((block, index) => ({ id: block.id, title: block.text ?? `Section ${index + 1}`, level: 1 })),
    ...(spectraDemo ? { spectraDemo } : {}),
  };
}

function deckCards(content: unknown): DeckCard[] {
  const cards = arrayOfRecords(record(content).cards).map((card, index) => ({
    id: typeof card.id === "string" ? card.id : `card-${index + 1}`,
    front: typeof card.front === "string" ? card.front : "",
    back: typeof card.back === "string" ? card.back : "",
    hint: typeof card.hint === "string" ? card.hint : "",
    confidence: (card.confidence === "weak" || card.confidence === "medium" || card.confidence === "strong" ? card.confidence : "unknown") as DeckCard["confidence"],
  }));
  return cards.length > 0 ? cards : [{ id: "card-1", front: "", back: "", hint: "", confidence: "unknown" }];
}

function quizQuestions(content: unknown): QuizQuestion[] {
  const questions = arrayOfRecords(record(content).questions).map((question, index) => ({
    id: typeof question.id === "string" ? question.id : `question-${index + 1}`,
    prompt: typeof question.prompt === "string" ? question.prompt : "",
    type: (question.type === "multiple_choice" ? "multiple_choice" : "short_answer") as QuizQuestion["type"],
    options: Array.isArray(question.options) ? question.options.filter((option): option is string => typeof option === "string") : [],
    correctAnswer: typeof question.correctAnswer === "string" ? question.correctAnswer : "",
    explanation: typeof question.explanation === "string" ? question.explanation : "",
    difficulty: (question.difficulty === "easy" || question.difficulty === "hard" ? question.difficulty : "medium") as QuizQuestion["difficulty"],
  }));
  return questions.length > 0 ? questions : [{ id: "question-1", prompt: "", type: "short_answer", options: [], correctAnswer: "", explanation: "", difficulty: "medium" }];
}

function plannerTask(content: unknown): Required<Pick<PlannerTaskContent, "status" | "priority">> & PlannerTaskContent {
  const task = record(content);
  const status = task.status === "doing" || task.status === "done" ? task.status : "todo";
  const priority = task.priority === "low" || task.priority === "high" ? task.priority : "medium";
  return {
    description: typeof task.description === "string" ? task.description : "",
    dueAt: typeof task.dueAt === "number" ? task.dueAt : undefined,
    status,
    priority,
  };
}

function threadReference(content: unknown): ThreadReferenceContent {
  const thread = record(content);
  return {
    threadId: typeof thread.threadId === "string" ? thread.threadId : "",
    summary: typeof thread.summary === "string" ? thread.summary : "",
    linkedArtifactIds: Array.isArray(thread.linkedArtifactIds) ? thread.linkedArtifactIds.filter((item): item is string => typeof item === "string") : [],
  };
}

function metricPreview(artifact: SpectraArtifact | null, blueprintKey: EditableBlueprintKey, draftContent: unknown) {
  if (blueprintKey === "document") return `${documentText(draftContent || artifact?.content).split(/\s+/).filter(Boolean).length} words`;
  if (blueprintKey === "flashcard_deck") return `${deckCards(draftContent || artifact?.content).length} cards`;
  if (blueprintKey === "quiz") return `${quizQuestions(draftContent || artifact?.content).length} questions`;
  if (blueprintKey === "planner_task") return plannerTask(draftContent || artifact?.content).status;
  return "reference";
}

export function ArtifactBlueprintSheet({
  mode,
  artifact,
  initialBlueprintKey = "document",
  busy = false,
  onClose,
  onSubmit,
}: {
  mode: SheetMode;
  artifact?: SpectraArtifact | null;
  initialBlueprintKey?: EditableBlueprintKey;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (payload: ArtifactPayload) => Promise<void> | void;
}) {
  const [blueprintKey, setBlueprintKey] = useState<EditableBlueprintKey>(artifact?.blueprintKey ?? initialBlueprintKey);
  const [title, setTitle] = useState(artifact?.title ?? defaultTitle(initialBlueprintKey));
  const [summary, setSummary] = useState(artifact?.summary ?? defaultSummary(initialBlueprintKey));
  const [documentDraft, setDocumentDraft] = useState(documentText(artifact?.content) || "");
  const [cards, setCards] = useState<DeckCard[]>(deckCards(artifact?.content));
  const [questions, setQuestions] = useState<QuizQuestion[]>(quizQuestions(artifact?.content));
  const [task, setTask] = useState(plannerTask(artifact?.content));
  const [taskDueDate, setTaskDueDate] = useState(dateInputValue(plannerTask(artifact?.content).dueAt));
  const [thread, setThread] = useState(threadReference(artifact?.content));
  const [tagDraft, setTagDraft] = useState((artifact?.tags ?? []).join(", "));

  const meta = blueprintMeta[blueprintKey];
  const Icon = meta.icon;

  const previewContent = useMemo(() => {
    if (blueprintKey === "document") return documentContent(documentDraft, artifact?.content);
    if (blueprintKey === "flashcard_deck") return { ...record(artifact?.content), cards, settings: record(artifact?.content).settings ?? { shuffle: true, revealMode: "click" } };
    if (blueprintKey === "quiz") return { ...record(artifact?.content), questions: questions.map((question) => ({ ...question, type: (question.options?.length ?? 0) > 0 ? "multiple_choice" : "short_answer" })), settings: record(artifact?.content).settings ?? { showAnswersImmediately: true, timed: false } };
    if (blueprintKey === "planner_task") return { ...record(artifact?.content), ...task, dueAt: dateValue(taskDueDate) };
    return { ...record(artifact?.content), ...thread, summary };
  }, [artifact?.content, blueprintKey, cards, documentDraft, questions, summary, task, taskDueDate, thread]);

  function selectBlueprint(nextKey: EditableBlueprintKey) {
    setBlueprintKey(nextKey);
    if (mode === "create") {
      setTitle(defaultTitle(nextKey));
      setSummary(defaultSummary(nextKey));
    }
  }

  async function submit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    const tags = tagDraft.split(",").map((tag) => tag.trim()).filter(Boolean);
    await onSubmit({
      blueprintKey,
      title: trimmedTitle,
      summary: summary.trim() || undefined,
      content: previewContent,
      tags,
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(18,14,10,0.24)] backdrop-blur-[2px]" onPointerDown={onClose}>
      <aside
        className="absolute right-0 top-0 flex h-full w-full max-w-[820px] flex-col border-l border-[var(--border-default)] bg-[var(--bg-primary)] shadow-[0_24px_80px_rgba(18,14,10,0.22)]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="border-b border-[var(--border-default)] px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-[color-mix(in_oklab,currentColor_24%,transparent)] bg-[color-mix(in_oklab,currentColor_9%,var(--bg-elevated))]" style={{ color: meta.color }}>
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{mode === "create" ? "Create artifact" : "Artifact detail"}</div>
                  <h2 className="font-display text-[26px] font-semibold leading-tight text-[var(--text-primary)]">{mode === "create" ? `New ${meta.label}` : artifact?.title ?? "Artifact"}</h2>
                </div>
              </div>
            </div>
            <button type="button" className="flex h-9 w-9 items-center justify-center rounded-[8px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" onClick={onClose} aria-label="Close artifact detail">
              <X className="h-4 w-4" />
            </button>
          </div>
          {mode === "create" ? (
            <div className="mt-5 grid gap-2 sm:grid-cols-5">
              {blueprintChoices.map((choice) => {
                const ChoiceIcon = choice.icon;
                const selected = blueprintKey === choice.key;
                return (
                  <button
                    key={choice.key}
                    type="button"
                    className={`min-h-[86px] rounded-[8px] border p-2.5 text-left transition ${selected ? "border-[#8b6ff0] bg-[color-mix(in_oklab,#8b6ff0_5%,var(--bg-elevated))]" : "border-[var(--border-default)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)]"}`}
                    onClick={() => selectBlueprint(choice.key)}
                  >
                    <ChoiceIcon className="h-4 w-4" style={{ color: blueprintMeta[choice.key].color }} />
                    <div className="mt-2 text-[12px] font-semibold text-[var(--text-primary)]">{choice.label}</div>
                    <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-[var(--text-secondary)]">{choice.description}</div>
                  </button>
                );
              })}
            </div>
          ) : null}
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_250px]">
            <section className="min-w-0 space-y-4">
              <Field label="Title">
                <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass()} placeholder="Artifact title" />
              </Field>
              <Field label="Summary">
                <textarea value={summary} onChange={(event) => setSummary(event.target.value)} className={textareaClass("min-h-[78px]")} placeholder="Short useful summary" />
              </Field>
              {blueprintKey === "document" ? <DocumentEditor value={documentDraft} onChange={setDocumentDraft} /> : null}
              {blueprintKey === "flashcard_deck" ? <DeckEditor cards={cards} setCards={setCards} /> : null}
              {blueprintKey === "quiz" ? <QuizEditor questions={questions} setQuestions={setQuestions} /> : null}
              {blueprintKey === "planner_task" ? <TaskEditor task={task} setTask={setTask} dueDate={taskDueDate} setDueDate={setTaskDueDate} /> : null}
              {blueprintKey === "thread_reference" ? <ThreadEditor thread={thread} setThread={setThread} /> : null}
            </section>
            <aside className="space-y-4">
              <div className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">Blueprint</div>
                <div className="mt-3 flex items-center gap-2 text-[14px] font-semibold text-[var(--text-primary)]">
                  <Icon className="h-4 w-4" style={{ color: meta.color }} />
                  {meta.label}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <MiniMetric label="State" value={mode === "create" ? "Draft" : "Active"} />
                  <MiniMetric label="Object" value={metricPreview(artifact ?? null, blueprintKey, previewContent)} />
                </div>
              </div>
              <div className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
                <Field label="Tags">
                  <input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} className={inputClass()} placeholder="biology, revision" />
                </Field>
              </div>
              <div className="rounded-[8px] border border-dashed border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_54%,transparent)] p-4 text-[12px] leading-5 text-[var(--text-secondary)]">
                <Sparkles className="mb-2 h-4 w-4 text-[var(--text-tertiary)]" />
                AI generation, operation planning, advanced grading, and spaced repetition are later waves. This editor only saves safe object fields.
              </div>
            </aside>
          </div>
        </main>
        <footer className="flex items-center justify-between gap-4 border-t border-[var(--border-default)] px-6 py-4">
          <div className="hidden items-center gap-2 text-[12px] text-[var(--text-secondary)] sm:flex">
            <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
            Saves to the shared artifact object.
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className={secondaryButtonClass()} onClick={onClose}>Cancel</button>
            <button type="button" className={primaryButtonClass()} disabled={!title.trim() || busy} onClick={() => void submit()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "create" ? <Plus className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {mode === "create" ? "Create" : "Save"}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold text-[var(--text-secondary)]">{label}</span>
      {children}
    </label>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-2">
      <div className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{value}</div>
      <div className="text-[10px] text-[var(--text-tertiary)]">{label}</div>
    </div>
  );
}

function DocumentEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field label="Document body">
      <textarea value={value} onChange={(event) => onChange(event.target.value)} className={textareaClass("min-h-[360px] font-serif text-[15px] leading-7")} placeholder="Write the document. Separate blocks with blank lines." />
    </Field>
  );
}

function DeckEditor({ cards, setCards }: { cards: DeckCard[]; setCards: (cards: DeckCard[]) => void }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Cards</h3>
        <button type="button" className={secondaryButtonClass()} onClick={() => setCards([...cards, { id: id("card"), front: "", back: "", hint: "", confidence: "unknown" }])}><Plus className="h-3.5 w-3.5" />Add card</button>
      </div>
      {cards.map((card, index) => (
        <div key={card.id} className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">Card {index + 1}</div>
          <div className="grid gap-2 md:grid-cols-2">
            <input value={card.front} onChange={(event) => setCards(cards.map((item) => item.id === card.id ? { ...item, front: event.target.value } : item))} className={inputClass()} placeholder="Front" />
            <input value={card.back} onChange={(event) => setCards(cards.map((item) => item.id === card.id ? { ...item, back: event.target.value } : item))} className={inputClass()} placeholder="Back" />
          </div>
          <input value={card.hint ?? ""} onChange={(event) => setCards(cards.map((item) => item.id === card.id ? { ...item, hint: event.target.value } : item))} className={`${inputClass()} mt-2`} placeholder="Hint" />
        </div>
      ))}
    </section>
  );
}

function QuizEditor({ questions, setQuestions }: { questions: QuizQuestion[]; setQuestions: (questions: QuizQuestion[]) => void }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Questions</h3>
        <button type="button" className={secondaryButtonClass()} onClick={() => setQuestions([...questions, { id: id("question"), prompt: "", type: "short_answer", options: [], correctAnswer: "", explanation: "", difficulty: "medium" }])}><Plus className="h-3.5 w-3.5" />Add question</button>
      </div>
      {questions.map((question, index) => (
        <div key={question.id} className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">Question {index + 1}</div>
          <textarea value={question.prompt} onChange={(event) => setQuestions(questions.map((item) => item.id === question.id ? { ...item, prompt: event.target.value } : item))} className={textareaClass("min-h-[72px]")} placeholder="Question prompt" />
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <textarea value={(question.options ?? []).join("\n")} onChange={(event) => setQuestions(questions.map((item) => item.id === question.id ? { ...item, options: event.target.value.split("\n").map((option) => option.trim()).filter(Boolean) } : item))} className={textareaClass("min-h-[90px]")} placeholder="Options, one per line" />
            <div className="space-y-2">
              <input value={question.correctAnswer ?? ""} onChange={(event) => setQuestions(questions.map((item) => item.id === question.id ? { ...item, correctAnswer: event.target.value } : item))} className={inputClass()} placeholder="Correct answer" />
              <input value={question.explanation ?? ""} onChange={(event) => setQuestions(questions.map((item) => item.id === question.id ? { ...item, explanation: event.target.value } : item))} className={inputClass()} placeholder="Explanation" />
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

function TaskEditor({
  task,
  setTask,
  dueDate,
  setDueDate,
}: {
  task: Required<Pick<PlannerTaskContent, "status" | "priority">> & PlannerTaskContent;
  setTask: (task: Required<Pick<PlannerTaskContent, "status" | "priority">> & PlannerTaskContent) => void;
  dueDate: string;
  setDueDate: (value: string) => void;
}) {
  return (
    <section className="space-y-4">
      <Field label="Task description">
        <textarea value={task.description ?? ""} onChange={(event) => setTask({ ...task, description: event.target.value })} className={textareaClass("min-h-[150px]")} placeholder="What needs to happen?" />
      </Field>
      <div className="grid gap-3 md:grid-cols-3">
        <Segmented label="Status" value={task.status} options={["todo", "doing", "done"]} onChange={(value) => setTask({ ...task, status: value as "todo" | "doing" | "done" })} />
        <Segmented label="Priority" value={task.priority} options={["low", "medium", "high"]} onChange={(value) => setTask({ ...task, priority: value as "low" | "medium" | "high" })} />
        <Field label="Due date">
          <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className={inputClass()} />
        </Field>
      </div>
    </section>
  );
}

function ThreadEditor({ thread, setThread }: { thread: ThreadReferenceContent; setThread: (thread: ThreadReferenceContent) => void }) {
  return (
    <section className="space-y-4">
      <Field label="Thread id or reference">
        <input value={thread.threadId ?? ""} onChange={(event) => setThread({ ...thread, threadId: event.target.value })} className={inputClass()} placeholder="Thread id, URL, or short reference" />
      </Field>
      <Field label="Reference summary">
        <textarea value={thread.summary ?? ""} onChange={(event) => setThread({ ...thread, summary: event.target.value })} className={textareaClass("min-h-[170px]")} placeholder="What should this conversation card remind you of?" />
      </Field>
      <Field label="Linked artifact ids">
        <input value={(thread.linkedArtifactIds ?? []).join(", ")} onChange={(event) => setThread({ ...thread, linkedArtifactIds: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} className={inputClass()} placeholder="Optional artifact ids" />
      </Field>
    </section>
  );
}

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-semibold text-[var(--text-secondary)]">{label}</div>
      <div className="flex rounded-[8px] bg-[color-mix(in_oklab,var(--bg-elevated)_74%,transparent)] p-1 shadow-[inset_0_0_0_1px_var(--border-default)]">
        {options.map((option) => (
          <button key={option} type="button" className={`h-8 flex-1 rounded-[7px] px-2 text-[12px] font-medium capitalize ${value === option ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_1px_5px_rgba(27,20,12,0.08)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`} onClick={() => onChange(option)}>
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function inputClass() {
  return "h-10 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,#8b6ff0_55%,var(--border-default))]";
}

function textareaClass(extra = "") {
  return `w-full resize-none rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,#8b6ff0_55%,var(--border-default))] ${extra}`;
}

function secondaryButtonClass() {
  return "inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45";
}

function primaryButtonClass() {
  return "inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[var(--text-primary)] px-3 text-[13px] font-medium text-[var(--bg-primary)] disabled:opacity-45";
}

export function blueprintKeyForCard(card: ArtifactCardView): EditableBlueprintKey {
  return card.blueprintKey;
}
