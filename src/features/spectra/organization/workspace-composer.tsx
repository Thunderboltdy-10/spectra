"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { LoaderCircle, Plus } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { SYLLABUS_CATALOG } from "../../../../shared/syllabus/catalog.generated";
import { WorkspaceColorPicker, workspaceIconChoices } from "../components/shell-dialogs";
import { WORKSPACE_INKS } from "./node-identity";

/*
 * Making a workspace, in the same voice as making an artifact: name it, say
 * what it is for, give it a look, and, for a course, pick the syllabus it
 * follows. The syllabus arrives as the workspace's first artifact, read-only.
 */

export type WorkspaceDraft = {
  title: string;
  description?: string;
  icon: string;
  color: string;
  syllabusId?: string;
  syllabusLevel?: "SL" | "HL";
};

export function WorkspaceComposer({
  open,
  place,
  onClose,
  onCreate,
}: {
  open: boolean;
  /** Where it will land, when that is somewhere other than the Library's top. */
  place?: string;
  onClose: () => void;
  /** Makes it; a rejection keeps the composer open. */
  onCreate: (draft: WorkspaceDraft) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("Sparkles");
  const [color, setColor] = useState<string>(WORKSPACE_INKS[0][0]);
  const [syllabusId, setSyllabusId] = useState("");
  const [level, setLevel] = useState<"SL" | "HL" | "">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setIcon("Sparkles");
    setColor(WORKSPACE_INKS[0][0]);
    setSyllabusId("");
    setLevel("");
  }, [open]);

  const syllabus = useMemo(() => SYLLABUS_CATALOG.find((entry) => entry.id === syllabusId), [syllabusId]);
  const groups = useMemo(() => {
    const byGroup = new Map<string, typeof SYLLABUS_CATALOG[number][]>();
    for (const entry of SYLLABUS_CATALOG) {
      const key = entry.group ?? "";
      byGroup.set(key, [...(byGroup.get(key) ?? []), entry]);
    }
    return [...byGroup.entries()];
  }, []);

  const chooseSyllabus = (id: string) => {
    setSyllabusId(id);
    const entry = SYLLABUS_CATALOG.find((item) => item.id === id);
    setLevel(entry && entry.levels.length === 1 ? entry.levels[0]! : "");
    // A course workspace is usually named for its course.
    if (entry && !title.trim()) setTitle(entry.title);
    if (entry) setIcon((current) => (current === "Sparkles" ? "GraduationCap" : current));
  };

  const needsLevel = Boolean(syllabus && syllabus.levels.length > 1 && !level);
  const submit = () => {
    if (busy || !title.trim() || needsLevel) return;
    setBusy(true);
    void onCreate({
      title: title.trim(),
      description: description.trim() || undefined,
      icon,
      color,
      ...(syllabus ? { syllabusId: syllabus.id, ...(level ? { syllabusLevel: level } : {}) } : {}),
    })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="work-composer max-w-[520px] gap-0 p-5">
        <form
          // A long syllabus title must not widen the dialog past its edge.
          className="min-w-0"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="calendar-composer-head">
            <DialogTitle>New workspace</DialogTitle>
          </div>
          <input
            autoFocus
            aria-label="Workspace name"
            placeholder="Physics HL, Extended Essay, Robotics club"
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            className="calendar-composer-title"
          />
          <textarea
            aria-label="Workspace description"
            placeholder="What it is for (optional)"
            value={description}
            maxLength={2000}
            rows={2}
            onChange={(event) => setDescription(event.target.value)}
            className="workspace-composer-notes"
          />

          {SYLLABUS_CATALOG.length ? (
            <div className="workspace-composer-row">
              <label className="workspace-composer-label" htmlFor="workspace-composer-syllabus">
                Syllabus
              </label>
              <div className="workspace-composer-syllabus">
                <select
                  id="workspace-composer-syllabus"
                  value={syllabusId}
                  onChange={(event) => chooseSyllabus(event.target.value)}
                  className="workspace-composer-select"
                >
                  <option value="">None</option>
                  {groups.map(([group, entries]) =>
                    group ? (
                      <optgroup key={group} label={group}>
                        {entries.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.title}
                          </option>
                        ))}
                      </optgroup>
                    ) : (
                      entries.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.title}
                        </option>
                      ))
                    ),
                  )}
                </select>
                {syllabus && syllabus.levels.length > 1 ? (
                  <div role="radiogroup" aria-label="Level" className="workspace-composer-levels">
                    {syllabus.levels.map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={level === option}
                        data-active={level === option || undefined}
                        onClick={() => setLevel(option)}
                        className="workspace-composer-level"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {syllabus ? (
            <p className="calendar-composer-hint">
              {needsLevel
                ? "Pick SL or HL so the syllabus shows the right topics."
                : "The syllabus becomes this workspace's first artifact, read-only, and Spectra plans against it."}
            </p>
          ) : null}

          <div className="workspace-composer-row">
            <span className="workspace-composer-label">Icon</span>
            <div className="workspace-composer-icons" role="radiogroup" aria-label="Workspace icon">
              {workspaceIconChoices.map(([key, Glyph]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={icon === key}
                  aria-label={key}
                  data-active={icon === key || undefined}
                  onClick={() => setIcon(key)}
                  className="workspace-composer-icon"
                >
                  <Glyph className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>
          <div className="workspace-composer-row">
            <WorkspaceColorPicker value={color} onChange={setColor} />
          </div>
          {place ? (
            <p className="work-composer-place">
              <Icon name="folder" size={13} />
              <span className="min-w-0 truncate">Goes into {place}</span>
            </p>
          ) : null}
          <DialogFooter className="mt-5">
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={busy || !title.trim() || needsLevel}>
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
