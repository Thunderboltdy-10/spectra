"use client";

import { Check, Plus, Trash2 } from "@/components/icons/glyph-icons";
import { LocalAutocompleteTextarea } from "../../compute/autocomplete";
import type { SpectraArtifact } from "../../data/api";
import type { FoundrySection, FoundrySectionValue } from "../foundry";
import type { AgentTool } from "../model";

/*
 * One interview answer: the field a question asks for (text, a choice, worked
 * examples, the tools it may use, linked work) and the line it reads as once
 * answered.
 */

/**
 * The capabilities Spectra can actually grant. This list is the runtime's
 * allowlist (`AgentTool["key"]`, enforced again by `publishAgent`), not a menu
 * of plausible ones: the previous list offered "Run code" and "Read files",
 * which the runtime has no tool for, so both were dropped on save and would
 * have failed publish. Everything here reaches a real tool.
 */
export const TOOL_CHOICES: ReadonlyArray<{
  id: AgentTool["key"];
  label: string;
  detail: string;
}> = [
  { id: "artifact_search", label: "Find work", detail: "Search what the person asking can already see" },
  { id: "artifact_read", label: "Read work", detail: "Open and quote items they can already open" },
  { id: "artifact_create", label: "Create work", detail: "Start new typed Spectra work" },
  { id: "artifact_edit", label: "Edit work", detail: "Propose region-safe changes" },
  { id: "memory_retrieve", label: "Recall context", detail: "Read what they asked Spectra to remember" },
  { id: "school_data", label: "Read school data", detail: "Timetable and results they may already see" },
  { id: "web_search", label: "Search the web", detail: "Look things up outside Spectra" },
];

export const TOOL_LABEL = new Map<string, string>(
  TOOL_CHOICES.map((tool) => [tool.id, tool.label]),
);

export function identifier(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function SectionEditor({
  section,
  draft,
  onDraft,
  disabled,
  artifacts,
}: {
  section: FoundrySection;
  draft: FoundrySectionValue;
  onDraft: (value: FoundrySectionValue) => void;
  disabled: boolean;
  artifacts: SpectraArtifact[];
}) {
  if (section.kind === "work_reference") {
    const selected = draft.kind === "works" ? draft.workIds : [];
    return (
      <ul className="foundry-choices">
        {artifacts.slice(0, 40).map((artifact) => {
          const active = selected.includes(artifact._id);
          return (
            <li key={artifact._id}>
              <button
                type="button"
                className={`foundry-choice${active ? " is-active" : ""}`}
                disabled={disabled}
                onClick={() =>
                  onDraft({
                    kind: "works",
                    workIds: active
                      ? selected.filter((id) => id !== artifact._id)
                      : [...selected, artifact._id],
                  })
                }
              >
                <span className="foundry-choice-label">{artifact.title}</span>
                <span className="foundry-choice-detail">
                  {artifact.blueprintKey.replaceAll("_", " ")}
                </span>
                {active && <Check size={14} className="foundry-choice-mark" />}
              </button>
            </li>
          );
        })}
        {artifacts.length === 0 && (
          <li className="foundry-empty">Nothing in this workspace to link yet.</li>
        )}
      </ul>
    );
  }

  if (section.kind === "permission_selection") {
    const selected = draft.kind === "permissions" ? draft.toolIds : [];
    return (
      <>
        <ul className="foundry-choices">
          {TOOL_CHOICES.map((tool) => {
            const active = selected.includes(tool.id);
            return (
              <li key={tool.id}>
                <button
                  type="button"
                  className={`foundry-choice${active ? " is-active" : ""}`}
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() =>
                    onDraft({
                      kind: "permissions",
                      toolIds: active
                        ? selected.filter((id) => id !== tool.id)
                        : [...selected, tool.id],
                    })
                  }
                >
                  <span className="foundry-choice-label">{tool.label}</span>
                  <span className="foundry-choice-detail">{tool.detail}</span>
                  {active && <Check size={14} className="foundry-choice-mark" />}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="foundry-section-detail">
          Whatever you grant, the agent works inside the permissions of whoever
          asks, and Spectra asks that person before anything consequential.
        </p>
      </>
    );
  }

  if (section.kind === "example_pair") {
    const pairs = draft.kind === "examples" ? draft.pairs : [];
    return (
      <div className="foundry-pairs">
        {pairs.map((pair, index) => (
          <div key={pair.id} className="foundry-pair">
            <div className="foundry-pair-head">
              <span>Example {index + 1}</span>
              <button
                type="button"
                className="foundry-icon-button"
                disabled={disabled}
                aria-label={`Remove example ${index + 1}`}
                onClick={() =>
                  onDraft({
                    kind: "examples",
                    pairs: pairs.filter((entry) => entry.id !== pair.id),
                  })
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
            <textarea
              className="foundry-input"
              rows={3}
              placeholder="What comes in"
              value={pair.input}
              disabled={disabled}
              onChange={(event) =>
                onDraft({
                  kind: "examples",
                  pairs: pairs.map((entry) =>
                    entry.id === pair.id
                      ? { ...entry, input: event.target.value }
                      : entry,
                  ),
                })
              }
            />
            <textarea
              className="foundry-input"
              rows={4}
              placeholder="What you would produce from it"
              value={pair.output}
              disabled={disabled}
              onChange={(event) =>
                onDraft({
                  kind: "examples",
                  pairs: pairs.map((entry) =>
                    entry.id === pair.id
                      ? { ...entry, output: event.target.value }
                      : entry,
                  ),
                })
              }
            />
          </div>
        ))}
        <button
          type="button"
          className="foundry-ghost-button"
          disabled={disabled}
          onClick={() =>
            onDraft({
              kind: "examples",
              pairs: [
                ...pairs,
                { id: identifier("pair"), input: "", output: "" },
              ],
            })
          }
        >
          <Plus size={14} />
          Add an example
        </button>
      </div>
    );
  }

  if (
    (section.kind === "single_choice" || section.kind === "multi_choice") &&
    section.options?.length
  ) {
    const value = draft.kind === "choice" ? draft : { kind: "choice" as const, selected: [] };
    const multi = section.kind === "multi_choice" || section.multiSelect === true;
    return (
      <>
        <ul className="foundry-choices">
          {section.options.map((option) => {
            const active = value.selected.includes(option.id);
            return (
              <li key={option.id}>
                <button
                  type="button"
                  className={`foundry-choice${active ? " is-active" : ""}${option.recommended ? " is-recommended" : ""}`}
                  disabled={disabled}
                  onClick={() =>
                    onDraft({
                      ...value,
                      kind: "choice",
                      selected: multi
                        ? active
                          ? value.selected.filter((id) => id !== option.id)
                          : [...value.selected, option.id]
                        : [option.id],
                    })
                  }
                >
                  <span className="foundry-choice-label">{option.label}</span>
                  {option.detail && (
                    <span className="foundry-choice-detail">{option.detail}</span>
                  )}
                  {active && <Check size={14} className="foundry-choice-mark" />}
                </button>
              </li>
            );
          })}
        </ul>
        {section.allowOther !== false && (
          <input
            className="foundry-input"
            placeholder="Something else"
            value={value.other ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onDraft({ ...value, kind: "choice", other: event.target.value })
            }
          />
        )}
      </>
    );
  }

  if (section.kind === "evidence_confirmation") {
    const accepted = draft.kind === "confirmation" ? draft.accepted : false;
    return (
      <div className="foundry-confirm">
        <button
          type="button"
          className={`foundry-choice${accepted ? " is-active" : ""}`}
          disabled={disabled}
          onClick={() => onDraft({ kind: "confirmation", accepted: true })}
        >
          <span className="foundry-choice-label">That is right</span>
        </button>
        <button
          type="button"
          className={`foundry-choice${draft.kind === "confirmation" && !accepted ? " is-active" : ""}`}
          disabled={disabled}
          onClick={() => onDraft({ kind: "confirmation", accepted: false })}
        >
          <span className="foundry-choice-label">Not quite</span>
        </button>
      </div>
    );
  }

  const text = draft.kind === "text" ? draft.text : "";
  return (
    <LocalAutocompleteTextarea
      className="foundry-textarea"
      textareaClassName="foundry-input"
      surface="agent_foundry"
      rows={section.kind === "long_text" ? 5 : 2}
      value={text}
      disabled={disabled}
      placeholder="In your own words"
      onValueChange={(next) => onDraft({ kind: "text", text: next })}
    />
  );
}

export function summarizeValue(value: FoundrySectionValue): string {
  switch (value.kind) {
    case "text":
      return value.text.trim();
    case "choice":
      return [...value.selected, value.other].filter(Boolean).join(", ");
    case "examples":
      return `${value.pairs.length} worked example${value.pairs.length === 1 ? "" : "s"}`;
    case "permissions":
      return value.toolIds
        .map((id) => TOOL_LABEL.get(id) ?? id)
        .join(", ");
    case "confirmation":
      return value.accepted ? "Confirmed" : "Marked as not quite right";
    case "files":
      return `${value.fileIds.length} file${value.fileIds.length === 1 ? "" : "s"}`;
    case "works":
      return `${value.workIds.length} linked item${value.workIds.length === 1 ? "" : "s"}`;
    case "skills":
      return `${value.approvedSkillIds.length} skill${value.approvedSkillIds.length === 1 ? "" : "s"} approved`;
    case "empty":
      return "";
  }
}
