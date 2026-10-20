"use client";

import { useState } from "react";
import { useConvex, useQuery } from "convex/react";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import type { IconName } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { EmptyState, LoadingRows } from "@/components/ui/page-state";
import { Row } from "@/components/ui/row";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { plainText } from "../../../../shared/semantic-chunks";
import { fetchSpectraSchoolFile } from "../data/api";
import { useAuthedArgs } from "../data/use-authed-args";
import { FileViewer, type ViewedFile } from "../files/file-viewer";
import { fileViewKind, type FileViewKind } from "../files/file-kind";
import { handOffToLibrary } from "../workbench/library-handoff";
import { dateLabel, dueLabel, sentenceOf, sizeLabel, type SchoolTaskDetail } from "./school-model";
import { inkStyle, useClassBook } from "./use-class-book";

/*
 * A task, chosen: its class's ink across the head, the brief, the grade and
 * feedback, what was handed in (opened in Spectra or copied into the
 * Library) and the resources for it.
 */

function Prose({ text }: { text: string | null }) {
  const plain = text ? plainText(text) : "";
  if (!plain) return null;
  return <p className="whitespace-pre-line text-ui leading-6 text-[var(--text-primary)]">{plain}</p>;
}

export function DetailHeading({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-2 mt-6 font-display text-subhead font-medium text-[var(--text-primary)]">{children}</h4>;
}

type SubmittedFile = NonNullable<SchoolTaskDetail["submission"]>["files"][number];

const FILE_GLYPHS = { image: "image", pdf: "pdf", document: "document", slides: "slides", sheet: "sheet", legacy: "document" } as const satisfies Record<FileViewKind, IconName>;

export function TaskDetails({ recordId, now, onNotice }: { recordId: string; now: number; onNotice: (message: string) => void }) {
  const task = useQuery(api.school.task, useAuthedArgs({ recordId: recordId as Id<"externalRecords"> }));
  const convex = useConvex();
  const router = useRouter();
  const book = useClassBook();
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ViewedFile | null>(null);

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
    const kind = fileViewKind(file.mimeType, file.filename);
    if (kind) {
      // Photos, PDFs and Office files open in Spectra; the viewer holds a ghost
      // until the kept copy is ready. An older Office file opens to a line that
      // says why it can't show, with the same ways out.
      const key = file.providerFileId;
      setViewing({ key, filename: file.filename, kind, bytes: file.bytes ?? undefined });
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

  const identity = book.of(task.providerClassId ?? null, task.className);
  const facts = [task.past ? "Past task" : dueLabel(task.dueAt, now), task.taskType, task.status, task.term].filter(Boolean);

  return (
    <article aria-labelledby="school-task-title" style={inkStyle(identity)}>
      <header className="school-detail-head">
        {identity ? (
          <p className="school-ticket-class text-caption">
            <span aria-hidden className="school-class-dot" />
            {identity.name}
          </p>
        ) : null}
        <h3 id="school-task-title" data-artifact-title className="mt-1.5 font-display text-title font-semibold leading-snug text-[var(--text-primary)]">
          {task.title}
        </h3>
        {facts.length ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {facts.map((fact) => (
              <span key={fact} className="school-fact">
                {fact}
              </span>
            ))}
          </div>
        ) : null}
        {task.provenanceUrl ? (
          <Button variant="ghost" size="sm" className="-ml-2.5 mt-2" asChild>
            <a href={task.provenanceUrl} target="_blank" rel="noreferrer">
              Open in ManageBac
            </a>
          </Button>
        ) : null}
      </header>

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
              glyph={FILE_GLYPHS[fileViewKind(file.mimeType, file.filename) ?? "legacy"]}
              title={file.filename}
              meta={file.tooLarge ? "Too large to keep in Spectra (over 50 MB)" : [sizeLabel(file.bytes), file.state === "cached" ? "kept in Spectra" : null].filter(Boolean).join(", ") || undefined}
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
      <FileViewer
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
