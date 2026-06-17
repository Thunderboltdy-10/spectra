import { Search } from "lucide-react";
import { ArtifactCard, type ArtifactCardView } from "../components/artifact-card";

const artifacts: ArtifactCardView[] = [
  {
    id: "inbox-doc",
    blueprintKey: "document",
    title: "Essay feedback summary",
    summary: "Chat-created writing notes waiting to be placed.",
    meta: "Created from chat",
    placement: "inbox",
  },
  {
    id: "inbox-quiz",
    blueprintKey: "quiz",
    title: "Cell membranes quiz",
    summary: "10 generated questions from recent Biology discussion.",
    meta: "Unplaced",
    placement: "inbox",
  },
  {
    id: "workspace-deck",
    blueprintKey: "flashcard_deck",
    title: "Calculus integration deck",
    summary: "A single deck artifact with 28 review cards.",
    meta: "Calculus workspace",
    placement: "workspace",
  },
  {
    id: "workspace-task",
    blueprintKey: "planner_task",
    title: "TOK exhibition draft",
    summary: "Task artifact linked to notes and a teacher feedback thread.",
    meta: "TOK workspace",
    placement: "workspace",
  },
  {
    id: "thread-ref",
    blueprintKey: "thread_reference",
    title: "University applications thread",
    summary: "Pinned conversation with next actions and linked documents.",
    meta: "Applications workspace",
    placement: "workspace",
  },
];

const filters = ["All", "Inbox", "Document", "Deck", "Quiz", "Task", "Thread"];

export function ArtifactsShell() {
  const inbox = artifacts.filter((artifact) => artifact.placement === "inbox");
  const placed = artifacts.filter((artifact) => artifact.placement === "workspace");

  return (
    <div className="flex min-h-full flex-col bg-[var(--bg-primary)]">
      <header className="border-b border-[var(--border-default)] px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-[22px] font-semibold text-[var(--text-primary)]">Artifacts</h1>
            <div className="mt-1 text-[12px] text-[var(--text-secondary)]">{artifacts.length} artifacts</div>
          </div>
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-[260px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                className="h-10 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] pl-9 pr-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,var(--accent-cyan)_55%,var(--border-default))]"
                placeholder="Search artifacts"
              />
            </div>
            <button
              type="button"
              className="h-10 rounded-[8px] bg-[var(--accent-cyan)] px-3 text-[13px] font-semibold text-white transition-[filter] hover:brightness-105"
            >
              New artifact
            </button>
          </div>
        </div>
        <div className="mt-4 flex gap-1 overflow-x-auto rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1">
          {filters.map((filter, index) => (
            <button
              key={filter}
              type="button"
              className={`h-8 shrink-0 rounded-[6px] px-3 text-[12px] font-medium ${
                index === 0
                  ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </header>

      <main className="min-h-0 flex-1 px-6 py-5">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-[var(--text-secondary)]">Inbox</h2>
            <span className="text-[12px] text-[var(--text-tertiary)]">{inbox.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {inbox.map((artifact) => (
              <ArtifactCard key={artifact.id} artifact={artifact} selected={artifact.id === "inbox-doc"} />
            ))}
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-[var(--text-secondary)]">In workspaces</h2>
            <span className="text-[12px] text-[var(--text-tertiary)]">{placed.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {placed.map((artifact) => (
              <ArtifactCard key={artifact.id} artifact={artifact} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

