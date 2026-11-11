"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Icon } from "@/components/icons";
import { LoaderCircle, Plus } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { blueprintChoices } from "../components/artifact-blueprint-sheet";
import { workTypeMeta } from "../artifacts/presentation";
import type { ArtifactTypeKey } from "../artifacts/types";

/*
 * Making an artifact (LIBRARY.md, "New"), in the same voice as adding to the
 * Calendar: name it, pick what kind of artifact it is, and see where it lands.
 * The place is the one the reader is standing in (CANON D43); it is said, not
 * asked. An empty name keeps the type's own ("New Quiz").
 */

const PLACEHOLDER: Partial<Record<ArtifactTypeKey, string>> = {
  document: "Essay plan, lab write-up, chapter notes",
  flashcard_deck: "Organic chemistry reactions, French verbs",
  quiz: "Waves and oscillations check",
  planner_task: "Hand in the history essay",
  agent: "Lab report reviewer",
  presentation: "Photosynthesis in five slides",
  sheets: "Pendulum period results",
  code: "Projectile simulator",
  whiteboard: "Cell cycle map",
};

export function ArtifactComposer({
  open,
  kind,
  place,
  onClose,
  onCreate,
}: {
  open: boolean;
  /** The kind the reader chose to start from; they can change it here. */
  kind: ArtifactTypeKey;
  /** Where it will land, as the reader would say it. */
  place: string;
  onClose: () => void;
  /** Makes it; a rejection keeps the composer open. */
  onCreate: (kind: ArtifactTypeKey, title: string) => Promise<void>;
}) {
  const [chosen, setChosen] = useState<ArtifactTypeKey>(kind);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChosen(kind);
    setTitle("");
  }, [open, kind]);

  const meta = workTypeMeta[chosen];
  const submit = () => {
    if (busy) return;
    setBusy(true);
    void onCreate(chosen, title.trim())
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
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="calendar-composer-head">
            <DialogTitle>New {meta.label.toLowerCase()}</DialogTitle>
          </div>
          <input
            autoFocus
            aria-label="Name"
            placeholder={PLACEHOLDER[chosen] ?? `New ${meta.label}`}
            value={title}
            maxLength={160}
            onChange={(event) => setTitle(event.target.value)}
            className="calendar-composer-title"
          />
          <div role="radiogroup" aria-label="Kind of artifact" className="work-composer-kinds">
            {blueprintChoices.map((choice) => {
              const look = workTypeMeta[choice.key];
              return (
                <button
                  key={choice.key}
                  type="button"
                  role="radio"
                  aria-checked={chosen === choice.key}
                  data-active={chosen === choice.key || undefined}
                  onClick={() => setChosen(choice.key)}
                  className="work-composer-kind"
                  style={{ "--kind-ink": look.color, "--kind-soft": look.soft } as CSSProperties}
                >
                  <span aria-hidden className="work-composer-kind-mark">
                    <Icon name={look.glyph} size={15} />
                  </span>
                  <span className="work-composer-kind-name">{look.label}</span>
                </button>
              );
            })}
          </div>
          <p className="calendar-composer-hint">
            {blueprintChoices.find((choice) => choice.key === chosen)?.description}
          </p>
          <p className="work-composer-place">
            <Icon name="folder" size={13} />
            <span className="min-w-0 truncate">Goes into {place}</span>
          </p>
          <DialogFooter className="mt-5">
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
