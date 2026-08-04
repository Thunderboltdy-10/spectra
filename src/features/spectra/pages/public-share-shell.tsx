"use client";

import {
  BookOpen,
  CalendarDays,
  CheckSquare2,
  Code2,
  FileText,
  Grid3X3,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  Presentation,
  Share2,
  Sparkles,
  Table2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PublishedCodeRuntime } from "../components/published-code-runtime";

type PublicArtifact = {
  artifactId: string;
  title: string;
  summary?: string;
  blueprintKey: string;
  content?: unknown;
  runtimeBuild?: {
    buildId: string;
    artifactVersionId: string;
    runtime: "browser" | "react" | "python";
    payloadHash?: string;
    sdkVersion: string;
    payloadBytes?: number;
    storageUrl: string;
  };
  updatedAt: number;
};

type PublicProjection =
  | {
      resourceType: "workspace";
      level: "read";
      expiresAt?: number;
      workspace: {
        workspaceId: string;
        title: string;
        description?: string;
        icon?: string;
        color?: string;
        defaultView: string;
        updatedAt: number;
      };
      artifacts: PublicArtifact[];
    }
  | {
      resourceType: "artifact" | "agent";
      level: "read";
      expiresAt?: number;
      artifact: PublicArtifact;
    };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

const ICONS: Record<string, typeof FileText> = {
  document: FileText,
  flashcard_deck: BookOpen,
  quiz: CheckSquare2,
  planner_task: CheckSquare2,
  timetable: CalendarDays,
  presentation: Presentation,
  sheets: Table2,
  code: Code2,
  whiteboard: Grid3X3,
  agent: Sparkles,
};

function formatUpdated(value: number) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function ArtifactContent({
  artifact,
  compact = false,
}: {
  artifact: PublicArtifact;
  compact?: boolean;
}) {
  const content = record(artifact.content);
  const Icon = ICONS[artifact.blueprintKey] ?? FileText;
  if (compact) {
    return (
      <article className="group rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 transition-colors hover:border-[var(--border-strong)]">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[color-mix(in_oklab,var(--brand-primary)_9%,var(--bg-secondary))] text-[var(--brand-primary)]">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
              {artifact.title}
            </h3>
            <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[var(--text-secondary)]">
              {artifact.summary || "Shared Spectra artifact"}
            </p>
          </div>
        </div>
      </article>
    );
  }

  const blocks = rows(content.blocks);
  const cards = rows(content.cards);
  const questions = rows(content.questions);
  const slides = rows(content.slides);
  const sheets = rows(content.sheets);
  const files = rows(content.files);
  const events = rows(content.events);
  const nodes = rows(content.nodes);
  const subtasks = rows(content.subtasks);

  return (
    <article className="mx-auto w-full max-w-[920px] rounded-[16px] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[0_18px_70px_rgba(37,31,24,0.08)]">
      <header className="border-b border-[var(--border-subtle)] px-6 py-6 sm:px-10 sm:py-8">
        <div className="flex items-center gap-2 text-micro font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
          <Icon className="h-3.5 w-3.5" />
          {artifact.blueprintKey.replaceAll("_", " ")}
        </div>
        <h1 className="mt-3 font-display text-[clamp(28px,5vw,44px)] font-semibold leading-[1.08] text-[var(--text-primary)]">
          {artifact.title}
        </h1>
        {artifact.summary ? (
          <p className="mt-3 max-w-2xl text-[13px] leading-6 text-[var(--text-secondary)]">
            {artifact.summary}
          </p>
        ) : null}
      </header>
      <div className="px-6 py-7 sm:px-10 sm:py-10">
        {artifact.blueprintKey === "document" ? (
          <div className="space-y-5 text-[14px] leading-7 text-[var(--text-primary)]">
            {blocks.map((block, index) =>
              text(block.type) === "heading" ? (
                <h2
                  key={String(block.id ?? index)}
                  className="pt-3 font-display text-[24px] font-semibold"
                >
                  {text(block.text)}
                </h2>
              ) : text(block.type) === "callout" ? (
                <aside
                  key={String(block.id ?? index)}
                  className="rounded-[10px] border border-[color-mix(in_oklab,var(--brand-primary)_24%,var(--border-default))] bg-[color-mix(in_oklab,var(--brand-primary)_5%,var(--bg-primary))] px-4 py-3"
                >
                  {text(block.text)}
                </aside>
              ) : (
                <p
                  key={String(block.id ?? index)}
                  className="whitespace-pre-wrap"
                >
                  {text(block.text)}
                </p>
              ),
            )}
          </div>
        ) : null}
        {artifact.blueprintKey === "flashcard_deck" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {cards.map((card, index) => (
              <section
                key={String(card.id ?? index)}
                className="rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-5"
              >
                <span className="text-micro font-semibold uppercase tracking-[.11em] text-[#7560e8]">
                  Card {index + 1}
                </span>
                <h2 className="mt-3 font-display text-[18px] font-semibold">
                  {text(card.front, "Untitled card")}
                </h2>
                <p className="mt-4 border-t border-[var(--border-subtle)] pt-4 text-[12px] leading-6 text-[var(--text-secondary)]">
                  {text(card.back)}
                </p>
              </section>
            ))}
          </div>
        ) : null}
        {artifact.blueprintKey === "quiz" ? (
          <div className="space-y-4">
            {questions.map((question, index) => (
              <section
                key={String(question.id ?? index)}
                className="rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-5"
              >
                <span className="text-micro font-semibold uppercase tracking-[.11em] text-[var(--accent-mint)]">
                  Question {index + 1}
                </span>
                <h2 className="mt-2 font-display text-[18px] font-semibold">
                  {text(question.prompt)}
                </h2>
                <ol className="mt-4 grid gap-2">
                  {(Array.isArray(question.options)
                    ? question.options
                    : []
                  ).map((option, optionIndex) => (
                    <li
                      key={optionIndex}
                      className="rounded-[8px] border border-[var(--border-subtle)] px-3 py-2.5 text-[12px] text-[var(--text-secondary)]"
                    >
                      {String.fromCharCode(65 + optionIndex)}.{" "}
                      {typeof option === "string"
                        ? option
                        : text(record(option).text)}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        ) : null}
        {artifact.blueprintKey === "planner_task" ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              {["status", "priority", "dueAt"].map((field) => (
                <div
                  key={field}
                  className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4"
                >
                  <span className="text-micro capitalize text-[var(--text-tertiary)]">
                    {field.replace("At", "")}
                  </span>
                  <strong className="mt-1 block text-[13px] capitalize">
                    {field === "dueAt" && typeof content[field] === "number"
                      ? formatUpdated(content[field] as number)
                      : String(content[field] ?? "Not set")}
                  </strong>
                </div>
              ))}
            </div>
            {subtasks.map((task, index) => (
              <div
                key={String(task.id ?? index)}
                className="flex items-center gap-3 rounded-[9px] border border-[var(--border-subtle)] px-4 py-3 text-[12px]"
              >
                <span
                  className={`h-4 w-4 rounded-full border ${task.completed ? "border-[var(--success)] bg-[var(--success)]" : "border-[var(--border-default)]"}`}
                />
                {text(task.title, text(task.text, "Untitled step"))}
              </div>
            ))}
          </div>
        ) : null}
        {artifact.blueprintKey === "presentation" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {slides.map((slide, index) => (
              <section
                key={String(slide.id ?? index)}
                className="aspect-video rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-5 shadow-sm"
              >
                <span className="text-micro font-semibold uppercase tracking-[.11em] text-[var(--text-tertiary)]">
                  Slide {index + 1}
                </span>
                <h2 className="mt-4 font-display text-[20px] font-semibold">
                  {text(slide.title, `Slide ${index + 1}`)}
                </h2>
                {rows(slide.objects)
                  .slice(0, 4)
                  .map((object, objectIndex) => (
                    <p
                      key={String(object.id ?? objectIndex)}
                      className="mt-2 line-clamp-2 text-[11px] leading-5 text-[var(--text-secondary)]"
                    >
                      {text(record(object.content).text, text(object.content))}
                    </p>
                  ))}
              </section>
            ))}
          </div>
        ) : null}
        {artifact.blueprintKey === "sheets" ? (
          <div className="space-y-5">
            {sheets.map((sheet, index) => {
              const cells = record(sheet.cells);
              const entries = Object.entries(cells).slice(0, 60);
              return (
                <section key={String(sheet.id ?? index)}>
                  <h2 className="mb-3 font-display text-[18px] font-semibold">
                    {text(sheet.name, `Sheet ${index + 1}`)}
                  </h2>
                  <div className="overflow-auto rounded-[10px] border border-[var(--border-default)]">
                    <table className="w-full min-w-[520px] border-collapse text-[11px]">
                      <tbody>
                        {Array.from(
                          {
                            length: Math.max(1, Math.ceil(entries.length / 6)),
                          },
                          (_, rowIndex) => (
                            <tr key={rowIndex}>
                              {entries
                                .slice(rowIndex * 6, rowIndex * 6 + 6)
                                .map(([address, cell]) => (
                                  <td
                                    key={address}
                                    className="min-w-24 border-b border-r border-[var(--border-subtle)] p-2 align-top"
                                  >
                                    <span className="block text-micro text-[var(--text-tertiary)]">
                                      {address}
                                    </span>
                                    <span className="mt-1 block">
                                      {String(
                                        record(cell).value ??
                                          record(cell).formula ??
                                          "",
                                      )}
                                    </span>
                                  </td>
                                ))}
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}
        {artifact.blueprintKey === "code" ? (
          artifact.runtimeBuild ? (
            <PublishedCodeRuntime
              title={artifact.title}
              build={artifact.runtimeBuild}
              compact={false}
            />
          ) : (
            <div className="space-y-4">
              {files.map((file, index) => (
                <section
                  key={String(file.id ?? index)}
                  className="overflow-hidden rounded-[10px] border border-[var(--border-default)]"
                >
                  <header className="flex items-center justify-between bg-[var(--bg-secondary)] px-4 py-2 text-micro">
                    <strong>{text(file.path, `File ${index + 1}`)}</strong>
                    <span className="text-[var(--text-tertiary)]">
                      {text(file.language)}
                    </span>
                  </header>
                  <pre className="max-h-[440px] overflow-auto bg-[#171a1d] p-4 font-mono text-[11px] leading-5 text-[#d7e0e7]">
                    <code>{text(file.source)}</code>
                  </pre>
                </section>
              ))}
            </div>
          )
        ) : null}
        {artifact.blueprintKey === "timetable" ? (
          <div className="space-y-2">
            {events.map((event, index) => (
              <section
                key={String(event.id ?? index)}
                className="grid gap-1 rounded-[9px] border border-[var(--border-subtle)] px-4 py-3 sm:grid-cols-[180px_1fr]"
              >
                <time className="text-micro text-[var(--text-tertiary)]">
                  {text(event.start)
                    ? new Date(text(event.start)).toLocaleString()
                    : "Time not set"}
                </time>
                <strong className="text-[12px]">
                  {text(event.title, "Untitled event")}
                </strong>
              </section>
            ))}
          </div>
        ) : null}
        {artifact.blueprintKey === "whiteboard" ? (
          <div className="relative min-h-[420px] overflow-hidden rounded-[12px] border border-[var(--border-default)] bg-[radial-gradient(circle_at_center,var(--border-subtle)_1px,transparent_1px)] [background-size:20px_20px]">
            {nodes.slice(0, 80).map((node, index) => (
              <div
                key={String(node.id ?? index)}
                className="absolute rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2 text-micro shadow-sm"
                style={{
                  left: `${Math.max(2, Math.min(82, Number(node.x ?? 0) / 12))}%`,
                  top: `${Math.max(2, Math.min(82, Number(node.y ?? 0) / 8))}%`,
                  width: `${Math.max(80, Math.min(220, Number(node.width ?? 120)))}px`,
                }}
              >
                {text(
                  record(node.content).text,
                  text(node.content, text(node.type, "Node")),
                )}
              </div>
            ))}
          </div>
        ) : null}
        {artifact.blueprintKey === "agent" ? (
          <div className="rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-5">
            <span className="text-micro font-semibold uppercase tracking-[.1em] text-[var(--brand-primary)]">
              Instructions
            </span>
            <p className="mt-3 whitespace-pre-wrap text-[13px] leading-6">
              {text(
                record(content.instructions).text,
                "This agent has no public instructions.",
              )}
            </p>
          </div>
        ) : null}
        {![
          "document",
          "flashcard_deck",
          "quiz",
          "planner_task",
          "presentation",
          "sheets",
          "code",
          "timetable",
          "whiteboard",
          "agent",
        ].includes(artifact.blueprintKey) ? (
          <p className="text-[13px] text-[var(--text-secondary)]">
            This artifact can be viewed in Spectra.
          </p>
        ) : null}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-6 py-4 text-micro text-[var(--text-tertiary)] sm:px-10">
        <span>Read-only public view</span>
        <span>Updated {formatUpdated(artifact.updatedAt)}</span>
      </footer>
    </article>
  );
}

export function PublicShareShell() {
  const [projection, setProjection] = useState<PublicProjection | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");

  const load = useCallback(async (background = false) => {
    const token = window.location.hash.slice(1).trim();
    if (!token) {
      setMessage("This link is incomplete.");
      setState("error");
      return;
    }
    if (!background) setState("loading");
    try {
      const response = await fetch("/api/spectra/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as {
        projection?: PublicProjection;
        error?: string;
      } | null;
      if (!response.ok || !payload?.projection)
        throw new Error(payload?.error || "This public view is unavailable.");
      setProjection(payload.projection);
      setState("ready");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "This public view is unavailable.",
      );
      setProjection(null);
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load(false);
    const refreshInBackground = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const interval = window.setInterval(refreshInBackground, 15_000);
    window.addEventListener("hashchange", refresh);
    window.addEventListener("focus", refreshInBackground);
    document.addEventListener("visibilitychange", refreshInBackground);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("hashchange", refresh);
      window.removeEventListener("focus", refreshInBackground);
      document.removeEventListener("visibilitychange", refreshInBackground);
    };
  }, [load]);
  const expiry = projection?.expiresAt
    ? formatUpdated(projection.expiresAt)
    : null;

  return (
    <main className="spectra-wave-y min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <nav className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-elevated)_92%,transparent)] px-5 py-3.5 backdrop-blur-xl sm:px-8">
        <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-4">
          <a
            href="/landing"
            className="flex items-center gap-2 font-display text-[19px] font-semibold"
            aria-label="Spectra home"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[var(--text-primary)] text-[var(--bg-primary)]">
              S
            </span>
            Spectra
          </a>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1.5 text-micro font-medium text-[var(--text-secondary)]">
            <LockKeyhole className="h-3 w-3" />
            Read-only
          </span>
        </div>
      </nav>
      <div className="mx-auto max-w-[1120px] px-4 py-8 sm:px-7 sm:py-12">
        {state === "loading" ? (
          <div className="flex min-h-[55vh] flex-col items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--brand-primary)]" />
            <p className="mt-4 text-[12px] text-[var(--text-secondary)]">
              Opening the shared view…
            </p>
          </div>
        ) : null}
        {state === "error" ? (
          <section className="mx-auto mt-[12vh] max-w-[460px] rounded-[16px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 text-center shadow-[0_18px_70px_rgba(37,31,24,0.08)]">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-[11px] bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
              <Share2 className="h-5 w-5" />
            </span>
            <h1 className="mt-5 font-display text-[26px] font-semibold">
              Shared view unavailable
            </h1>
            <p className="mt-2 text-[12px] leading-6 text-[var(--text-secondary)]">
              {message} It may have expired or the owner may have turned off
              access.
            </p>
          </section>
        ) : null}
        {state === "ready" && projection?.resourceType === "workspace" ? (
          <>
            <header className="mb-7">
              <div className="flex items-center gap-2 text-micro font-semibold uppercase tracking-[.12em] text-[var(--brand-primary)]">
                <LayoutDashboard className="h-3.5 w-3.5" />
                Shared workspace
              </div>
              <h1 className="mt-3 font-display text-[clamp(30px,6vw,50px)] font-semibold leading-tight">
                {projection.workspace.title}
              </h1>
              {projection.workspace.description ? (
                <p className="mt-3 max-w-2xl text-[13px] leading-6 text-[var(--text-secondary)]">
                  {projection.workspace.description}
                </p>
              ) : null}
            </header>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projection.artifacts.map((artifact) => (
                <ArtifactContent
                  key={artifact.artifactId}
                  artifact={artifact}
                  compact
                />
              ))}
              {projection.artifacts.length === 0 ? (
                <div className="col-span-full rounded-[12px] border border-dashed border-[var(--border-default)] py-16 text-center text-[12px] text-[var(--text-secondary)]">
                  No artifacts have been included in this public workspace view.
                </div>
              ) : null}
            </div>
          </>
        ) : null}
        {state === "ready" &&
        projection &&
        projection.resourceType !== "workspace" ? (
          <ArtifactContent artifact={projection.artifact} />
        ) : null}
        {state === "ready" && expiry ? (
          <p className="mt-6 text-center text-micro text-[var(--text-tertiary)]">
            This public access expires {expiry}.
          </p>
        ) : null}
      </div>
    </main>
  );
}
