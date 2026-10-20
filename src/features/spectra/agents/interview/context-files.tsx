"use client";

import { useState, type DragEvent, type RefObject } from "react";
import { AlertTriangle, Check, Loader2, ShieldAlert } from "@/components/icons/glyph-icons";
import { Icon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import type { EvidenceBinding } from "../foundry";

/*
 * What the agent reads: rubrics, guides, exemplars a creator hands it. Each is
 * a file the agent opens only when a request needs it, and cites when it does.
 * They sit as one row of names; pressing one shows what was read from it.
 */

export const CONTEXT_FILE_ACCEPT = ".txt,.md,.csv,.json,.pdf,.docx,text/plain,text/markdown,text/csv,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The kind of source a file most likely is, from its name; a reference document otherwise. */
export function guessSourceKind(name: string): EvidenceBinding["kind"] {
  const lower = name.toLowerCase();
  if (/rubric|mark ?scheme|markscheme|criteria|descriptor/.test(lower)) return "rubric";
  if (/policy|standard|guideline|guide|regulation|handbook/.test(lower)) return /handbook|manual/.test(lower) ? "manual" : "policy";
  if (/exemplar|example|sample|model answer/.test(lower)) return "accepted_example";
  if (/marked|annotated|feedback/.test(lower)) return "annotated_work";
  return "source_document";
}

/** A file's name as its label: no extension, separators read as spaces. */
export function labelFromFileName(name: string) {
  return name.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_-]+/g, " ").trim() || "Source";
}

function readSentence(binding: EvidenceBinding) {
  const extraction = binding.extraction;
  if (!extraction) return "Not read yet.";
  const parts = [
    [extraction.criteria.length, "criterion", "criteria"],
    [extraction.rules.length, "rule", "rules"],
    [extraction.examples.length, "example", "examples"],
    [extraction.edgeCases.length, "edge case", "edge cases"],
  ]
    .filter(([count]) => Number(count) > 0)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
  if (!parts.length) return "Nothing it can use was found in it.";
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `Read ${list}.`;
}

export function ContextFiles({
  bindings,
  canEdit,
  reading,
  inputRef,
  onFiles,
  onPaste,
  onRemove,
  onConfirm,
}: {
  bindings: readonly EvidenceBinding[];
  canEdit: boolean;
  /** The name of the file being read now. */
  reading: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onFiles: (files: File[]) => void;
  onPaste: () => void;
  onRemove: (bindingId: string) => void;
  onConfirm: (bindingId: string, confirmed: boolean) => void;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const selected = bindings.find((binding) => binding.id === shown);

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    if (canEdit && event.dataTransfer.files.length) onFiles([...event.dataTransfer.files]);
  };

  return (
    <section
      className="interview-context"
      data-over={over || undefined}
      onDragOver={(event) => {
        if (!canEdit) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <div className="interview-context-head">
        <h4>What it reads</h4>
        <p>Files it opens only when a request needs them, and cites when it does.</p>
      </div>
      <ul className="interview-context-files">
        {bindings.map((binding) => {
          const concerns = binding.extraction?.securityConcerns.length ?? 0;
          return (
            <li key={binding.id}>
              <button
                type="button"
                className="interview-file"
                aria-expanded={shown === binding.id}
                data-state={concerns ? "quarantined" : binding.confirmed ? "confirmed" : "read"}
                onClick={() => setShown((current) => (current === binding.id ? null : binding.id))}
              >
                <Icon name="document" size={14} />
                <span className="truncate">{binding.label}</span>
              </button>
            </li>
          );
        })}
        {reading ? (
          <li>
            <span className="interview-file" data-state="reading">
              <Loader2 size={13} className="foundry-spin" />
              <span className="truncate">Reading {reading}</span>
            </span>
          </li>
        ) : null}
        {canEdit ? (
          <li className="interview-context-add">
            <button type="button" className="interview-file is-add" disabled={Boolean(reading)} onClick={() => inputRef.current?.click()}>
              <Icon name="attach" size={14} />
              Attach a file
            </button>
            <button type="button" className="interview-skip" disabled={Boolean(reading)} onClick={onPaste}>
              Paste text
            </button>
          </li>
        ) : null}
      </ul>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept={CONTEXT_FILE_ACCEPT}
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          if (files.length) onFiles(files);
        }}
      />

      {selected ? (
        <div className="interview-file-detail">
          <div className="interview-file-detail-head">
            <p className="interview-file-detail-title">{selected.label}</p>
            {canEdit ? <IconButton icon="trash" size="compact" label={`Remove ${selected.label}`} onClick={() => onRemove(selected.id)} /> : null}
          </div>
          <p>{readSentence(selected)}</p>
          {selected.extraction?.criteria.length ? (
            <ul className="interview-file-criteria">
              {selected.extraction.criteria.slice(0, 5).map((criterion) => (
                <li key={criterion.id}>{criterion.name}</li>
              ))}
            </ul>
          ) : null}
          {selected.extraction?.securityConcerns.length ? (
            <p className="foundry-quarantine">
              <ShieldAlert size={13} />
              Some lines were instructions, not content, so they were left out.
            </p>
          ) : null}
          {selected.extraction?.contradictions.length ? (
            <p className="foundry-quarantine is-conflict">
              <AlertTriangle size={13} />
              {selected.extraction.contradictions[0]!.description}
            </p>
          ) : null}
          {canEdit && selected.extraction ? (
            <button
              type="button"
              className={`foundry-choice is-compact${selected.confirmed ? " is-active" : ""}`}
              onClick={() => onConfirm(selected.id, !selected.confirmed)}
            >
              <Check size={13} />
              {selected.confirmed ? "Read correctly" : "This reads correctly"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
