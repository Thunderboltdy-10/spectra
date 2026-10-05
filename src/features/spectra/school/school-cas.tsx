"use client";

import { useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { EmptyState, LoadingRows } from "@/components/ui/page-state";
import { Row } from "@/components/ui/row";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useLifeArrival } from "../life/use-life";
import { useAuthedArgs } from "../data/use-authed-args";
import { dateLabel, sentenceOf, sizeLabel, strands, type SchoolExperience, type SchoolExperienceDetail, type SchoolPreferences } from "./school-model";
import { DetailHeading, SectionHeading, pressable } from "./school-tasks";

function experienceMeta(experience: SchoolExperience, now: number) {
  const when = experience.startsAt
    ? experience.endsAt
      ? `${dateLabel(experience.startsAt, now)} to ${dateLabel(experience.endsAt, now)}`
      : `From ${dateLabel(experience.startsAt, now)}`
    : null;
  const reflections = experience.reflectionCount ? `${experience.reflectionCount} reflection${experience.reflectionCount === 1 ? "" : "s"}` : null;
  return [strands(experience.types).join(", ") || null, when, experience.status, reflections].filter(Boolean).join(" · ");
}

export function CasSection({
  now,
  selectedId,
  onSelect,
  preferences,
  onSync,
  syncing,
  onOpenSync,
}: {
  now: number;
  selectedId: string | null;
  onSelect: (recordId: string) => void;
  preferences: SchoolPreferences | undefined;
  onSync: () => void;
  syncing: boolean;
  onOpenSync: () => void;
}) {
  const cas = useQuery(api.school.cas, useAuthedArgs({}));
  const mode = preferences?.kinds.find((kind) => kind.kind === "cas")?.mode;
  if (cas === undefined) return <LoadingRows label="Loading CAS" count={5} />;
  const covered = cas.outcomeCoverage.filter((outcome) => !outcome.missing).length;

  return (
    <section aria-label="CAS" className="min-w-0">
      {!cas.writeBack.reflections.supported ? (
        <p className="mb-5 flex max-w-2xl items-start gap-2 text-caption leading-5 text-[var(--text-secondary)]">
          <Icon name="info" size={16} className="mt-0.5 shrink-0" />
          {cas.writeBack.reflections.reason}
        </p>
      ) : null}

      <SectionHeading>
        Learning outcomes
        <span className="font-normal normal-case tracking-normal">{covered} of {cas.outcomeCoverage.length} met</span>
      </SectionHeading>
      <ol className="mb-2 grid gap-x-6 gap-y-1 sm:grid-cols-2" aria-label="Learning outcomes">
        {cas.outcomeCoverage.map((outcome) => (
          <li key={outcome.id} className="flex min-h-8 items-center gap-2 text-caption">
            <span className="grid size-5 shrink-0 place-items-center">
              <Icon name={outcome.missing ? "pending" : "done"} size={16} accent={outcome.missing ? "var(--warning)" : "var(--success)"} />
            </span>
            <span className={cn("min-w-0 flex-1 truncate", outcome.missing ? "text-[var(--text-secondary)]" : "text-[var(--text-primary)]")}>
              {outcome.id}. {outcome.label}
            </span>
            <span className="shrink-0 text-micro text-[var(--text-tertiary)]">
              {outcome.missing ? "Not yet" : `${outcome.experienceIds.length} experience${outcome.experienceIds.length === 1 ? "" : "s"}`}
            </span>
          </li>
        ))}
      </ol>

      <SectionHeading count={cas.experiences.length}>Experiences</SectionHeading>
      {!cas.experiences.length ? (
        mode === "off" ? (
          <EmptyState compact icon="cas" title="CAS is off" detail="Turn it on in Sync to bring in your experiences." action={<Button size="sm" onClick={onOpenSync}>Open Sync</Button>} />
        ) : (
          <EmptyState
            compact
            icon="cas"
            title="No CAS experiences yet"
            detail="Sync CAS to bring in the experiences you have in ManageBac."
            action={<Button size="sm" disabled={syncing} onClick={onSync}>{syncing ? "Syncing" : "Sync CAS"}</Button>}
          />
        )
      ) : (
        <div className="-mx-2.5">
          {cas.experiences.map((experience) => (
            <Row
              key={experience.recordId}
              glyph="cas"
              accent="var(--accent-mint)"
              title={experience.isProject ? `${experience.title} (CAS project)` : experience.title}
              meta={experienceMeta(experience, now) || undefined}
              selected={selectedId === experience.recordId}
              aria-pressed={selectedId === experience.recordId}
              {...pressable(() => onSelect(experience.recordId))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ details */

type Reflection = SchoolExperienceDetail["reflections"][number];

function ReflectionItem({
  reflection,
  now,
  editing,
  onEdit,
  onDelete,
}: {
  reflection: Reflection;
  now: number;
  editing: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  // Written here just now: it forms from the Save press.
  useLifeArrival(ref, `reflection:${reflection.reflectionId}`, "human");
  return (
    <li ref={ref} className={cn("group/reflection rounded-control px-2.5 py-2", editing && "bg-[var(--bg-hover)]")}>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-micro text-[var(--text-tertiary)]">
          {dateLabel(reflection.createdAt, now)}
          {reflection.updatedAt > reflection.createdAt + 60_000 ? " · edited" : ""}
        </p>
        <IconButton icon="edit" label="Edit reflection" size="compact" onClick={onEdit} />
        <IconButton icon="trash" label="Delete reflection" size="compact" onClick={onDelete} />
      </div>
      <p className="mt-1 whitespace-pre-line text-caption leading-5 text-[var(--text-primary)]">{reflection.body}</p>
    </li>
  );
}

export function ExperienceDetails({ recordId, now, onNotice }: { recordId: string; now: number; onNotice: (message: string) => void }) {
  const experience = useQuery(api.school.casExperience, useAuthedArgs({ recordId: recordId as Id<"externalRecords"> }));
  const cas = useQuery(api.school.cas, useAuthedArgs({}));
  const convex = useConvex();
  const saveReflection = useMutation(api.school.saveCasReflection);
  const deleteReflection = useMutation(api.school.deleteCasReflection);
  const setOutcomes = useMutation(api.school.setCasOutcomes);
  const beginUpload = useMutation(api.school.beginCasEvidenceUpload);
  const attachEvidence = useMutation(api.school.attachCasEvidence);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<Reflection | null>(null);
  const [removing, setRemoving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  if (experience === undefined) return <LoadingRows label="Loading the experience" count={4} />;
  if (experience === null)
    return <EmptyState compact icon="cas" title="This experience isn't here any more" detail="It may have been removed in ManageBac, or CAS was turned off in Sync." />;

  const outcomes = cas?.learningOutcomes ?? [];
  const chosen = new Set(experience.outcomes);

  async function toggleOutcome(id: number) {
    const next = chosen.has(id) ? [...chosen].filter((value) => value !== id) : [...chosen, id];
    try {
      await setOutcomes({ experienceRecordId: recordId as Id<"externalRecords">, outcomes: next });
    } catch (error) {
      onNotice(sentenceOf(error, "That outcome wasn't saved. Try again."));
    }
  }

  async function save() {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await saveReflection({
        experienceRecordId: recordId as Id<"externalRecords">,
        ...(editingId ? { reflectionId: editingId as Id<"casReflections"> } : {}),
        body: draft,
      });
      setDraft("");
      setEditingId(null);
      onNotice(editingId ? "Reflection updated." : "Reflection saved in Spectra.");
    } catch (error) {
      onNotice(sentenceOf(error, "Your reflection wasn't saved. Try again."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setRemoving(true);
    try {
      await deleteReflection({ reflectionId: deleting.reflectionId as Id<"casReflections"> });
      if (editingId === deleting.reflectionId) {
        setEditingId(null);
        setDraft("");
      }
    } catch (error) {
      onNotice(sentenceOf(error, "That reflection wasn't deleted. Try again."));
    } finally {
      setRemoving(false);
      setDeleting(null);
    }
  }

  async function addEvidence(file: File) {
    setUploading(true);
    try {
      const { uploadUrl, maxBytes } = await beginUpload({ experienceRecordId: recordId as Id<"externalRecords"> });
      if (file.size > maxBytes) throw new Error("This file is larger than Spectra keeps (50 MB).");
      const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!response.ok) throw new Error(`${file.name} didn't upload. Try again.`);
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
      await attachEvidence({ experienceRecordId: recordId as Id<"externalRecords">, storageId, filename: file.name, mimeType: file.type || "application/octet-stream" });
      onNotice(`${file.name} added as evidence.`);
    } catch (error) {
      onNotice(sentenceOf(error, `${file.name} wasn't added. Try again.`));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function openEvidence(schoolFileId: string, filename: string) {
    const opened = window.open("about:blank", "_blank");
    try {
      const kept = await convex.query(api.school.fileUrl, { schoolFileId: schoolFileId as Id<"schoolFiles"> });
      if (!kept?.url) throw new Error(`${filename} isn't available right now.`);
      if (opened) opened.location.href = kept.url;
      else window.location.assign(kept.url);
    } catch (error) {
      opened?.close();
      onNotice(sentenceOf(error, `${filename} didn't open. Try again.`));
    }
  }

  const facts = [strands(experience.types).join(", ") || null, experience.status, experience.supervisor ? `Supervised by ${experience.supervisor}` : null].filter(Boolean);

  return (
    <article aria-labelledby="school-experience-title">
      <h3 id="school-experience-title" data-artifact-title className="font-display text-title font-semibold leading-snug text-[var(--text-primary)]">
        {experience.title}
      </h3>
      {facts.length ? <p className="mt-1 text-caption text-[var(--text-tertiary)]">{facts.join(" · ")}</p> : null}
      {experience.startsAt ? (
        <p className="text-caption text-[var(--text-tertiary)]">
          {dateLabel(experience.startsAt, now)}
          {experience.endsAt ? ` to ${dateLabel(experience.endsAt, now)}` : " onwards"}
        </p>
      ) : null}
      {experience.description ? <p className="mt-3 whitespace-pre-line text-caption leading-5 text-[var(--text-secondary)]">{experience.description}</p> : null}

      <DetailHeading>Learning outcomes it meets</DetailHeading>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Learning outcomes it meets">
        {outcomes.map((outcome) => {
          const on = chosen.has(outcome.id);
          return (
            <Button
              key={outcome.id}
              size="sm"
              variant={on ? "secondary" : "ghost"}
              aria-pressed={on}
              title={outcome.description}
              onClick={() => void toggleOutcome(outcome.id)}
              className={cn(!on && "border-[var(--border-subtle)]")}
            >
              {on ? <Icon name="check" size={14} /> : null}
              {outcome.id}. {outcome.label}
            </Button>
          );
        })}
      </div>

      <DetailHeading>Reflections</DetailHeading>
      {experience.reflections.length ? (
        <ol className="-mx-2.5 mb-3 space-y-1">
          {experience.reflections.map((reflection) => (
            <ReflectionItem
              key={reflection.reflectionId}
              reflection={reflection}
              now={now}
              editing={editingId === reflection.reflectionId}
              onEdit={() => {
                setEditingId(reflection.reflectionId);
                setDraft(reflection.body);
              }}
              onDelete={() => setDeleting(reflection)}
            />
          ))}
        </ol>
      ) : (
        <p className="mb-3 text-caption text-[var(--text-secondary)]">No reflections yet. What did you do, and what did you learn?</p>
      )}
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-label={editingId ? "Edit reflection" : "New reflection"}
        placeholder="Write a reflection"
        className="min-h-24 text-caption"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={saving || !draft.trim()} onClick={() => void save()}>
          {saving ? "Saving" : editingId ? "Save changes" : "Save reflection"}
        </Button>
        {editingId ? (
          <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setDraft(""); }}>
            Cancel
          </Button>
        ) : null}
      </div>
      {!experience.writeBack.reflections.supported ? (
        <p className="mt-2 text-micro text-[var(--text-tertiary)]">{experience.writeBack.reflections.reason}</p>
      ) : null}

      <DetailHeading>Evidence</DetailHeading>
      {experience.evidence.length ? (
        <div className="-mx-2.5 mb-2">
          {experience.evidence.map((file) => (
            <Row
              key={file.schoolFileId}
              glyph={file.mimeType.startsWith("image/") ? "image" : "document"}
              title={file.filename}
              meta={sizeLabel(file.bytes) ?? undefined}
              actionsVisible
              actions={<IconButton icon="openFull" label={`Open ${file.filename}`} size="compact" onClick={() => void openEvidence(file.schoolFileId, file.filename)} />}
            />
          ))}
        </div>
      ) : (
        <p className="mb-2 text-caption text-[var(--text-secondary)]">Photos and files that show what you did.</p>
      )}
      <input
        ref={fileInput}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void addEvidence(file);
        }}
      />
      <Button size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
        <Icon name="upload" size={16} />
        {uploading ? "Adding" : "Add evidence"}
      </Button>
      {!experience.writeBack.evidence.supported ? <p className="mt-2 text-micro text-[var(--text-tertiary)]">{experience.writeBack.evidence.reason}</p> : null}

      <ConfirmDialog
        open={deleting !== null}
        pending={removing}
        destructive
        title="Delete this reflection?"
        detail="It's kept only in Spectra, so it can't be brought back."
        confirmLabel="Delete"
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </article>
  );
}
