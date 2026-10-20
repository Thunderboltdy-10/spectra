"use client";

import { Search, X } from "@/components/icons/glyph-icons";
import { SelectField } from "@/components/ui/select";
import type { PlanContent, PlanStatus } from "../../plan/model";
import { PLAN_STATUS_LABELS, PLAN_STATUS_ORDER } from "../../plan/projections";

/*
 * Finding and narrowing a plan, opened from the workbar: a search line, and
 * the filters as quiet selects. Both sit above the page they narrow.
 */

export type PlanFilters = { status: PlanStatus | "all"; section: string; source: "all" | "official" | "own" };

export const NO_FILTERS: PlanFilters = { status: "all", section: "all", source: "all" };

export function filtersActive(filters: PlanFilters) {
  return filters.status !== "all" || filters.section !== "all" || filters.source !== "all";
}

export function PlanSearch({ value, onChange, onClose }: { value: string; onChange: (value: string) => void; onClose: () => void }) {
  return (
    <div className="plan-find">
      <Search className="size-3.5" aria-hidden />
      <input
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          if (value) onChange("");
          else onClose();
        }}
        placeholder="Find tasks"
        aria-label="Find tasks"
      />
      {value ? (
        <button type="button" className="sheet-icon-button" aria-label="Clear the search" onClick={() => onChange("")}>
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function PlanFilterBar({ plan, filters, onChange }: { plan: PlanContent; filters: PlanFilters; onChange: (filters: PlanFilters) => void }) {
  return (
    <div className="plan-filters">
      <SelectField
        label="Status"
        size="sm"
        value={filters.status}
        onChange={(status) => onChange({ ...filters, status: status as PlanFilters["status"] })}
        options={[{ value: "all", label: "Any status" }, ...PLAN_STATUS_ORDER.map((status) => ({ value: status, label: PLAN_STATUS_LABELS[status] }))]}
      />
      {plan.sections.length ? (
        <SelectField
          label="Section"
          size="sm"
          value={filters.section}
          onChange={(section) => onChange({ ...filters, section })}
          options={[{ value: "all", label: "Any section" }, ...plan.sections.map((section) => ({ value: section.id, label: section.title }))]}
        />
      ) : null}
      <SelectField
        label="Deadline set by"
        size="sm"
        value={filters.source}
        onChange={(source) => onChange({ ...filters, source: source as PlanFilters["source"] })}
        options={[
          { value: "all", label: "Anyone" },
          { value: "official", label: "The school" },
          { value: "own", label: "You" },
        ]}
      />
      {filtersActive(filters) ? (
        <button type="button" className="sheet-quiet" onClick={() => onChange(NO_FILTERS)}>
          Show every task
        </button>
      ) : null}
    </div>
  );
}
