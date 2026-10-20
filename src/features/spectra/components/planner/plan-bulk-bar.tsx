"use client";

import { Trash2 } from "@/components/icons/glyph-icons";
import { SelectField } from "@/components/ui/select";
import type { PlanContent, PlanStatus } from "../../plan/model";
import { PLAN_STATUS_LABELS, PLAN_STATUS_ORDER, type PlanBulkAction } from "../../plan/projections";

/*
 * What can be done to several tasks at once, shown while some are selected:
 * set their status, file them in a section, or delete them.
 */

export function PlanBulkBar({
  plan,
  count,
  onAction,
  onClear,
}: {
  plan: PlanContent;
  count: number;
  onAction: (action: PlanBulkAction) => void;
  onClear: () => void;
}) {
  return (
    <div className="plan-bulk" role="toolbar" aria-label="Selected tasks">
      <strong>{count} selected</strong>
      <SelectField
        ariaLabel="Set status for selected tasks"
        size="sm"
        value=""
        placeholder="Set status"
        onChange={(value) => value && onAction({ kind: "set_status", status: value as PlanStatus })}
        options={PLAN_STATUS_ORDER.map((status) => ({ value: status, label: PLAN_STATUS_LABELS[status] }))}
      />
      {plan.sections.length ? (
        <SelectField
          ariaLabel="Move selected tasks to a section"
          size="sm"
          value=""
          placeholder="Move to"
          onChange={(value) => value && onAction({ kind: "move_to_section", ...(value === "__none" ? {} : { sectionId: value }) })}
          options={[{ value: "__none", label: "No section" }, ...plan.sections.map((section) => ({ value: section.id, label: section.title }))]}
        />
      ) : null}
      <button type="button" className="sheet-quiet plan-bulk-delete" onClick={() => onAction({ kind: "delete" })}>
        <Trash2 className="size-3.5" /> Delete
      </button>
      <button type="button" className="sheet-quiet" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
