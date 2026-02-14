"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

type Collaborator = {
  role: string;
  model: string;
  tokensUsed: number;
  durationMs: number;
};

type CollaboratorsBadgeProps = {
  collaborators?: Collaborator[];
};

function roleLabel(value: string) {
  return value.replace(/_/g, " ");
}

function formatMs(value: number) {
  return `${Math.max(0, Math.round(value))} ms`;
}

export function CollaboratorsBadge({ collaborators = [] }: CollaboratorsBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const compact = useMemo(
    () => collaborators.map((item) => roleLabel(item.role)).slice(0, 3).join(" + "),
    [collaborators],
  );

  if (collaborators.length === 0) return null;

  return (
    <div className="mt-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2.5">
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-secondary)]"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <Users className="h-3.5 w-3.5" />
        <span className="font-medium text-[var(--text-primary)]">
          {compact || `${collaborators.length} specialists`}
        </span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {expanded ? (
        <div className="mt-2 space-y-2">
          {collaborators.map((item) => (
            <div
              key={`${item.role}-${item.model}`}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-2"
            >
              <p className="text-xs font-medium capitalize text-[var(--text-primary)]">{roleLabel(item.role)}</p>
              <p className="font-mono text-[11px] text-[var(--text-secondary)]">{item.model}</p>
              <p className="text-[11px] text-[var(--text-secondary)]">
                {item.tokensUsed} tokens • {formatMs(item.durationMs)}
              </p>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpanded(false)}>
            Collapse
          </Button>
        </div>
      ) : null}
    </div>
  );
}
