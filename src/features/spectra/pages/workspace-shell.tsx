import { BookOpen, CalendarCheck2, FileText, HelpCircle, MessageSquare, PanelRight, Rows3 } from "lucide-react";
import { ArtifactCard, type ArtifactCardView } from "../components/artifact-card";
import { CommandBar } from "../components/command-bar";
import { ResultCardStack } from "../components/result-card";

const workspaceItems: ArtifactCardView[] = [
  {
    id: "doc-1",
    blueprintKey: "document",
    title: "Cell respiration notes",
    summary: "Glycolysis, Krebs cycle, and oxidative phosphorylation outline.",
    meta: "Updated today",
    placement: "workspace",
  },
  {
    id: "deck-1",
    blueprintKey: "flashcard_deck",
    title: "Biology midterm deck",
    summary: "42 cards across enzymes, membranes, genetics, and respiration.",
    meta: "42 cards",
    placement: "workspace",
  },
  {
    id: "quiz-1",
    blueprintKey: "quiz",
    title: "Respiration check",
    summary: "12 mixed questions with short answer and multiple choice.",
    meta: "Medium difficulty",
    placement: "workspace",
  },
  {
    id: "task-1",
    blueprintKey: "planner_task",
    title: "Review Chapter 7",
    summary: "Finish notes and convert weak areas into a single deck.",
    meta: "Due Friday",
    placement: "workspace",
  },
  {
    id: "thread-1",
    blueprintKey: "thread_reference",
    title: "Photosynthesis comparison",
    summary: "Thread reference with linked notes and follow-up questions.",
    meta: "Pinned thread",
    placement: "workspace",
  },
];

const hubSections = [
  { label: "Running", value: "1", icon: Rows3 },
  { label: "Recent", value: "6", icon: PanelRight },
  { label: "Threads", value: "2", icon: MessageSquare },
];

export function WorkspaceShell() {
  return (
    <div className="relative flex h-full min-h-0 bg-[var(--bg-primary)]">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[76px] items-center justify-between border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-6">
          <div>
            <h1 className="text-[22px] font-semibold text-[var(--text-primary)]">Biology</h1>
            <div className="mt-1 flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <span>5 items</span>
              <span className="h-1 w-1 rounded-full bg-[var(--border-default)]" />
              <span>Last active today</span>
            </div>
          </div>
          <div className="flex items-center rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1">
            {["Cards", "Canvas", "Timeline", "Library"].map((view, index) => (
              <button
                key={view}
                type="button"
                className={`h-8 rounded-[6px] px-3 text-[12px] font-medium transition-colors ${
                  index === 0
                    ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {view}
              </button>
            ))}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-6 pb-[320px] pt-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[13px] font-semibold text-[var(--text-secondary)]">Workspace cards</h2>
                <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
                  <FileText className="h-3.5 w-3.5" />
                  <BookOpen className="h-3.5 w-3.5" />
                  <HelpCircle className="h-3.5 w-3.5" />
                  <CalendarCheck2 className="h-3.5 w-3.5" />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {workspaceItems.map((item) => (
                  <ArtifactCard key={item.id} artifact={item} />
                ))}
              </div>
            </section>

            <section className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)]">
              <div className="border-b border-[var(--border-default)] px-4 py-3">
                <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">Focus pane</h2>
              </div>
              <div className="space-y-4 p-4">
                <div>
                  <div className="text-[12px] font-medium text-[var(--text-tertiary)]">Selected artifact</div>
                  <h3 className="mt-1 text-[16px] font-semibold text-[var(--text-primary)]">Biology midterm deck</h3>
                  <p className="mt-2 text-[13px] leading-6 text-[var(--text-secondary)]">
                    Weak cards cluster around oxidative phosphorylation and membrane transport.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {["42 cards", "8 weak", "3 sources"].map((item) => (
                    <div key={item} className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </main>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-[linear-gradient(to_top,var(--bg-primary)_72%,transparent)] px-6 pb-5 pt-20">
          <div className="pointer-events-auto mx-auto max-w-3xl">
            <ResultCardStack className="mb-3" />
            <CommandBar contextLabel="Biology workspace" placeholder="Work with this workspace..." />
          </div>
        </div>
      </section>

      <aside className="hidden w-[300px] shrink-0 border-l border-[var(--border-default)] bg-[var(--bg-elevated)] lg:flex lg:flex-col">
        <div className="border-b border-[var(--border-default)] px-4 py-4">
          <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Run hub</h2>
        </div>
        <div className="space-y-2 p-3">
          {hubSections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.label}
                type="button"
                className="flex w-full items-center justify-between rounded-[8px] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
              >
                <span className="flex items-center gap-2 text-[13px] font-medium text-[var(--text-secondary)]">
                  <Icon className="h-4 w-4" />
                  {section.label}
                </span>
                <span className="text-[12px] text-[var(--text-tertiary)]">{section.value}</span>
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

