"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SkillMetadata, SkillWithBody } from "../../skills/contracts";
import { USER_SKILL_LIMITS } from "../../skills/contracts";
import {
  deleteUserSkill,
  listUserSkills,
  readUserSkill,
} from "../../skills/client";

function LoadingSkills() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading AI skills"
      className="grid gap-3 lg:grid-cols-2"
    >
      {[0, 1].map((index) => (
        <div
          key={index}
          className="min-h-32 rounded-card border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4"
        >
          <div className="h-4 w-36 rounded-chip bg-[var(--border-subtle)]" />
          <div className="mt-3 h-3 w-full max-w-72 rounded-chip bg-[var(--border-subtle)]" />
          <div className="mt-2 h-3 w-48 rounded-chip bg-[var(--border-subtle)]" />
        </div>
      ))}
    </div>
  );
}

function SkillCard({
  skill,
  open,
  detail,
  detailBusy,
  confirmingDelete,
  deleting,
  onToggle,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  skill: SkillMetadata;
  open: boolean;
  detail?: SkillWithBody;
  detailBusy: boolean;
  confirmingDelete: boolean;
  deleting: boolean;
  onToggle: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="self-start rounded-card border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-ui font-semibold text-[var(--text-primary)]">
            {skill.name}
          </h3>
          <p className="mt-1 text-micro text-[var(--text-secondary)]">
            {skill.purpose}
          </p>
        </div>
        <span className="shrink-0 text-micro font-medium text-[var(--text-tertiary)]">
          Version {skill.version}
        </span>
      </div>
      <p className="mt-3 text-micro text-[var(--text-secondary)]">
        <span className="font-semibold text-[var(--text-primary)]">
          Used for:
        </span>{" "}
        {skill.triggerTerms.join(", ")}
      </p>
      {open ? (
        <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
          {detailBusy ? (
            <p
              className="text-micro text-[var(--text-secondary)]"
              role="status"
            >
              Loading the procedure...
            </p>
          ) : detail ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-sans text-micro text-[var(--text-primary)]">
              {detail.body}
            </pre>
          ) : (
            <p
              className="text-micro text-[var(--text-secondary)]"
              role="status"
            >
              This procedure could not be opened. Try again.
            </p>
          )}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onToggle}>
          {open ? "Hide procedure" : "View procedure"}
        </Button>
        {confirmingDelete ? (
          <>
            <span className="mr-auto text-micro text-[var(--text-secondary)]">
              Delete this skill?
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={deleting}
              onClick={onCancelDelete}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={deleting}
              onClick={onDelete}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={onAskDelete}>
            Delete
          </Button>
        )}
      </div>
    </article>
  );
}

export function UserSkillsSettings() {
  const [skills, setSkills] = useState<SkillMetadata[]>([]);
  const [details, setDetails] = useState<Record<string, SkillWithBody>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailBusyId, setDetailBusyId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSkills(await listUserSkills());
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Skills are unavailable right now.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(skillId: string) {
    if (openId === skillId) {
      setOpenId(null);
      return;
    }
    setOpenId(skillId);
    if (details[skillId]) return;
    setDetailBusyId(skillId);
    try {
      const detail = await readUserSkill(skillId);
      setDetails((current) => ({ ...current, [skillId]: detail }));
    } catch {
      setDetails((current) => {
        const next = { ...current };
        delete next[skillId];
        return next;
      });
    } finally {
      setDetailBusyId(null);
    }
  }

  async function remove(skillId: string) {
    setDeletingId(skillId);
    setError(null);
    try {
      await deleteUserSkill(skillId);
      setSkills((current) => current.filter((skill) => skill.id !== skillId));
      setOpenId((current) => (current === skillId ? null : current));
      setConfirmingDeleteId(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "That skill could not be deleted. Try again.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <LoadingSkills />;
  return (
    <div>
      <div className="mb-4 flex min-h-8 items-center justify-between gap-4">
        <p className="text-micro text-[var(--text-secondary)]">
          {skills.length} of {USER_SKILL_LIMITS.activePerAccount} active skills
        </p>
        {error ? (
          <Button size="sm" variant="secondary" onClick={() => void load()}>
            Try again
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="mb-4 text-micro text-[var(--text-primary)]" role="status">
          {error}
        </p>
      ) : null}
      {skills.length === 0 && !error ? (
        <div className="rounded-card border border-[var(--border-subtle)] px-5 py-8">
          <h3 className="text-ui font-semibold text-[var(--text-primary)]">
            No personal skills yet
          </h3>
          <p className="mt-1 max-w-xl text-micro text-[var(--text-secondary)]">
            Ask Spectra to make a reusable procedure for work you do often. You
            will approve the first one before it is saved.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              open={openId === skill.id}
              detail={details[skill.id]}
              detailBusy={detailBusyId === skill.id}
              confirmingDelete={confirmingDeleteId === skill.id}
              deleting={deletingId === skill.id}
              onToggle={() => void toggle(skill.id)}
              onAskDelete={() => setConfirmingDeleteId(skill.id)}
              onCancelDelete={() => setConfirmingDeleteId(null)}
              onDelete={() => void remove(skill.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
