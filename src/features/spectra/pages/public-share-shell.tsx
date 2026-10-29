"use client";

import { ArrowRight, LockKeyhole, ArrowLeft } from "@/components/icons/glyph-icons";
import { Icon, type IconName } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, LoadingRows, ProblemState } from "@/components/ui/page-state";
import { workTypeMeta } from "../artifacts/presentation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import { PublishedCodeRuntime } from "../components/published-code-runtime";
import { BoardView } from "../whiteboard/board-view";
import { sheetCellEntries } from "../../../../shared/sheet-cells";
import { requestSpectra } from "../data/request";

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

function typeOf(key: string) {
  return (workTypeMeta as Record<string, { glyph: IconName; color: string; soft: string; label: string } | undefined>)[key];
}

function formatUpdated(value: number) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

const PUBLIC_SHARE_RETURN_KEY = "spectra:public-share-return";

function readPublicShareToken() {
  const hashToken = window.location.hash.slice(1).trim();
  if (hashToken) return hashToken;
  try {
    return window.sessionStorage.getItem(PUBLIC_SHARE_RETURN_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function rememberPublicShareToken(token: string) {
  try {
    window.sessionStorage.setItem(PUBLIC_SHARE_RETURN_KEY, token);
  } catch {
    // A storage-restricted browser can still use the original hash directly.
  }
}

function forgetPublicShareToken() {
  try {
    window.sessionStorage.removeItem(PUBLIC_SHARE_RETURN_KEY);
  } catch {
    // Nothing else is required when session storage is unavailable.
  }
}

/** One card in a shared workspace. Opening it shows the work in full. */
function ArtifactCard({
  artifact,
  onOpen,
}: {
  artifact: PublicArtifact;
  onOpen: () => void;
}) {
  const type = typeOf(artifact.blueprintKey);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block w-full rounded-surface border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 text-left transition-colors hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
    >
      <span className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card"
          style={{ background: type?.soft ?? "var(--bg-secondary)" }}
        >
          <Icon name={type?.glyph ?? "document"} size={16} accent={type?.color} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-ui font-semibold text-[var(--text-primary)]">
            {artifact.title}
          </span>
          <span className="mt-1 line-clamp-2 block text-micro leading-5 text-[var(--text-secondary)]">
            {artifact.summary || type?.label || "Shared work"}
          </span>
        </span>
      </span>
    </button>
  );
}

function ArtifactContent({ artifact }: { artifact: PublicArtifact }) {
  const content = record(artifact.content);
  const type = typeOf(artifact.blueprintKey);

  const blocks = rows(content.blocks);
  const cards = rows(content.cards);
  const questions = rows(content.questions);
  const slides = rows(content.slides);
  const sheets = rows(content.sheets);
  const files = rows(content.files);
  const events = rows(content.events);
  const subtasks = rows(content.subtasks);

  return (
    <article className="mx-auto w-full max-w-[920px] rounded-surface border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-soft">
      <header className="border-b border-[var(--border-subtle)] px-6 py-6 sm:px-10 sm:py-8">
        <div className="flex items-center gap-2 text-caption text-[var(--text-secondary)]">
          <Icon name={type?.glyph ?? "document"} size={14} accent={type?.color} />
          {type?.label ?? "Shared work"}
        </div>
        <h1 className="mt-3 font-display text-display font-semibold leading-[1.08] text-[var(--text-primary)]">
          {artifact.title}
        </h1>
        {artifact.summary ? (
          <p className="mt-3 max-w-2xl text-ui leading-6 text-[var(--text-secondary)]">
            {artifact.summary}
          </p>
        ) : null}
      </header>
      <div className="px-6 py-7 sm:px-10 sm:py-10">
        {artifact.blueprintKey === "document" ? (
          <div className="space-y-5 text-body leading-7 text-[var(--text-primary)]">
            {blocks.map((block, index) =>
              text(block.type) === "heading" ? (
                <h2
                  key={String(block.id ?? index)}
                  className="pt-3 font-display text-metric font-semibold"
                >
                  {text(block.text)}
                </h2>
              ) : text(block.type) === "callout" ? (
                <aside
                  key={String(block.id ?? index)}
                  className="rounded-card border border-[color-mix(in_oklab,var(--brand-primary)_24%,var(--border-default))] bg-[color-mix(in_oklab,var(--brand-primary)_5%,var(--bg-primary))] px-4 py-3"
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
                className="rounded-surface border border-[var(--border-default)] bg-[var(--bg-primary)] p-5"
              >
                <span className="text-micro font-semibold text-[var(--brand-primary)]">
                  Card {index + 1}
                </span>
                <h2 className="mt-3 font-display text-heading font-semibold">
                  {text(card.front, "Untitled card")}
                </h2>
                <p className="mt-4 border-t border-[var(--border-subtle)] pt-4 text-caption leading-6 text-[var(--text-secondary)]">
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
                className="rounded-surface border border-[var(--border-default)] bg-[var(--bg-primary)] p-5"
              >
                <span className="text-micro font-semibold text-[var(--accent-mint)]">
                  Question {index + 1}
                </span>
                <h2 className="mt-2 font-display text-heading font-semibold">
                  {text(question.prompt)}
                </h2>
                <ol className="mt-4 grid gap-2">
                  {(Array.isArray(question.options)
                    ? question.options
                    : []
                  ).map((option, optionIndex) => (
                    <li
                      key={optionIndex}
                      className="rounded-control border border-[var(--border-subtle)] px-3 py-2.5 text-caption text-[var(--text-secondary)]"
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
                  className="rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)] p-4"
                >
                  <span className="text-micro capitalize text-[var(--text-tertiary)]">
                    {field.replace("At", "")}
                  </span>
                  <strong className="mt-1 block text-ui capitalize">
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
                className="flex items-center gap-3 rounded-card border border-[var(--border-subtle)] px-4 py-3 text-caption"
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
                className="aspect-video rounded-surface border border-[var(--border-default)] bg-[var(--bg-primary)] p-5 shadow-sm"
              >
                <span className="text-micro font-semibold text-[var(--text-tertiary)]">
                  Slide {index + 1}
                </span>
                <h2 className="mt-4 font-display text-heading font-semibold">
                  {text(slide.title, `Slide ${index + 1}`)}
                </h2>
                {rows(slide.objects)
                  .slice(0, 4)
                  .map((object, objectIndex) => (
                    <p
                      key={String(object.id ?? objectIndex)}
                      className="mt-2 line-clamp-2 text-micro leading-5 text-[var(--text-secondary)]"
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
              const entries = sheetCellEntries(sheet.cells, 60);
              return (
                <section key={String(sheet.id ?? index)}>
                  <h2 className="mb-3 font-display text-heading font-semibold">
                    {text(sheet.name, `Sheet ${index + 1}`)}
                  </h2>
                  <div className="overflow-auto rounded-card border border-[var(--border-default)]">
                    <table className="w-full min-w-[520px] border-collapse text-micro">
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
                  className="overflow-hidden rounded-card border border-[var(--border-default)]"
                >
                  <header className="flex items-center justify-between bg-[var(--bg-secondary)] px-4 py-2 text-micro">
                    <strong>{text(file.path, `File ${index + 1}`)}</strong>
                    <span className="text-[var(--text-tertiary)]">
                      {text(file.language)}
                    </span>
                  </header>
                  <pre className="max-h-[440px] overflow-auto bg-[var(--text-primary)] p-4 font-mono text-micro leading-5 text-[var(--bg-tertiary)]">
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
                className="grid gap-1 rounded-card border border-[var(--border-subtle)] px-4 py-3 sm:grid-cols-[180px_1fr]"
              >
                <time className="text-micro text-[var(--text-tertiary)]">
                  {text(event.start)
                    ? new Date(text(event.start)).toLocaleString()
                    : "Time not set"}
                </time>
                <strong className="text-caption">
                  {text(event.title, "Untitled event")}
                </strong>
              </section>
            ))}
          </div>
        ) : null}
        {artifact.blueprintKey === "whiteboard" ? <BoardView content={artifact.content} /> : null}
        {artifact.blueprintKey === "agent" ? (
          <div className="rounded-surface border border-[var(--border-default)] bg-[var(--bg-primary)] p-5">
            <span className="text-micro font-semibold text-[var(--brand-primary)]">
              Instructions
            </span>
            <p className="mt-3 whitespace-pre-wrap text-ui leading-6">
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
          <p className="text-ui text-[var(--text-secondary)]">
            This work can be viewed in Spectra.
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

/**
 * A shared workspace: its cards, or one piece of work opened in full. The
 * projection already carries every card's content, so a reader can open the
 * work instead of seeing only its title.
 */
function SharedWorkspace({
  projection,
  openArtifactId,
  onOpen,
}: {
  projection: Extract<PublicProjection, { resourceType: "workspace" }>;
  openArtifactId: string | null;
  onOpen: (artifactId: string | null) => void;
}) {
  const opened = projection.artifacts.find(
    (artifact) => artifact.artifactId === openArtifactId,
  );
  if (opened)
    return (
      <>
        <Button variant="ghost" size="sm" className="mb-5" onClick={() => onOpen(null)}>
          <ArrowLeft className="h-4 w-4" />
          Back to {projection.workspace.title}
        </Button>
        <ArtifactContent artifact={opened} />
      </>
    );
  return (
    <>
      <PageHeader
        className="mb-7"
        title={projection.workspace.title}
        description={projection.workspace.description || "A shared space. Open any piece to read it in full."}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projection.artifacts.map((artifact) => (
          <ArtifactCard
            key={artifact.artifactId}
            artifact={artifact}
            onOpen={() => onOpen(artifact.artifactId)}
          />
        ))}
        {projection.artifacts.length === 0 ? (
          <EmptyState
            className="col-span-full"
            icon="layers"
            title="Nothing shared here yet"
            detail="The owner hasn't added any work to this view. Check back later or ask them for a new link."
          />
        ) : null}
      </div>
    </>
  );
}

export function PublicShareShell() {
  const router = useRouter();
  const [projection, setProjection] = useState<PublicProjection | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "error" | "auth-required"
  >("loading");
  const [message, setMessage] = useState("");
  const [retryable, setRetryable] = useState(false);
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);
  const shownRef = useRef(false);

  const load = useCallback(async (background = false) => {
    const generation = ++loadGenerationRef.current;
    const token = readPublicShareToken();
    if (!token) {
      setMessage("This link is incomplete.");
      setState("error");
      return;
    }
    if (!background) setState("loading");
    try {
      const response = await requestSpectra("/api/spectra/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as {
        projection?: PublicProjection;
        error?: string;
        code?: string;
      } | null;
      if (generation !== loadGenerationRef.current) return;
      if (response.status === 401 && payload?.code === "AUTH_REQUIRED") {
        rememberPublicShareToken(token);
        setProjection(null);
        setMessage(
          payload.error ||
            "Sign in with a verified school account to open this shared view.",
        );
        setState("auth-required");
        return;
      }
      if (!response.ok || !payload?.projection) {
        if (response.status === 404) forgetPublicShareToken();
        throw Object.assign(
          new Error(payload?.error || "This public view is unavailable."),
          { terminal: response.status >= 400 && response.status < 500 },
        );
      }
      // The auth return uses /public without a token in the redirect URL.
      // Restore its fragment before clearing temporary storage so refresh,
      // focus and a full reload continue opening the same shared work.
      if (!window.location.hash) {
        const restoredUrl = new URL(window.location.href);
        restoredUrl.hash = token;
        window.history.replaceState(window.history.state, "", restoredUrl);
      }
      forgetPublicShareToken();
      shownRef.current = true;
      setProjection(payload.projection);
      setState("ready");
    } catch (error) {
      if (generation !== loadGenerationRef.current) return;
      const terminal =
        (error as { terminal?: unknown } | null)?.terminal === true;
      /* A background refresh that could not reach the server keeps the work
         on screen; only a link that is gone replaces it. */
      if (background && !terminal && shownRef.current) return;
      shownRef.current = false;
      setRetryable(!terminal);
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
      loadGenerationRef.current += 1;
      window.clearInterval(interval);
      window.removeEventListener("hashchange", refresh);
      window.removeEventListener("focus", refreshInBackground);
      document.removeEventListener("visibilitychange", refreshInBackground);
    };
  }, [load]);
  const expiry = projection?.expiresAt
    ? formatUpdated(projection.expiresAt)
    : null;

  function continueToSignIn() {
    const token = readPublicShareToken();
    if (!token) {
      setMessage("This link is incomplete.");
      setState("error");
      return;
    }
    rememberPublicShareToken(token);
    router.push(
      `/sign-in?redirect_url=${encodeURIComponent("/public")}`,
    );
  }

  return (
    <main className="spectra-wave-y min-h-screen text-[var(--text-primary)]">
      <nav className="sticky top-0 z-chrome border-b border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-elevated)_92%,transparent)] px-5 py-3.5 backdrop-blur-xl sm:px-8">
        <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-4">
          <a
            href="/landing"
            className="flex items-center gap-2 font-display text-heading font-semibold"
            aria-label="Spectra home"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-card bg-[var(--text-primary)] text-[var(--bg-primary)]">
              S
            </span>
            Spectra
          </a>
          <span className="inline-flex items-center gap-1.5 rounded-chip border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1.5 text-micro font-medium text-[var(--text-secondary)]">
            <LockKeyhole className="h-3 w-3" />
            View only
          </span>
        </div>
      </nav>
      <div className="mx-auto max-w-[1120px] px-4 py-8 sm:px-7 sm:py-12">
        {state === "loading" ? (
          <LoadingRows label="Opening the shared work" count={6} className="mx-auto max-w-[920px]" />
        ) : null}
        {state === "error" ? (
          <ProblemState
            className="mt-[10vh]"
            title="This shared work isn't available"
            detail={message}
            action={
              retryable ? (
                <Button variant="secondary" size="sm" onClick={() => void load()}>
                  Try again
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => router.push("/landing")}>
                  Go to Spectra
                </Button>
              )
            }
          />
        ) : null}
        {state === "auth-required" ? (
          <EmptyState
            className="mt-[10vh]"
            icon="signIn"
            title="Sign in to open this"
            detail={
              <>
                <span role="status">{message}</span>
                <span className="mt-2 block text-micro text-[var(--text-tertiary)]">
                  You’ll come straight back here after signing in.
                </span>
              </>
            }
            action={
              <Button variant="primary" onClick={continueToSignIn}>
                Sign in to continue
                <ArrowRight className="h-4 w-4" />
              </Button>
            }
          />
        ) : null}
        {state === "ready" && projection?.resourceType === "workspace" ? (
          <SharedWorkspace
            projection={projection}
            openArtifactId={openArtifactId}
            onOpen={setOpenArtifactId}
          />
        ) : null}
        {state === "ready" &&
        projection &&
        projection.resourceType !== "workspace" ? (
          <ArtifactContent artifact={projection.artifact} />
        ) : null}
        {state === "ready" && expiry ? (
          <p className="mt-6 text-center text-micro text-[var(--text-tertiary)]">
            This link stops working {expiry}.
          </p>
        ) : null}
      </div>
    </main>
  );
}
