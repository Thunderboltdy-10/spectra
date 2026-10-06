"use client";

import { useMemo, useState } from "react";
import { useConvex, useQuery } from "convex/react";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { EmptyState, LoadingRows } from "@/components/ui/page-state";
import { Row } from "@/components/ui/row";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { plainText } from "../../../../shared/semantic-chunks";
import type { SchoolSyncKind } from "../../../../shared/school-sync";
import { fetchSpectraSchoolFile } from "../data/api";
import { useAuthedArgs } from "../data/use-authed-args";
import { handOffToLibrary } from "../workbench/library-handoff";
import { SchoolFileViewer, schoolFileKind, type ViewedSchoolFile } from "./school-file-viewer";
import {
  dateLabel,
  dueLabel,
  groupCurrentTasks,
  groupPastTasks,
  sentenceOf,
  sizeLabel,
  taskMatches,
  type SchoolPreferences,
  type SchoolTask,
  type SchoolTaskDetail,
} from "./school-model";

export type TaskView = "current" | "past" | "all";

/** A Row that opens something: pressable from the keyboard, and the shape what opens grows from. */
export function pressable(onPress: () => void) {
  return {
    role: "button",
    tabIndex: 0,
    "data-life-launch": "",
    onClick: onPress,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onPress();
    },
  } as const;
}

export function SectionHeading({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h3 className="mb-1 mt-6 flex items-baseline gap-2 px-2.5 text-micro font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)] first:mt-0">
      {children}
      {count ? <span className="font-normal normal-case tracking-normal">{count}</span> : null}
    </h3>
  );
}

export function TaskRow({ task, now, selected, onSelect }: { task: SchoolTask; now: number; selected: boolean; onSelect: () => void }) {
  const meta = [task.className, task.past ? (task.dueAt ? dateLabel(task.dueAt, now) : null) : dueLabel(task.dueAt, now), task.status]
    .filter(Boolean)
    .join(" · ");
  const overdue = !task.past && task.dueAt !== null && task.dueAt < now;
  return (
    <Row
      data-school-task={task.recordId}
      lifeKey={`school-task:${task.recordId}`}
      glyph="task"
      accent={overdue ? "var(--danger)" : task.past ? "var(--text-tertiary)" : "var(--warning)"}
      title={task.title}
      meta={meta || undefined}
      selected={selected}
      aria-pressed={selected}
      {...pressable(onSelect)}
    />
  );
}

export function TasksSection({
  now,
  view,
  onViewChange,
  selectedId,
  onSelect,
  preferences,
  onSync,
  syncing,
  onOpenSync,
}: {
  now: number;
  view: TaskView;
  onViewChange: (view: TaskView) => void;
  selectedId: string | null;
  onSelect: (recordId: string) => void;
  preferences: SchoolPreferences | undefined;
  onSync: (kind?: SchoolSyncKind) => void;
  syncing: boolean;
  onOpenSync: () => void;
}) {
  const [query, setQuery] = useState("");
  const [classId, setClassId] = useState("all");
  const tasks = useQuery(api.school.tasks, useAuthedArgs({ view, ...(classId !== "all" ? { providerClassId: classId } : {}) }));
  const classes = useQuery(api.school.classes, useAuthedArgs({}));
  const visible = useMemo(() => (tasks?.tasks ?? []).filter((task) => taskMatches(task, query)), [query, tasks]);
  const current = useMemo(() => groupCurrentTasks(visible.filter((task) => !task.past), now), [now, visible]);
  const past = useMemo(() => groupPastTasks(visible.filter((task) => task.past)), [visible]);
  const pastMode = preferences?.kinds.find((kind) => kind.kind === "past_tasks")?.mode;
  const currentMode = preferences?.kinds.find((kind) => kind.kind === "current_tasks")?.mode;

  const classOptions = [
    { value: "all", label: "All classes" },
    ...(classes?.classes ?? []).map((item) => ({ value: item.providerClassId, label: item.title })),
  ];

  function empty() {
    if (query.trim()) return <EmptyState compact icon="search" title="No tasks match" detail="Try fewer words, or another class." action={<Button size="sm" onClick={() => setQuery("")}>Clear search</Button>} />;
    const mode = view === "past" ? pastMode : currentMode;
    const label = view === "past" ? "Past tasks" : "Current tasks";
    if (mode === "off")
      return (
        <EmptyState
          compact
          icon="task"
          title={`${label} are off`}
          detail="Turn them on in Sync to see them here."
          action={<Button size="sm" onClick={onOpenSync}>Open Sync</Button>}
        />
      );
    return (
      <EmptyState
        compact
        icon="task"
        title={view === "past" ? "No past tasks yet" : view === "current" ? "Nothing due" : "No tasks yet"}
        detail={view === "past" ? "The first sync brings in your full history from ManageBac." : "New tasks from ManageBac show up here."}
        action={
          <Button size="sm" disabled={syncing} onClick={() => onSync(view === "past" ? "past_tasks" : view === "current" ? "current_tasks" : undefined)}>
            {syncing ? "Syncing" : "Sync now"}
          </Button>
        }
      />
    );
  }

  return (
    <section aria-label="Tasks" className="min-w-0">
      <div className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
        <Segmented
          label="Which tasks"
          value={view}
          onChange={onViewChange}
          options={[
            { value: "current", label: "Current" },
            { value: "past", label: "Past" },
            { value: "all", label: "All" },
          ]}
        />
        <SelectField ariaLabel="Class" size="sm" value={classId} onChange={setClassId} options={classOptions} triggerClassName="w-44" />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a task"
          aria-label="Find a task"
          className="h-8 w-48 min-w-0 flex-1 text-caption sm:max-w-64"
        />
      </div>
      {tasks === undefined ? (
        <LoadingRows label="Loading tasks" count={6} />
      ) : !visible.length ? (
        empty()
      ) : (
        <div className="-mx-2.5">
          {current.map((group) => (
            <div key={group.key}>
              <SectionHeading count={group.tasks.length}>{group.label}</SectionHeading>
              {group.tasks.map((task) => (
                <TaskRow key={task.recordId} task={task} now={now} selected={selectedId === task.recordId} onSelect={() => onSelect(task.recordId)} />
              ))}
            </div>
          ))}
          {past.map((group) => (
            <div key={group.key}>
              <SectionHeading>{group.className}</SectionHeading>
              {group.terms.map((term) => (
                <div key={term.term}>
                  {group.terms.length > 1 || term.term !== "No term" ? (
                    <p className="px-2.5 pb-0.5 pt-2 text-micro text-[var(--text-tertiary)]">{term.term}</p>
                  ) : null}
                  {term.tasks.map((task) => (
                    <TaskRow key={task.recordId} task={task} now={now} selected={selectedId === task.recordId} onSelect={() => onSelect(task.recordId)} />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ details */

function Prose({ text }: { text: string | null }) {
  const plain = text ? plainText(text) : "";
  if (!plain) return null;
  return <p className="whitespace-pre-line text-caption leading-5 text-[var(--text-secondary)]">{plain}</p>;
}

export function DetailHeading({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-1.5 mt-5 text-micro font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{children}</h4>;
}

type SubmittedFile = NonNullable<SchoolTaskDetail["submission"]>["files"][number];

export function TaskDetails({ recordId, now, onNotice }: { recordId: string; now: number; onNotice: (message: string) => void }) {
  const task = useQuery(api.school.task, useAuthedArgs({ recordId: recordId as Id<"externalRecords"> }));
  const convex = useConvex();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ViewedSchoolFile | null>(null);

  if (task === undefined) return <LoadingRows label="Loading the task" count={4} />;
  if (task === null)
    return (
      <EmptyState
        compact
        icon="task"
        title="This task isn't here any more"
        detail="It may have been removed in ManageBac, or its kind of data was turned off in Sync."
      />
    );
  const submission = task.submission;
  const viewedFile = viewing ? submission?.files.find((file) => file.providerFileId === viewing.key) : undefined;

  async function keptCopy(file: SubmittedFile) {
    if (!submission) throw new Error("Nothing was handed in for this task.");
    const schoolFileId =
      file.state === "cached" && file.schoolFileId
        ? file.schoolFileId
        : (await fetchSpectraSchoolFile({ submissionRecordId: submission.recordId, providerFileId: file.providerFileId })).schoolFileId;
    const kept = await convex.query(api.school.fileUrl, { schoolFileId: schoolFileId as Id<"schoolFiles"> });
    if (!kept?.url) throw new Error("This file isn't ready yet. Try again in a moment.");
    return { ...kept, url: kept.url };
  }

  async function openFile(file: SubmittedFile) {
    const kind = schoolFileKind(file.mimeType, file.filename);
    if (kind) {
      // Photos and PDFs open in Spectra; the viewer holds a ghost until the kept copy is ready.
      const key = file.providerFileId;
      setViewing({ key, filename: file.filename, kind });
      setBusy(`open:${key}`);
      try {
        const kept = await keptCopy(file);
        setViewing((current) => (current?.key === key ? { ...current, url: kept.url } : current));
      } catch (error) {
        setViewing((current) => (current?.key === key ? null : current));
        onNotice(sentenceOf(error, `${file.filename} didn't open. Try again.`));
      } finally {
        setBusy(null);
      }
      return;
    }
    // Spectra has no reader for this kind of file in place (Copy into Library makes it editable).
    // Opened now, while the press still counts, then pointed at the file.
    const opened = window.open("about:blank", "_blank");
    setBusy(`open:${file.providerFileId}`);
    try {
      const kept = await keptCopy(file);
      if (opened) opened.location.href = kept.url;
      else window.location.assign(kept.url);
    } catch (error) {
      opened?.close();
      onNotice(sentenceOf(error, `${file.filename} didn't open. Try again.`));
    } finally {
      setBusy(null);
    }
  }

  async function copyIntoLibrary(file: SubmittedFile) {
    setBusy(`copy:${file.providerFileId}`);
    try {
      const kept = await keptCopy(file);
      const response = await fetch(kept.url);
      if (!response.ok) throw new Error(`${file.filename} didn't download. Try again.`);
      const blob = await response.blob();
      handOffToLibrary(new File([blob], kept.filename, { type: kept.mimeType || blob.type }));
      onNotice(`Copying ${kept.filename} into your Library.`);
      router.push("/library");
    } catch (error) {
      onNotice(sentenceOf(error, `${file.filename} wasn't copied. Try again.`));
    } finally {
      setBusy(null);
    }
  }

  const facts = [
    task.className,
    task.past ? "Past task" : dueLabel(task.dueAt, now),
    task.taskType,
    task.status,
    task.term,
  ].filter(Boolean);

  return (
    <article aria-labelledby="school-task-title">
      <h3 id="school-task-title" data-artifact-title className="font-display text-title font-semibold leading-snug text-[var(--text-primary)]">
        {task.title}
      </h3>
      {facts.length ? <p className="mt-1 text-caption text-[var(--text-tertiary)]">{facts.join(" · ")}</p> : null}
      {task.provenanceUrl ? (
        <Button variant="ghost" size="sm" className="-ml-2.5 mt-2" asChild>
          <a href={task.provenanceUrl} target="_blank" rel="noreferrer">
            Open in ManageBac
          </a>
        </Button>
      ) : null}

      {task.brief ? (
        <>
          <DetailHeading>Brief</DetailHeading>
          <Prose text={task.brief} />
        </>
      ) : null}

      {task.grade ? (
        <>
          <DetailHeading>Grade</DetailHeading>
          <p className="text-ui font-semibold text-[var(--text-primary)]">
            {task.grade.score !== null && task.grade.maxScore !== null
              ? `${task.grade.score} / ${task.grade.maxScore}`
              : task.grade.label ?? (task.grade.score !== null ? String(task.grade.score) : "Graded")}
            {task.grade.label && task.grade.score !== null ? <span className="ml-2 font-normal text-[var(--text-secondary)]">{task.grade.label}</span> : null}
          </p>
          <div className="mt-1">
            <Prose text={task.grade.feedback} />
          </div>
        </>
      ) : null}

      <DetailHeading>What you handed in</DetailHeading>
      {!submission ? (
        <p className="text-caption text-[var(--text-secondary)]">{task.past ? "Nothing was handed in for this task." : "Nothing handed in yet."}</p>
      ) : !submission.files.length ? (
        <p className="text-caption text-[var(--text-secondary)]">
          {submission.submittedAt ? `Handed in ${dateLabel(submission.submittedAt, now)}, without files.` : "No files."}
        </p>
      ) : (
        <div className="-mx-2.5">
          {submission.files.map((file) => (
            <Row
              key={file.providerFileId}
              glyph={file.mimeType === "application/pdf" ? "pdf" : "document"}
              title={file.filename}
              meta={file.tooLarge ? "Too large to keep in Spectra (over 50 MB)" : [sizeLabel(file.bytes), file.state === "cached" ? "Kept in Spectra" : null].filter(Boolean).join(" · ") || undefined}
              actionsVisible
              actions={
                file.tooLarge ? null : (
                  <>
                    <IconButton
                      icon="openFull"
                      label={`Open ${file.filename}`}
                      size="compact"
                      disabled={busy !== null}
                      onClick={() => void openFile(file)}
                    />
                    <IconButton
                      icon="library"
                      label="Copy into Library"
                      size="compact"
                      disabled={busy !== null}
                      onClick={() => void copyIntoLibrary(file)}
                    />
                  </>
                )
              }
            />
          ))}
        </div>
      )}

      {task.resources.length ? (
        <>
          <DetailHeading>Resources</DetailHeading>
          <div className="-mx-2.5">
            {task.resources.map((resource) => (
              <Row
                key={resource.recordId}
                glyph="link"
                title={resource.title}
                meta={resource.forThisTask ? "For this task" : "For the class"}
                actionsVisible
                actions={
                  resource.url ? (
                    <IconButton
                      icon="external"
                      label={`Open ${resource.title}`}
                      size="compact"
                      onClick={() => window.open(resource.url!, "_blank", "noopener,noreferrer")}
                    />
                  ) : null
                }
              />
            ))}
          </div>
        </>
      ) : null}
      <SchoolFileViewer
        file={viewing}
        onClose={() => setViewing(null)}
        actions={
          viewedFile ? (
            <Button variant="ghost" disabled={busy !== null} onClick={() => void copyIntoLibrary(viewedFile)}>
              Copy into Library
            </Button>
          ) : null
        }
      />
    </article>
  );
}
