"use client";

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Settings2,
  RotateCcw,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SelectField } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { WorkCapability } from "../work/registry";
import {
  commandContext,
  commandForBinding,
  contextualTabsFor,
  executeCommand,
  resolveCommandLayout,
  tabsFor,
  type CommandBinding,
  type CommandLayout,
  type CommandParam,
} from "../commands";
import { useSpectraPreferences } from "../settings/preference-store";
import { useStudioContract, type StudioDensity } from "./artifact-studio-shell";
import {
  WorkbarCommandControl,
  WorkbarControlMenuRow,
  isRenderedControl,
} from "./workbar-controls";
import { planWorkbarOverflow, sameIdList, shouldCommitWorkbarPlan, shouldIgnoreWorkbarHostResize, shouldReplaceWorkbarPlan, workbarPlanKey } from "./workbar-overflow";

export type { CommandBinding } from "../commands";

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
 *   essential  First in line for the bar, and the last thing to leave it.
 *   secondary  In the bar while there is room; moves into `⋯` before an
 *              essential does. Rendered in exactly one place, so nothing is
 *              ever listed twice.
 *   advanced   Always in `⋯`. Rare, destructive, or configuration actions.
 *
 * Room is a *width budget*, not a count. A font picker is not the same width as
 * an icon button, and a bar that counted them the same either clipped or left
 * half its row empty. Each control declares what it costs in button-widths, the
 * pane's density sets the budget, and the row fills in priority order until the
 * budget is spent. Everything else goes to the one overflow menu — deterministic
 * at every width, and never in two places at once.
 *
 * The primary verb is separate, is never shed and never wraps (one per bar).
 * Modes come from `work/registry` through the studio contract, so a type
 * cannot invent a mode outside the registry or show one the viewer lacks.
 */

export type WorkbarPriority = "essential" | "secondary" | "advanced";

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

/**
 * What a control costs in the bar, measured in icon-button widths. These are the
 * rendered widths of `workbar-controls.tsx`, rounded up: a font picker really is
 * about two and a half buttons wide, and pretending otherwise is what made the
 * old flat cap clip.
 */
const CONTROL_COST: Record<string, number> = {
  button: 1,
  toggle: 1,
  color: 1,
  numeric: 2,
  segmented: 2.2,
  select: 2.6,
  menu: 2.6,
};

/** How much bar there is to spend, by the pane's own density. */
const BAR_BUDGET: Record<StudioDensity, number> = {
  comfortable: 11,
  compact: 8,
  tight: 5,
};

function actionCost(action: CommandBinding) {
  return CONTROL_COST[action.control?.kind ?? "button"] ?? 1;
}

function actionsWeight(actions: readonly CommandBinding[]) {
  return actions.reduce((total, action) => total + actionCost(action), 0);
}

/**
 * Fills the row in the order given, then hands back what did not fit. Order in,
 * order out: a person's pinned arrangement is never silently rearranged to make
 * something else fit.
 */
function fitToBudget(actions: readonly CommandBinding[], budget: number) {
  const bar: CommandBinding[] = [];
  const shed: CommandBinding[] = [];
  let spent = 0;
  for (const action of actions) {
    const cost = actionCost(action);
    if (spent + cost <= budget) {
      bar.push(action);
      spent += cost;
    } else {
      shed.push(action);
    }
  }
  return { bar, shed };
}

function actionTitle(action: CommandBinding) {
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
  selectionContext,
  className,
}: {
  label: string;
  modes: readonly WorkbarModeSpec[] | WorkbarRegistryModes;
  /** The `‹ n · Title ⌄ n of N ›` item selector, if the type has a long list. */
  selector?: ReactNode;
  /** One short context string, e.g. the active file or sheet. Hidden ≤520px. */
  context?: string;
  actions?: readonly CommandBinding[];
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
  children?: ReactNode | ((activeTab: string) => ReactNode);
  /** Selection kind activates a registry-declared contextual tab. */
  selectionContext?: string;
  className?: string;
}) {
  const contract = useStudioContract();
  const can = contract.can;
  const { preferences, update } = useSpectraPreferences({ workType: contract.type });
  const storedLayout = preferences.workbar[contract.type] as CommandLayout | undefined;
  const [activeTab, setActiveTab] = useState("General");
  const [customizing, setCustomizing] = useState(false);
  const [iconOnlyIds, setIconOnlyIds] = useState<string[]>([]);
  const [overflowIds, setOverflowIds] = useState<string[]>([]);
  const [metaCollapsed, setMetaCollapsed] = useState(false);
  const commandsHostRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const tabsRailRef = useRef<HTMLDivElement>(null);
  const metaRef = useRef<HTMLDivElement>(null);
  const overflowPlanKeyRef = useRef<string | null>(null);
  const previousOverflowPlanKeyRef = useRef<string | null>(null);
  const overflowHostWidthRef = useRef<number | null>(null);
  const [dragCommandId, setDragCommandId] = useState<string | null>(null);
  const previousSelectionContext = useRef<string | undefined>(undefined);
  const commandCtx = useMemo(
    () => commandContext(contract.type, can, contract.role, selectionContext, {
      compatibilityProfile: contract.compatibilityProfile,
      fidelity: contract.fidelity,
    }, contract.executeApplicationCommand),
    [can, contract.compatibilityProfile, contract.executeApplicationCommand, contract.fidelity, contract.role, contract.type, selectionContext],
  );
  const commands = useMemo(
    () => actions.map((binding, index) => ({
      binding,
      command: resolveCommandLayout(commandForBinding(contract.type, binding, index), storedLayout),
    })),
    [actions, contract.type, storedLayout],
  );
  const tabs = useMemo(
    () => tabsFor(contract.type, selectionContext, storedLayout),
    [contract.type, selectionContext, storedLayout],
  );
  const tabSignature = tabs.join("\u001f");
  useEffect(() => {
    if (selectionContext !== previousSelectionContext.current) {
      previousSelectionContext.current = selectionContext;
      const next = selectionContext && tabs.includes(selectionContext)
        ? selectionContext
        : "General";
      setActiveTab((current) => current === next ? current : next);
      return;
    }
    setActiveTab((current) => tabs.includes(current) ? current : "General");
    // tabSignature is the stable dependency for the derived tab list. The
    // array itself is intentionally not used because tabsFor returns a new
    // array when layout preferences are resolved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionContext, tabSignature]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // A shortcut without a modifier belongs to whatever has focus. Firing
      // "Bold" because someone typed the letter b in a cell, a title field or a
      // paragraph would be the worst kind of surprise (D20).
      const modified = event.metaKey || event.ctrlKey || event.altKey;
      const match = commands.find(({ command }) => {
        const shortcut = command.shortcut?.toLowerCase();
        if (!shortcut) return false;
        const needsModifier = shortcut.includes("mod+");
        const needsShift = shortcut.includes("shift+");
        const needsAlt = shortcut.includes("alt+");
        if (!needsModifier && !needsAlt && !modified) return false;
        const key = shortcut.split("+").at(-1);
        // Shift is matched exactly, so Mod+Z and Mod+Shift+Z stay two
        // different commands rather than a race between undo and redo.
        return (!needsModifier || event.metaKey || event.ctrlKey) &&
          event.shiftKey === needsShift &&
          (!needsAlt || event.altKey) &&
          event.key.toLowerCase() === key;
      });
      if (!match) return;
      event.preventDefault();
      executeCommand(match.command, commandCtx);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [commandCtx, commands]);

  /**
   * One type's layout, patched by itself. `update` shallow-merges the patch into
   * the `workbar` section, so this deliberately does *not* spread
   * `preferences.workbar`: doing that would write a whole snapshot taken at
   * render time, and two editors saving in the same tick would each revert the
   * other's type.
   */
  const saveLayout = (next: CommandLayout) => {
    update("workbar", { [contract.type]: next });
  };
  const updateCommandLayout = (commandId: string, patch: NonNullable<CommandLayout["commands"]>[string]) => {
    saveLayout({
      ...storedLayout,
      commands: {
        ...storedLayout?.commands,
        [commandId]: { ...storedLayout?.commands?.[commandId], ...patch },
      },
    });
  };
  /** How many commands carry an override, so "reset" can state its consequence. */
  const customizedCount = useMemo(
    () => Object.values(storedLayout?.commands ?? {}).filter(
      (override) => override && Object.values(override).some((value) => value !== undefined),
    ).length,
    [storedLayout],
  );

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

  const visibleActions = useMemo(() => commands
    .filter(({ command }) => {
      if (command.hidden) return false;
      // Favourites live on General without leaving their home tab. Pinning Bold
      // must not empty Format; that is how a person forgets the interface and
      // still finds the verb where they last used it.
      const onActiveTab =
        command.defaultPlacement.tab === activeTab ||
        command.sourceTab === activeTab ||
        command.contextualTab === activeTab;
      return onActiveTab && command.availability(commandCtx).state !== "hidden";
    })
    .sort((left, right) => left.command.defaultPlacement.order - right.command.defaultPlacement.order)
      .map(({ binding, command }) => {
      const availability = command.availability(commandCtx);
      return ({
      ...binding,
      id: command.id,
      label: command.title,
      group: command.defaultPlacement.group,
      density: storedLayout?.commands?.[command.id]?.density,
      disabled: availability.state === "disabled",
      hint:
        availability.state === "disabled"
          ? availability.reason
          : binding.hint,
      // The one execute path. A pointer, a shortcut, the overflow menu and the
      // AI dispatcher all arrive here, and a parameterized control hands its
      // value straight through rather than closing over a second setter.
      onSelect: (value?: CommandParam) => executeCommand(command, commandCtx, value),
    }); }), [activeTab, commandCtx, commands, storedLayout]);
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
    actionsWeight(essential) > BAR_BUDGET.comfortable
  ) {
    console.warn(
      `[spectra] ${label}: essential actions are ${actionsWeight(essential).toFixed(1)} button-widths wide on "${activeTab}", past the ${BAR_BUDGET.comfortable} the bar can show at full width. Demote the tail to "secondary" so the shedding order stays a decision rather than an accident.`,
    );
  }

  const showPrimary = !primary?.requires || can(primary.requires);
  const rowActions = visibleActions;
  const overflowCommandIds = visibleActions.map((action) => action.id).join("\u001f");
  const overflowCommandIdsRef = useRef(overflowCommandIds);
  const overflowSignature = visibleActions
    .map((action) => `${action.id}:${action.disabled ? "1" : "0"}`)
    .join("\u001f");
  const measuredOverflow = useMemo(
    () => new Set(overflowIds),
    [overflowIds],
  );
  const measuredIconOnly = useMemo(
    () => new Set(iconOnlyIds),
    [iconOnlyIds],
  );
  const barActions = customizing
    ? rowActions
    : rowActions.filter((action) => !measuredOverflow.has(action.id));
  const menuActions = customizing
    ? []
    : rowActions.filter((action) => measuredOverflow.has(action.id));

  useLayoutEffect(() => {
    const host = commandsHostRef.current;
    const measure = measureRef.current;
    if (!host || !measure) return;
    if (overflowCommandIdsRef.current !== overflowCommandIds) {
      overflowPlanKeyRef.current = null;
      previousOverflowPlanKeyRef.current = null;
      overflowHostWidthRef.current = null;
      overflowCommandIdsRef.current = overflowCommandIds;
    }

    const recompute = (fromResize: boolean) => {
      const hostWidth = host.clientWidth;
      if (hostWidth < 40) return;
      if (
        fromResize &&
        shouldIgnoreWorkbarHostResize(overflowHostWidthRef.current, hostWidth)
      )
        return;
      overflowHostWidthRef.current = hostWidth;
      const reserved = [...host.querySelectorAll<HTMLElement>("[data-workbar-reserved]")]
        .reduce((total, node) => total + node.offsetWidth, 0);
      const available = Math.max(0, hostWidth - reserved - 8);
      const nodes = [...measure.querySelectorAll<HTMLElement>("[data-measure-id]")];
      const widths = new Map<string, { full: number; icon: number }>();
      for (const node of nodes) {
        const id = node.dataset.measureId;
        if (!id) continue;
        const current = widths.get(id) ?? { full: 0, icon: 32 };
        const width = Math.ceil(node.offsetWidth || node.getBoundingClientRect().width);
        if (node.dataset.measureMode === "icon") current.icon = width;
        else current.full = width;
        widths.set(id, current);
      }
      // jsdom and the first paint can report 0. Inventing 72px then collapses
      // the row while half of it is still empty. Wait for a real layout — and
      // do not wipe a previous plan, or table-context remounts loop the bar.
      if (!shouldCommitWorkbarPlan(widths.values())) return;
      const plan = planWorkbarOverflow(
        rowActions.map((action) => ({
          id: action.id,
          fullWidth: Math.max(widths.get(action.id)?.full || 0, 32),
          iconWidth: Math.max(widths.get(action.id)?.icon || 0, 32),
          disabled: action.disabled,
          priority: action.priority,
        })),
        available,
        36,
      );
      const nextKey = workbarPlanKey(plan);
      if (
        !shouldReplaceWorkbarPlan(
          nextKey,
          overflowPlanKeyRef.current,
          previousOverflowPlanKeyRef.current,
        )
      )
        return;
      previousOverflowPlanKeyRef.current = overflowPlanKeyRef.current;
      overflowPlanKeyRef.current = nextKey;
      setIconOnlyIds((current) =>
        sameIdList(current, plan.iconOnlyIds) ? current : plan.iconOnlyIds,
      );
      setOverflowIds((current) =>
        sameIdList(current, plan.overflowIds) ? current : plan.overflowIds,
      );
    };

    recompute(false);
    const observer = new ResizeObserver(() => recompute(true));
    observer.observe(host);
    return () => observer.disconnect();
  }, [overflowSignature, overflowCommandIds, customizing, activeTab]);

  useLayoutEffect(() => {
    const tabs = tabsRailRef.current;
    const meta = metaRef.current;
    if (!tabs || !meta) return;
    const recompute = () => {
      if (tabs.clientWidth < 80) return;
      const tabList = tabs.querySelector<HTMLElement>(".spectra-command-tabs");
      const tabWidth = tabList?.scrollWidth ?? 0;
      // Measure the expanded cluster, not the current one. A collapsed
      // dropdown is narrower, which would immediately un-collapse and loop.
      const nextCollapsed = tabWidth + 108 + 24 > tabs.clientWidth;
      setMetaCollapsed((current) => {
        if (current === nextCollapsed) return current;
        // Stay collapsed until there is slack, so selecting a table (extra
        // commands, slightly tighter rail) cannot flip the header every frame.
        if (current && tabWidth + 108 > tabs.clientWidth) return current;
        return nextCollapsed;
      });
    };
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(tabs);
    return () => observer.disconnect();
  }, [tabs, customizing]);

  return (
    <div
      className={cn("spectra-editor-workbar spectra-artifact-workbar", className)}
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      data-workbar-density={contract.density}
      data-workbar-expanded={storedLayout?.expanded || undefined}
      data-workbar-customizing={customizing || undefined}
    >
      {/* Rail one: the tab strip, and nothing that competes with it.
          Tabs are structure — "which part of this editor am I in" — and the
          commands below are actions. When both rails looked alike the tabs read
          as just more buttons, so the strip gets its own row, its own weight and
          a rule under it. Only bar-level settings sit at its right edge. */}
      <div className="spectra-workbar-rail-tabs" ref={tabsRailRef}>
        <div className="spectra-command-tabs" role="tablist" aria-label={`${label} categories`}>
          {tabs.map((tab, index) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              draggable={customizing}
              onClick={() => setActiveTab(tab)}
              onDragOver={(event) => {
                if (!customizing) return;
                event.preventDefault();
              }}
              onDrop={() => {
                if (dragCommandId) {
                  updateCommandLayout(dragCommandId, { tab, pinned: false });
                  setDragCommandId(null);
                  return;
                }
              }}
              onDragStart={(event) => {
                if (!customizing) return;
                event.dataTransfer.setData("text/spectra-tab", tab);
              }}
              onDragOverCapture={(event) => {
                if (!event.dataTransfer.types.includes("text/spectra-tab")) return;
                event.preventDefault();
              }}
              onDropCapture={(event) => {
                const source = event.dataTransfer.getData("text/spectra-tab");
                if (!source || source === tab) return;
                event.preventDefault();
                const next = [...tabs];
                const from = next.indexOf(source);
                if (from < 0) return;
                next.splice(from, 1);
                next.splice(index, 0, source);
                saveLayout({ ...storedLayout, tabOrder: next });
              }}
              className="spectra-command-tab"
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="spectra-workbar-rail-meta" ref={metaRef}>{renderCustomizeMenu()}</div>
      </div>
      {/* Rail two: the active tab's commands, starting at the same left edge as
          the tabs. They used to live in the trailing cluster, which right-aligned
          them and left a quarter of the bar empty on a wide window. */}
      <div className="spectra-workbar-rail-commands">
        <div className="spectra-workbar-commands relative" ref={commandsHostRef}>
          <div ref={measureRef} className="spectra-workbar-measure" aria-hidden>
            {rowActions.map((action) => (
              <span key={action.id} data-measure-id={action.id} data-measure-mode="full">
                <WorkbarAction action={action} />
              </span>
            ))}
            {rowActions.map((action) => (
              <span key={`${action.id}-icon`} data-measure-id={action.id} data-measure-mode="icon">
                <WorkbarAction action={action} iconOnly />
              </span>
            ))}
          </div>
          {resolvedModes.length > 1 ? (
            <div className="spectra-workbar-modes" role="group" aria-label="View" data-workbar-reserved>

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
          {activeTab === "General" && selector ? (
            <div className="flex shrink-0 items-center" data-workbar-reserved>
              {selector}
            </div>
          ) : null}
          {typeof children === "function" ? children(activeTab) : children}
          {storedLayout?.expanded ? (
            <div className="spectra-workbar-expanded-groups" role="group" aria-label={`${label} expanded commands`}>
              {Object.entries(Object.groupBy(barActions, (action) => action.group ?? activeTab)).map(([group, groupActions]) => (
                <div key={group} className="spectra-workbar-command-group" role="group" aria-label={group}>
                  <span className="spectra-workbar-command-group-label">{group}</span>
                  <div className="spectra-workbar-command-group-actions">
                    {(groupActions ?? []).map((action) => (
                      <WorkbarAction
                        key={action.id}
                        action={action}
                        iconOnly={measuredIconOnly.has(action.id)}
                        customizing={customizing}
                        onDragStart={() => setDragCommandId(action.id)}
                        onDrop={() => {
                          if (!dragCommandId || dragCommandId === action.id) return;
                          const source = rowActions.find((entry) => entry.id === dragCommandId);
                          if (!source) return;
                          const sourceOrder = storedLayout?.commands?.[source.id]?.order ?? source.group ? 0 : 0;
                          updateCommandLayout(dragCommandId, {
                            order: storedLayout?.commands?.[action.id]?.order ?? 0,
                            tab: activeTab,
                          });
                          updateCommandLayout(action.id, { order: sourceOrder });
                          setDragCommandId(null);
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : barActions.map((action) => (
            <WorkbarAction
              key={action.id}
              action={action}
              iconOnly={measuredIconOnly.has(action.id)}
              customizing={customizing}
              onDragStart={() => setDragCommandId(action.id)}
              onDrop={() => {
                if (!dragCommandId || dragCommandId === action.id) return;
                const sourceOrder = storedLayout?.commands?.[dragCommandId]?.order ?? 0;
                updateCommandLayout(dragCommandId, {
                  order: storedLayout?.commands?.[action.id]?.order ?? 0,
                  tab: activeTab,
                });
                updateCommandLayout(action.id, { order: sourceOrder });
                setDragCommandId(null);
              }}
            />
          ))}
          {/* The overflow sits with the commands it holds, not with the bar's
              settings: `⋯` here means "more of these", which is the only reading
              that helps someone hunting for a control that has been shed. */}
          {menuActions.length || overflow ? (
            <WorkbarMenu
              label={<MoreHorizontal className="size-4" />}
              ariaLabel={`More ${label.toLowerCase()}`}
              align="end"
              triggerClassName="spectra-workbar-overflow"
            >
              {menuActions.map((action) => (
                isRenderedControl(action)
                  ? <WorkbarControlMenuRow key={action.id} action={action} onEmit={(value) => action.onSelect(value)} />
                  : <WorkbarMenuItem key={action.id} action={action} />
              ))}
              {overflow}
            </WorkbarMenu>
          ) : null}
        </div>
        <div className="spectra-workbar-trail">
          {context ? (
            <span className="spectra-workbar-context" title={context}>
              {context}
            </span>
          ) : null}
          {trailing}
          {showPrimary && primary ? (
            <button
              type="button"
              className="spectra-workbar-primary spectra-workbar-primary-action"
              disabled={primary.disabled || primary.busy}
              onClick={() => {
                const binding: CommandBinding = {
                  id: `primary-${primary.label.toLowerCase().replaceAll(" ", "-")}`,
                  label: primary.label,
                  icon: primary.icon,
                  disabled: primary.disabled || primary.busy,
                  requires: primary.requires,
                  priority: "essential",
                  keepLabel: true,
                  onSelect: primary.onSelect,
                };
                executeCommand(commandForBinding(contract.type, binding, -1), commandCtx);
              }}
            >
              {primary.icon ? (
                <primary.icon className="size-3.5 shrink-0" />
              ) : null}
              <span>{primary.label}</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );

  /**
   * The customizer is a panel, not a control: a search field, a legend, and one
   * row per registered command. It lives in a hoisted inner function rather than
   * a separate component so it keeps reading the very layout state the bar
   * renders from — a second copy of that state is exactly how a customizer
   * drifts from the bar it is supposed to customize.
   */
  function renderCustomizeMenu() {
    const expandButton = (
      <button
        type="button"
        className="spectra-workbar-menu-trigger"
        aria-label={storedLayout?.expanded ? "Collapse workbar" : "Expand workbar"}
        title={storedLayout?.expanded ? "Collapse workbar" : "Expand workbar"}
        onClick={() => saveLayout({ ...storedLayout, expanded: !storedLayout?.expanded })}
      >
        {storedLayout?.expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      </button>
    );
    const resetButton = (
      <button
        type="button"
        className="spectra-workbar-menu-trigger"
        aria-label="Reset this workbar"
        title="Reset this workbar"
        disabled={!customizedCount && !storedLayout?.tabOrder && !storedLayout?.expanded}
        onClick={() => saveLayout({})}
      >
        <RotateCcw className="size-3.5" />
      </button>
    );
    const customizeButton = (
      <button
        type="button"
        className="spectra-workbar-menu-trigger"
        aria-pressed={customizing}
        aria-label={customizing ? "Finish customizing" : "Customize workbar"}
        title={customizing ? "Finish customizing" : "Customize workbar"}
        onClick={() => setCustomizing((value) => !value)}
      >
        <Settings2 className="size-3.5" />
      </button>
    );
    if (!metaCollapsed) {
      return (
        <div className="flex items-center gap-0.5">
          {customizeButton}
          {expandButton}
          {resetButton}
        </div>
      );
    }
    return (
      <WorkbarMenu
          label={<Settings2 className="size-3.5" />}
          ariaLabel={`Customize ${label.toLowerCase()}`}
          align="end"
          triggerClassName="spectra-workbar-menu-trigger"
        >
          <button type="button" role="menuitem" className={workbarMenuItemClass()} onClick={() => setCustomizing((value) => !value)}>
            <Settings2 className="size-3.5" />
            <span>{customizing ? "Finish customizing" : "Customize workbar"}</span>
          </button>
          <button type="button" role="menuitem" className={workbarMenuItemClass()} onClick={() => saveLayout({ ...storedLayout, expanded: !storedLayout?.expanded })}>
            {storedLayout?.expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            <span>{storedLayout?.expanded ? "Collapse workbar" : "Expand workbar"}</span>
          </button>
          
          
          <button
            type="button"
            role="menuitem"
            className={workbarMenuItemClass()}
            disabled={!customizedCount && !storedLayout?.tabOrder && !storedLayout?.expanded}
            title={customizedCount
              ? `Return ${customizedCount} changed ${customizedCount === 1 ? "command" : "commands"} to the default layout`
              : "This workbar is already at its default"}
            onClick={() => saveLayout({})}
          >
            <RotateCcw className="size-3.5" />
            <span>Reset this workbar{customizedCount ? ` (${customizedCount})` : ""}</span>
          </button>
        </WorkbarMenu>
    );
  }
}

/**
 * One command, one shape. A command that declares a control renders as that
 * control; everything else is the plain action button. Deciding this in a single
 * place is what keeps a font picker from becoming a second kind of citizen that
 * the customizer, the overflow menu and the AI path each have to special-case.
 */
function WorkbarAction({
  action,
  iconOnly,
  customizing,
  onDragStart,
  onDrop,
}: {
  action: CommandBinding;
  iconOnly?: boolean;
  customizing?: boolean;
  onDragStart?: () => void;
  onDrop?: () => void;
}) {
  return (
    <div
      data-workbar-action=""
      data-workbar-id={action.id}
      data-workbar-icon-only={iconOnly || undefined}
      draggable={customizing}
      onDragStart={onDragStart}
      onDragOver={(event) => {
        if (!customizing) return;
        event.preventDefault();
      }}
      onDrop={onDrop}
      className={cn(customizing && "cursor-grab")}
    >
      {isRenderedControl(action) ? (
        <WorkbarCommandControl action={action} onEmit={(value) => action.onSelect(value)} />
      ) : (
        <WorkbarActionButton action={action} iconOnly={iconOnly} />
      )}
    </div>
  );
}

function WorkbarActionButton({
  action,
  iconOnly,
}: {
  action: CommandBinding;
  iconOnly?: boolean;
}) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      aria-label={action.label}
      title={actionTitle(action)}
      aria-pressed={action.active}
      data-active={action.active || undefined}
      data-workbar-density={action.density ?? undefined}
      data-workbar-keep-label={action.keepLabel || undefined}
      data-workbar-icon-only={iconOnly || undefined}
      disabled={action.disabled}
      onClick={() => action.onSelect()}
      className="spectra-artifact-workbar-action"
    >
      {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
      {iconOnly ? null : <span>{action.label}</span>}
    </button>
  );
}

function WorkbarMenuItem({ action }: { action: CommandBinding }) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      role="menuitem"
      className={workbarMenuItemClass()}
      disabled={action.disabled}
      title={actionTitle(action)}
      data-active={action.active || undefined}
      onClick={() => action.onSelect()}
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
 * implementation both converge on.
 *
 * This control is a native `<select>`, not Radix. Sheet and slide pickers sit
 * in a ResizeObserver-driven studio: Radix SelectValue/ItemText will loop
 * `setState` when the trigger width or option identity flutters, and that
 * took down the whole Library. Native change events fire only on user action.
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
      <select
        aria-label={ariaLabel}
        className="spectra-workbar-item-trigger spectra-workbar-native-select min-w-0 flex-1"
        data-workbar-picker="native"
        value={index >= 0 ? value : items[0]!.value}
        onChange={(event) => onChange(event.target.value)}
      >
        {items.map((item, position) => (
          <option key={item.value} value={item.value} disabled={item.disabled}>
            {position + 1} · {item.label}
          </option>
        ))}
      </select>
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
  const [internalOpen, setInternalOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const resolvedOpen = open ?? internalOpen;
  const [position, setPosition] = useState<{
    top: number;
    left?: number;
    right?: number;
    maxHeight: number;
  }>({ top: 0, left: 0, maxHeight: 420 });
  const setOpen = useCallback((next: boolean) => {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange, open]);

  useLayoutEffect(() => {
    if (!resolvedOpen) return;
    const place = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 8;
      const above = rect.top - 8;
      const opensBelow = below >= Math.min(220, above);
      const maxHeight = Math.max(120, Math.min(420, opensBelow ? below : above));
      setPosition({
        top: opensBelow ? rect.bottom + 6 : Math.max(8, rect.top - maxHeight - 6),
        ...(align === "end"
          ? { right: Math.max(8, window.innerWidth - rect.right) }
          : { left: Math.max(8, rect.left) }),
        maxHeight,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [align, resolvedOpen]);

  useEffect(() => {
    if (!resolvedOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        contentRef.current?.contains(target)
      ) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [resolvedOpen, setOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={resolvedOpen}
        aria-label={ariaLabel ?? (typeof label === "string" ? label : "More")}
        className={cn("spectra-workbar-menu-trigger", triggerClassName)}
        onClick={() => setOpen(!resolvedOpen)}
      >
        {label}
        {typeof label === "string" ? (
          <ChevronDown className="size-3 shrink-0 text-[var(--text-secondary)]" />
        ) : null}
      </button>
      {resolvedOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={contentRef}
              role="menu"
              className="spectra-workbar-menu fixed z-[340] min-w-[210px] overflow-y-auto rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 text-[var(--text-primary)] shadow-[var(--shadow-lg)]"
              style={{
                top: position.top,
                left: position.left,
                right: position.right,
                maxHeight: position.maxHeight,
              }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
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
