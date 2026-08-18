"use client";

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SelectField } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { WorkCapability } from "../work/registry";
import { useStudioContract } from "./artifact-studio-shell";

/**
 * Spectra's one artifact workbar.
 *
 * Every work type gets one control row. It is 42px tall at every width, it
 * never wraps, it never scrolls, and an open menu never changes its height —
 * menus are portaled, so they overlay the bar instead of growing it.
 *
 * A type declares *what* its controls mean; the bar decides how they survive
 * pressure. That is deliberate: nine types independently inventing an
 * adaptation strategy is how the baseline ended up with a bar that grew taller
 * (deck), a bar that deleted whole control groups (sheets at 682), a bar with
 * its own horizontal scrollbar (planner, presentation), and a bar whose
 * overflow control was the thing that overflowed (code at 850).
 *
 * Priorities
 *   essential  Always in the bar. Sheds its text label under container-query
 *              pressure, never its presence. Cap: 5 — more than that cannot
 *              survive 850px.
 *   secondary  In the bar while the pane is above the type's minimum inline
 *              size; moves into `⋯` at `tight`. Rendered in exactly one place,
 *              so nothing is ever listed twice.
 *   advanced   Always in `⋯`. Rare, destructive, or configuration actions.
 *
 * The primary verb is separate, is never shed and never wraps (one per bar).
 * Modes come from `work/registry` through the studio contract, so a type
 * cannot invent a mode outside the registry or show one the viewer lacks.
 */

export type WorkbarPriority = "essential" | "secondary" | "advanced";

export type WorkbarActionSpec = {
  id: string;
  /** Always the accessible name, even when the label is visually shed. */
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  priority?: WorkbarPriority;
  active?: boolean;
  disabled?: boolean;
  /** Keeps its text label at every width. Use for verbs, not for tools. */
  keepLabel?: boolean;
  /** Hidden unless the viewer holds this capability. */
  requires?: WorkCapability;
  /** Extra tooltip detail. The label alone is the accessible name. */
  hint?: string;
};

export type WorkbarModeSpec = {
  id: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  active?: boolean;
  disabled?: boolean;
};

/**
 * Modes rendered from `work/registry`. `value` is the studio's current mode id
 * and `onChange` is its own setter, both required — so a mode button is wired
 * to something real by construction and cannot ship inert.
 */
export type WorkbarRegistryModes = {
  registry: true;
  value: string;
  onChange: (modeId: string) => void;
};

export type WorkbarPrimarySpec = {
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  busy?: boolean;
  requires?: WorkCapability;
};

const MAX_ESSENTIAL_ACTIONS = 5;

function actionTitle(action: WorkbarActionSpec) {
  return action.hint ? `${action.label} · ${action.hint}` : action.label;
}

/**
 * The bar. `modes` is required with no default so a type has to make a visible
 * decision: `{ registry: true, … }` hands the mode list to `work/registry`
 * (the answer for every registered type), an explicit array is for surfaces the
 * registry does not model, and `[]` states that the type has no modes.
 */
export function ArtifactWorkbar({
  label,
  modes,
  selector,
  context,
  actions = [],
  primary,
  trailing,
  overflow,
  children,
  className,
}: {
  label: string;
  modes: readonly WorkbarModeSpec[] | WorkbarRegistryModes;
  /** The `‹ n · Title ⌄ n of N ›` item selector, if the type has a long list. */
  selector?: ReactNode;
  /** One short context string, e.g. the active file or sheet. Hidden ≤520px. */
  context?: string;
  actions?: readonly WorkbarActionSpec[];
  primary?: WorkbarPrimarySpec;
  /**
   * Inline stateful readouts that are not actions — a zoom percentage, a page
   * counter. Must stay narrow; buttons belong in `actions`.
   */
  trailing?: ReactNode;
  /**
   * Extra items rendered inside the same `⋯` menu as shed secondary/advanced
   * actions. Use this for grouped exports or templates — never for a second
   * overflow control, and never for a panel that grows the bar.
   */
  overflow?: ReactNode;
  /** Legacy inline content. Prefer `actions`; this does not shed. */
  children?: ReactNode;
  className?: string;
}) {
  const contract = useStudioContract();
  const can = contract.can;

  const resolvedModes = useMemo<readonly WorkbarModeSpec[]>(() => {
    if (Array.isArray(modes)) return modes;
    const registryModes = modes as WorkbarRegistryModes;
    // The registry is the authority on which modes exist and who may enter
    // them. Rendering from it is what makes CANON D1/D3 structural: authoring
    // is always first, and an activity can never become a peer tab a type
    // invented for itself.
    return contract.modes.map((mode) => ({
      id: mode.id,
      label: mode.label,
      active: mode.id === registryModes.value,
      onSelect: () => registryModes.onChange(mode.id),
    }));
  }, [contract.modes, modes]);

  const visibleActions = useMemo(
    () => actions.filter((action) => !action.requires || can(action.requires)),
    [actions, can],
  );
  const essential = visibleActions.filter(
    (action) => (action.priority ?? "secondary") === "essential",
  );
  const secondary = visibleActions.filter(
    (action) => (action.priority ?? "secondary") === "secondary",
  );
  const advanced = visibleActions.filter(
    (action) => action.priority === "advanced",
  );

  if (
    process.env.NODE_ENV !== "production" &&
    essential.length > MAX_ESSENTIAL_ACTIONS
  ) {
    console.warn(
      `[spectra] ${label}: ${essential.length} essential workbar actions. At most ${MAX_ESSENTIAL_ACTIONS} survive 850px without clipping — move the rest to "secondary".`,
    );
  }

  const showPrimary = !primary?.requires || can(primary.requires);
  // Promotion is decided from the pane's density, not from a viewport width and
  // not by measuring the bar: a control is rendered in the bar or in the menu,
  // never in both, so a shedding bar can never list an action twice.
  const tight = contract.density === "tight";
  const barActions = tight ? essential : [...essential, ...secondary];
  const menuActions = tight ? [...secondary, ...advanced] : advanced;

  return (
    <div
      className={cn("spectra-editor-workbar spectra-artifact-workbar", className)}
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      data-workbar-density={contract.density}
    >
      {/* Lead zone: the only elastic part of the bar. Everything here may
          shrink or truncate so the right cluster never reaches the edge. */}
      <div className="spectra-workbar-lead">
        {resolvedModes.length > 1 ? (
          <div className="spectra-workbar-modes" role="group" aria-label="View">
            {resolvedModes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                aria-pressed={mode.active}
                data-active={mode.active || undefined}
                disabled={mode.disabled}
                onClick={mode.onSelect}
                title={mode.label}
                className="spectra-workbar-mode"
              >
                {mode.icon ? <mode.icon className="size-3.5 shrink-0" /> : null}
                <span>{mode.label}</span>
              </button>
            ))}
          </div>
        ) : null}
        {selector}
        {context ? (
          <span className="spectra-workbar-context" title={context}>
            {context}
          </span>
        ) : null}
        {children}
      </div>
      <div className="spectra-workbar-trail">
        {trailing}
        {barActions.map((action) => (
          <WorkbarActionButton key={action.id} action={action} />
        ))}
        {showPrimary && primary ? (
          <button
            type="button"
            className="spectra-workbar-primary spectra-workbar-primary-action"
            disabled={primary.disabled || primary.busy}
            onClick={primary.onSelect}
          >
            {primary.icon ? (
              <primary.icon className="size-3.5 shrink-0" />
            ) : null}
            <span>{primary.label}</span>
          </button>
        ) : null}
        {menuActions.length || overflow ? (
          <WorkbarMenu
            label={<MoreHorizontal className="size-4" />}
            ariaLabel={`More ${label.toLowerCase()}`}
            align="end"
            triggerClassName="spectra-workbar-overflow"
          >
            {menuActions.map((action) => (
              <WorkbarMenuItem key={action.id} action={action} />
            ))}
            {overflow}
          </WorkbarMenu>
        ) : null}
      </div>
    </div>
  );
}

function WorkbarActionButton({ action }: { action: WorkbarActionSpec }) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      aria-label={action.label}
      title={actionTitle(action)}
      aria-pressed={action.active}
      data-active={action.active || undefined}
      data-workbar-keep-label={action.keepLabel || undefined}
      disabled={action.disabled}
      onClick={action.onSelect}
      className="spectra-artifact-workbar-action"
    >
      {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
      <span>{action.label}</span>
    </button>
  );
}

function WorkbarMenuItem({ action }: { action: WorkbarActionSpec }) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      role="menuitem"
      className={workbarMenuItemClass()}
      disabled={action.disabled}
      data-active={action.active || undefined}
      onClick={action.onSelect}
    >
      <span className="grid size-4 shrink-0 place-items-center text-[var(--text-secondary)]">
        {Icon ? <Icon className="size-3.5" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{action.label}</span>
    </button>
  );
}

/**
 * The `‹ n · Title ⌄  n of N  ›` selector. Presentation at 850 and Quiz at
 * every width had independently arrived at this shape; this is the one
 * implementation both converge on. The list itself is Spectra's `SelectField`,
 * so it is portaled and keyboard-navigable rather than a native `<select>`.
 */
export function WorkbarItemSelector({
  ariaLabel,
  items,
  value,
  onChange,
  itemNoun = "item",
  className,
}: {
  ariaLabel: string;
  items: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>;
  value: string;
  onChange: (value: string) => void;
  /** Used in "3 of 12 slides" and in the previous/next accessible names. */
  itemNoun?: string;
  className?: string;
}) {
  const index = items.findIndex((item) => item.value === value);
  const options = useMemo(
    () =>
      items.map((item, position) => ({
        value: item.value,
        label: `${position + 1} · ${item.label}`,
        disabled: item.disabled,
      })),
    [items],
  );
  if (!items.length) return null;
  return (
    <div className={cn("spectra-workbar-item-selector", className)}>
      <button
        type="button"
        className="spectra-workbar-step"
        aria-label={`Previous ${itemNoun}`}
        title={`Previous ${itemNoun}`}
        disabled={index <= 0}
        onClick={() => onChange(items[Math.max(0, index - 1)]!.value)}
      >
        <ChevronLeft className="size-3.5" />
      </button>
      <SelectField
        ariaLabel={ariaLabel}
        size="sm"
        value={value}
        onChange={onChange}
        options={options}
        className="min-w-0 flex-1"
        triggerClassName="spectra-workbar-item-trigger w-full border-transparent bg-transparent"
      />
      <span className="spectra-workbar-count">
        {index + 1} of {items.length}
      </span>
      <button
        type="button"
        className="spectra-workbar-step"
        aria-label={`Next ${itemNoun}`}
        title={`Next ${itemNoun}`}
        disabled={index < 0 || index >= items.length - 1}
        onClick={() =>
          onChange(items[Math.min(items.length - 1, index + 1)]!.value)
        }
      >
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  );
}

export type WorkbarOption<T extends string = string> = {
  value: T;
  label: string;
};

/**
 * A single-choice control inside the bar. Backed by Spectra's `Select`, so it
 * is portaled: opening it cannot grow the bar or be clipped by a studio box.
 */
export function WorkbarSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  disabled,
}: {
  value: T;
  options: Array<WorkbarOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  /** Retained for call-site compatibility; the popover aligns itself. */
  align?: "start" | "end";
}) {
  return (
    <SelectField
      ariaLabel={ariaLabel}
      size="sm"
      disabled={disabled}
      value={value}
      onChange={(next) => onChange(next as T)}
      options={options}
      className={cn("min-w-0", className)}
      triggerClassName="spectra-workbar-select w-full max-w-[240px] border-transparent bg-transparent"
    />
  );
}

/**
 * A labelled menu in the bar. Controlled `open`/`onOpenChange` stay supported
 * for call sites that track menu state; omit them for the common case.
 */
export function WorkbarMenu({
  label,
  open,
  onOpenChange,
  children,
  align = "start",
  ariaLabel,
  triggerClassName,
}: {
  label: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  align?: "start" | "end";
  ariaLabel?: string;
  triggerClassName?: string;
}) {
  return (
    <DropdownMenu
      modal={false}
      {...(open === undefined ? {} : { open })}
      onOpenChange={onOpenChange}
    >
      <DropdownMenuTrigger
        aria-label={ariaLabel ?? (typeof label === "string" ? label : "More")}
        className={cn("spectra-workbar-menu-trigger", triggerClassName)}
      >
        {label}
        {typeof label === "string" ? (
          <ChevronDown className="size-3 shrink-0 text-[var(--text-secondary)]" />
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        sideOffset={6}
        className="spectra-workbar-menu max-h-[min(60vh,420px)] min-w-[210px] overflow-y-auto p-1.5"
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WorkbarMore({
  open,
  onOpenChange,
  children,
  label = "More tools",
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <WorkbarMenu
      label={<MoreHorizontal className="size-4" />}
      ariaLabel={label}
      open={open}
      onOpenChange={onOpenChange}
      align="end"
      triggerClassName="spectra-workbar-overflow"
    >
      {children}
    </WorkbarMenu>
  );
}

export function workbarMenuItemClass() {
  return "flex w-full items-center gap-2 rounded-chip px-2.5 py-1.5 text-left text-micro font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:pointer-events-none disabled:opacity-45";
}
