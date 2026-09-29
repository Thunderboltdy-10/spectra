"use client";

import { SelectField } from "@/components/ui/select";
import type { WordSource } from "../lenses/docx-citation-schema";

// Radix Select rejects an empty-string item value, so "New supplied source"
// has a sentinel of its own. A colon never appears in a Word source tag.
const NEW_SOURCE = ":new-source";

const SOURCE_TYPE_OPTIONS: Array<{ value: WordSource["sourceType"]; label: string }> = [
  { value: "Misc", label: "Unspecified" },
  { value: "Book", label: "Book" },
  { value: "JournalArticle", label: "Journal article" },
  { value: "DocumentFromInternetSite", label: "Web page" },
  { value: "Report", label: "Report" },
];

const TRIGGER = "w-full font-normal";

/** The Word-source and source-type pickers of the citation panel. */
export function CitationSourcePickers({
  sources,
  source,
  showSources,
  onChooseSource,
  onNewSource,
  onSourceType,
}: {
  sources: readonly WordSource[];
  source?: WordSource;
  /** The existing-source picker only shows for a new citation with sources to reuse. */
  showSources: boolean;
  onChooseSource: (source: WordSource) => void;
  onNewSource: () => void;
  onSourceType: (sourceType: WordSource["sourceType"]) => void;
}) {
  const chosenTag = sources.some((item) => item.tag === source?.tag) ? source!.tag : NEW_SOURCE;
  return (
    <>
      {showSources && sources.length ? (
        <label>
          Existing Word source
          <SelectField
            ariaLabel="Existing Word source"
            size="sm"
            triggerClassName={TRIGGER}
            value={chosenTag}
            onChange={(tag) => {
              const next = sources.find((item) => item.tag === tag);
              if (next) onChooseSource(next);
              else onNewSource();
            }}
            options={[
              { value: NEW_SOURCE, label: "New supplied source" },
              ...sources.map((item) => ({ value: item.tag, label: item.title || item.tag })),
            ]}
          />
        </label>
      ) : null}
      <label>
        Source type
        <SelectField
          ariaLabel="Source type"
          size="sm"
          triggerClassName={TRIGGER}
          value={source?.sourceType ?? "Misc"}
          onChange={(value) => onSourceType(value as WordSource["sourceType"])}
          options={SOURCE_TYPE_OPTIONS}
        />
      </label>
    </>
  );
}
