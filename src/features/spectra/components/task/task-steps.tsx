"use client";

import { useState } from "react";
import { Plus, X } from "@/components/icons/glyph-icons";
import { uniqueToken } from "@/lib/unique-token";

/*
 * A checklist inside a task (EDITORS.md, "Planner task"), for a task with a few
 * things to tick off. It appears only once someone wants it; then there is always a line at the bottom to type
 * the next one, and Enter keeps going, so breaking a task down is typing, not
 * pressing Add each time. A thin rule fills as steps are ticked.
 */

export type TaskStep = { id: string; title: string; done: boolean };

export function TaskSteps({ steps, canEdit, onChange }: { steps: TaskStep[]; canEdit: boolean; onChange: (steps: TaskStep[]) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const done = steps.filter((step) => step.done).length;

  if (!steps.length && !open)
    return canEdit ? (
      <button type="button" className="sheet-quiet" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" /> Add a checklist
      </button>
    ) : null;

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    onChange([...steps, { id: `subtask-${uniqueToken().slice(0, 8)}`, title: title.slice(0, 500), done: false }]);
    setDraft("");
  };
  const update = (id: string, patch: Partial<TaskStep>) => onChange(steps.map((step) => (step.id === id ? { ...step, ...patch } : step)));
  const remove = (id: string) => onChange(steps.filter((step) => step.id !== id));

  return (
    <section className="sheet-section" aria-label="Checklist">
      <header className="sheet-section-head">
        <h3>Checklist</h3>
        {steps.length ? (
          <span className="task-progress" aria-label={`${done} of ${steps.length} ticked off`}>
            <span className="task-progress-rule" style={{ ["--done" as string]: `${(done / steps.length) * 100}%` }} />
            {done} of {steps.length}
          </span>
        ) : null}
      </header>
      <ul className="task-steps">
        {steps.map((step) => (
          <li key={step.id} className="task-step" data-anchor-region={`task:subtask:${step.id}:title`} data-life-object="" data-life-done="" data-done={step.done || undefined}>
            <input type="checkbox" checked={step.done} disabled={!canEdit} aria-label={`${step.title || "Item"} done`} onChange={() => update(step.id, { done: !step.done })} />
            <input
              type="text"
              value={step.title}
              disabled={!canEdit}
              aria-label="Item"
              onChange={(event) => update(step.id, { title: event.target.value.slice(0, 500) })}
              onBlur={() => {
                if (!step.title.trim()) remove(step.id);
              }}
            />
            {canEdit ? (
              <button type="button" className="sheet-icon-button" aria-label="Remove item" title="Remove item" onClick={() => remove(step.id)}>
                <X className="size-3.5" />
              </button>
            ) : null}
          </li>
        ))}
        {canEdit ? (
          <li className="task-step task-step--new">
            <Plus className="size-3.5" aria-hidden />
            <input
              type="text"
              value={draft}
              autoFocus={!steps.length}
              placeholder={steps.length ? "Add another" : "First thing to tick off"}
              aria-label="New item"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                add();
                if (!steps.length && !draft.trim()) setOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
                if (event.key === "Escape") setDraft("");
              }}
            />
          </li>
        ) : null}
      </ul>
    </section>
  );
}
