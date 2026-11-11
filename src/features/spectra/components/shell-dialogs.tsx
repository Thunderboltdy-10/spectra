"use client";

import { BookOpen, Loader2, BarChart3, CheckCircle2, GraduationCap, Trash2, Atom, Brain, Calculator, FlaskConical, NotebookOpen, Sprout } from "@/components/icons/glyph-icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { WORKSPACE_INKS, workspaceInk } from "../organization/node-identity";

/**
 * The shell's modal dialogs, one voice (ARCHITECTURE-PLATFORM §3).
 *
 * These were four hand-rolled overlays stacked at z-[90/94/95/96] inside the
 * workbench frame — sibling layers that forced the composer to z-index 220,
 * each with a bespoke scrim, bespoke buttons, and no focus trap. They are now
 * portalled through the Dialog primitive at the `modal` layer; copy and
 * behavior are unchanged. A shell dialog is never invented per call site
 * again: it lives here or it does not exist.
 */

/* The workspace icon vocabulary is shared with the new-workspace panel. */
export const workspaceIconChoices = [
  ["Sparkles", NotebookOpen],
  ["BookOpen", BookOpen],
  ["GraduationCap", GraduationCap],
  ["Atom", Atom],
  ["FlaskConical", FlaskConical],
  ["Calculator", Calculator],
  ["Brain", Brain],
  ["Sprout", Sprout],
  ["BarChart3", BarChart3],
] as const;

export function WorkspaceDeleteDialog({
  open,
  workspaceTitle,
  confirmation,
  onConfirmationChange,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  workspaceTitle: string;
  confirmation: string;
  onConfirmationChange: (value: string) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const requiredSentence = `Remove ${workspaceTitle} permanently`;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-[min(480px,calc(100vw-32px))] gap-0 p-5">
        <DialogTitle>Permanently remove {workspaceTitle}?</DialogTitle>
        <DialogDescription className="mt-2">
          This removes the workspace and its placements. Your work, threads, and AI run history remain available and are never deleted with their
          workspace.
        </DialogDescription>
        <div className="mt-4">
          <Field label={<TypeSentence sentence={requiredSentence} />}>
            <Input
              autoFocus
              aria-label="Workspace deletion confirmation"
              value={confirmation}
              onChange={(event) => onConfirmationChange(event.target.value)}
            />
          </Field>
        </div>
        <DialogFooter className="mt-4">
          <Button variant="secondary" size="md" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="md"
            disabled={confirmation !== requiredSentence || busy}
            onClick={onConfirm}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            Delete permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TypeSentence({ sentence }: { sentence: string }) {
  return (
    <>
      Type <span className="select-all font-mono font-medium">{sentence}</span>
    </>
  );
}

/** The colour a workspace carries through the Library and its rail. */
export function WorkspaceColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const current = workspaceInk(value);
  return (
    <>
      <span className="text-micro font-semibold text-[var(--text-tertiary)]">Colour</span>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Workspace colour">
        {WORKSPACE_INKS.map(([ink, label]) => (
          <button
            key={ink}
            type="button"
            role="radio"
            aria-checked={current === ink}
            aria-label={label}
            title={label}
            onClick={() => onChange(ink)}
            className="flex size-8 cursor-pointer items-center justify-center rounded-full border border-[var(--border-default)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)]"
            style={current === ink ? { borderColor: ink, boxShadow: `0 0 0 1px ${ink}` } : undefined}
          >
            <span className="size-5 rounded-full" style={{ background: ink }} />
          </button>
        ))}
      </div>
    </>
  );
}

export function WorkspaceEditDialog({
  open,
  icon,
  onIconChange,
  color,
  onColorChange,
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  isClass,
  onIsClassChange,
  busy,
  onCancel,
  onSave,
}: {
  open: boolean;
  icon: string;
  onIconChange: (key: string) => void;
  color: string;
  onColorChange: (color: string) => void;
  title: string;
  onTitleChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  /** A class shows its tasks and tells Spectra the work in it is for that class. */
  isClass: boolean;
  onIsClassChange: (value: boolean) => void;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-[min(430px,calc(100vw-32px))] gap-0 p-5">
        <DialogTitle>Edit workspace</DialogTitle>
        <div className="mt-4">
          <span className="text-caption font-semibold text-[var(--text-primary)]">
            Icon
          </span>
          <div
            className="mt-2 flex flex-wrap gap-2"
            role="radiogroup"
            aria-label="Workspace icon"
          >
            {workspaceIconChoices.map(([key, Icon]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={icon === key}
                onClick={() => onIconChange(key)}
                className={cn(
                  "flex size-10 items-center justify-center rounded-card border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]",
                  icon === key
                    ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_9%,var(--bg-primary))] text-[var(--accent-cyan)]"
                    : "border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
                )}
                aria-label={key}
              >
                <Icon className="size-4" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <WorkspaceColorPicker value={color} onChange={onColorChange} />
        </div>
        <div className="mt-4">
          <Field label="Workspace name">
            <Input
              autoFocus
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Description">
            <Textarea
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder="Short description"
              className="min-h-[84px] resize-none"
            />
          </Field>
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-caption font-semibold text-[var(--text-primary)]">A class</span>
            <span className="mt-0.5 block text-micro text-[var(--text-secondary)]">
              Its work is for one subject. Spectra reads it that way, and a class from School shows its tasks here.
            </span>
          </span>
          <Switch checked={isClass} onCheckedChange={onIsClassChange} className="mt-0.5" />
        </label>
        <DialogFooter className="mt-4">
          <Button variant="secondary" size="md" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={!title.trim() || busy}
            onClick={onSave}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TrashPurgeDialog({
  open,
  title,
  detail,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  detail: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title={title}
      detail={detail}
      confirmLabel="Delete forever"
      destructive
      pending={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export function ArtifactDeleteDialog({
  open,
  artifactTitle,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  artifactTitle: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title={`Delete ${artifactTitle}?`}
      detail="This work item, its placements, version history, and directly linked run history will be permanently removed."
      confirmLabel="Delete permanently"
      destructive
      pending={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
