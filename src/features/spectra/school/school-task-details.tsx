"use client";

import { useState } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import type { IconName } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Row } from "@/components/ui/row";
import { toast } from "@/components/ui/toast";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { plainText } from "../../../../shared/semantic-chunks";
import { fetchSpectraSchoolFile } from "../data/api";
import { FileViewer, type ViewedFile } from "../files/file-viewer";
import { fileViewKind, type FileViewKind } from "../files/file-kind";
import { handOffToLibrary } from "../workbench/library-handoff";
import { dateLabel, sentenceOf, sizeLabel, type SchoolTaskDetail } from "./school-model";
import { useClassBook } from "./use-class-book";

/*
 * What a school task's work adds from ManageBac, below the task itself: the
 * notice that it was set there (and where to open it), then the grade and
 * feedback, what was handed in (opened in Spectra or copied into the
 * Library) and the resources for it. The title, the day and the brief are
 * the task's own, so they are not said twice.
 */

function Prose({ text }: { text: string | null }) {
  const plain = text ? plainText(text) : "";
  if (!plain) return null;
  return <p className="max-w-[62ch] whitespace-pre-line text-ui leading-[1.65] text-[var(--text-primary)]">{plain}</p>;
}

export function DetailHeading({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-2 font-display text-subhead font-medium text-[var(--text-primary)]">{children}</h4>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="sheet-section" aria-label={title}>
      <header className="sheet-section-head">
        <h3>{title}</h3>
      </header>
      {children}
    </section>
  );
}

type SubmittedFile = NonNullable<SchoolTaskDetail["submission"]>["files"][number];

const FILE_GLYPHS = { image: "image", pdf: "pdf", document: "document", slides: "slides", sheet: "sheet", legacy: "document" } as const satisfies Record<FileViewKind, IconName>;

/** The ManageBac side of a school task's work; nothing for a task of the student's own. */
export function SchoolTaskNotice({ artifactId }: { artifactId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const task = useQuery(api.school.taskOfWork, isAuthenticated ? { artifactId: artifactId as Id<"spectraArtifacts"> } : "skip");
  const convex = useConvex();
  const router = useRouter();
  const book = useClassBook();
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ViewedFile | null>(null);
  const now = Date.now();

  if (!task) return null;
  const submission = task.submission;
  const viewedFile = viewing ? submission?.files.find((file) => file.providerFileId === viewing.key) : undefined;
  const grade = task.grade;

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
      // until the kept copy is ready.
      const key = file.providerFileId;
      setViewing({ key, filename: file.filename, kind, bytes: file.bytes ?? undefined });
      setBusy(`open:${key}`);
      try {
        const kept = await keptCopy(file);
        setViewing((current) => (current?.key === key ? { ...current, url: kept.url } : current));
      } catch (error) {
        setViewing((current) => (current?.key === key ? null : current));
        toast.error(sentenceOf(error, `${file.filename} didn't open. Try again.`));
      } finally {
        setBusy(null);
      }
      return;
    }
    // Spectra has no reader for this kind of file: opened now, while the press still counts.
    const opened = window.open("about:blank", "_blank");
    setBusy(`open:${file.providerFileId}`);
    try {
      const kept = await keptCopy(file);
      if (opened) opened.location.href = kept.url;
      else window.location.assign(kept.url);
    } catch (error) {
      opened?.close();
      toast.error(sentenceOf(error, `${file.filename} didn't open. Try again.`));
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
      toast.info(`Copying ${kept.filename} into your Library.`);
      router.push("/library");
    } catch (error) {
      toast.error(sentenceOf(error, `${file.filename} wasn't copied. Try again.`));
    } finally {
      setBusy(null);
    }
  }

  const about = [book.of(task.providerClassId ?? null, task.className)?.name, task.taskType, task.status].filter(Boolean).join(", ");

  return (
    <>
      <p className="task-school-notice">
        <span>
          Set in ManageBac{about ? ` (${about})` : ""}. Moving it in the Calendar gives you your own time for it; your teacher&apos;s date stays as they set it.
        </span>
        {task.provenanceUrl ? (
          <a href={task.provenanceUrl} target="_blank" rel="noreferrer">
            Open in ManageBac
          </a>
        ) : null}
      </p>

      {grade ? (
        <Section title="Grade">
          <p className="flex items-baseline gap-3">
            <span className="font-display text-title leading-none text-[var(--text-primary)] [font-variant-numeric:lining-nums]">
              {grade.score !== null && grade.maxScore !== null
                ? `${grade.score} / ${grade.maxScore}`
                : grade.label ?? (grade.score !== null ? String(grade.score) : "Graded")}
            </span>
            {grade.label && grade.score !== null ? <span className="text-ui text-[var(--text-secondary)]">{grade.label}</span> : null}
          </p>
          <Prose text={grade.feedback} />
        </Section>
      ) : null}

      <Section title="What you handed in">
        {!submission ? (
          <p className="text-caption text-[var(--text-secondary)]">{task.past ? "Nothing was handed in for this task." : "Nothing handed in yet. Hand it in on ManageBac."}</p>
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
                      <IconButton icon="openFull" label={`Open ${file.filename}`} size="compact" disabled={busy !== null} onClick={() => void openFile(file)} />
                      <IconButton icon="library" label="Copy into Library" size="compact" disabled={busy !== null} onClick={() => void copyIntoLibrary(file)} />
                    </>
                  )
                }
              />
            ))}
          </div>
        )}
      </Section>

      {task.resources.length ? (
        <Section title="Resources">
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
                    <IconButton icon="external" label={`Open ${resource.title}`} size="compact" onClick={() => window.open(resource.url!, "_blank", "noopener,noreferrer")} />
                  ) : null
                }
              />
            ))}
          </div>
        </Section>
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
    </>
  );
}
