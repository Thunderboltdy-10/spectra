"use client";

import type { ReactNode } from "react";
import { Loader2, type GlyphIcon } from "@/components/icons/glyph-icons";
import { cn } from "@/lib/utils";

/*
 * The agent's own line of navigation, in place of a ribbon: its four parts as
 * words, the verb of the part that is open at the right, and the few other
 * things that part can do as quiet text beside it. Every part can be opened
 * at any time; a part that needs something first says so on its page.
 */

export type FoundryView = "overview" | "bench" | "checks" | "releases";

export const FOUNDRY_VIEW_LABELS: Record<FoundryView, string> = {
  overview: "Mission",
  bench: "Try it",
  checks: "Checks",
  releases: "Releases",
};

export type FoundryNavAction = {
  id: string;
  label: string;
  icon?: GlyphIcon;
  active?: boolean;
  disabled?: boolean;
  hint?: string;
  onSelect: () => void;
};

export function FoundryNav({
  views,
  view,
  onView,
  actions = [],
  primary,
  readout,
}: {
  views: readonly FoundryView[];
  view: FoundryView;
  onView: (view: FoundryView) => void;
  actions?: readonly FoundryNavAction[];
  primary?: FoundryNavAction & { busy?: boolean };
  readout?: ReactNode;
}) {
  return (
    <nav className="foundry-nav" aria-label="Agent">
      <div className="foundry-nav-parts" role="tablist" aria-label="Parts of this agent">
        {views.map((part) => (
          <button
            key={part}
            type="button"
            role="tab"
            aria-selected={part === view}
            className="foundry-nav-part"
            onClick={() => onView(part)}
          >
            {FOUNDRY_VIEW_LABELS[part]}
          </button>
        ))}
      </div>
      {readout ? <span className="foundry-nav-readout">{readout}</span> : null}
      <div className="foundry-nav-actions">
        {actions.map(({ id, label, icon: Icon, active, disabled, hint, onSelect }) => (
          <button
            key={id}
            type="button"
            className="foundry-nav-action"
            aria-pressed={active}
            disabled={disabled}
            title={hint}
            onClick={onSelect}
          >
            {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
            {label}
          </button>
        ))}
        {primary ? (
          <button
            type="button"
            className={cn("foundry-nav-primary", primary.busy && "is-busy")}
            disabled={primary.disabled}
            title={primary.hint}
            onClick={primary.onSelect}
          >
            {primary.busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : primary.icon ? (
              <primary.icon className="size-3.5" aria-hidden />
            ) : null}
            {primary.label}
          </button>
        ) : null}
      </div>
    </nav>
  );
}

/** What a part says before the agent has a mission to work from. */
export function FoundryNeedsMission({ part, onMission }: { part: FoundryView; onMission: () => void }) {
  const reads: Record<Exclude<FoundryView, "overview">, string> = {
    bench: "Trying it runs the agent on sample questions, and it answers them from its mission.",
    checks: "Checks are written from the mission and the skills compiled from it.",
    releases: "A release packages the mission, its skills and its sources.",
  };
  if (part === "overview") return null;
  return (
    <section className="foundry-needs">
      <p>{reads[part]} This agent does not have one yet: two answers on the Mission page set it.</p>
      <button type="button" className="foundry-nav-action" onClick={onMission}>
        Write the mission
      </button>
    </section>
  );
}
