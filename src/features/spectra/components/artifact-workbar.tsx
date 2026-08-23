"use client";

import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  GripVertical,
  Maximize2,
  Minimize2,
  Pencil,
  Search,
  Settings2,
  Star,
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
  const [renameCommandId, setRenameCommandId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [dragCommandId, setDragCommandId] = useState<string | null>(null);
  const [customizeQuery, setCustomizeQuery] = useState("");
  // Shortcut hints have to name the key that is actually on the keyboard. It
  // starts as "Ctrl" and corrects after mount rather than being read during
  // render, so the server and the client agree on the first paint.
  const [modKeyLabel, setModKeyLabel] = useState("Ctrl");
  useEffect(() => {
    if (/Mac|iPhone|iPad/i.test(navigator.userAgent)) setModKeyLabel("⌘");
  }, []);
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
  const customizationCommands = useMemo(
    () => commands
      .map(({ command }) => command)
      .sort((left, right) => {
        const tabOrder = tabs.indexOf(left.defaultPlacement.tab) - tabs.indexOf(right.defaultPlacement.tab);
        return tabOrder || left.defaultPlacement.order - right.defaultPlacement.order || left.title.localeCompare(right.title);
      }),
    [commands, tabs],
  );
  /**
   * The customizer groups by tab and filters by name, because an artifact type
   * registers dozens of commands: a flat list of sixty rows is a wall, and the
   * one command someone came to move is the one they cannot find. Matching is on
   * the visible label, the canonical title and the id, so both "size" and
   * "format.fontSize" land on the same row.
   */
  const customizerGroups = useMemo(() => {
    const query = customizeQuery.trim().toLowerCase();
    const groups = new Map<string, typeof customizationCommands>();
    for (const command of customizationCommands) {
      const label = storedLayout?.commands?.[command.id]?.label ?? command.title;
      if (
        query &&
        !`${label} ${command.title} ${command.id}`.toLowerCase().includes(query)
      ) continue;
      const tab = command.defaultPlacement.tab;
      const list = groups.get(tab) ?? [];
      list.push(command);
      groups.set(tab, list);
    }
    return [...groups.entries()];
  }, [customizationCommands, customizeQuery, storedLayout]);
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
    .filter(({ command }) =>
      !command.hidden &&
      (command.defaultPlacement.tab === activeTab || command.contextualTab === activeTab) &&
      command.availability(commandCtx).state !== "hidden")
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
  // Promotion is decided from the pane's density and each control's own width,
  // not from a viewport width and not by measuring the bar: a control is
  // rendered in the bar or in the menu, never in both, so a shedding bar can
  // never list an action twice.
  const budget = BAR_BUDGET[contract.density] ?? BAR_BUDGET.comfortable;
  // General is the favourites surface: essentials first, then secondary while
  // there is room. Category tabs are task surfaces, so their own commands fill
  // the row in placement order regardless of global priority — otherwise a
  // populated tab looks empty merely because its commands are marked advanced.
  const categoryTab = activeTab !== "General";
  const fitted = fitToBudget(
    categoryTab ? visibleActions : [...essential, ...secondary],
    budget,
  );
  const barActions = fitted.bar;
  const menuActions = categoryTab ? fitted.shed : [...fitted.shed, ...advanced];

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
      <div className="spectra-workbar-rail-tabs">
        <div className="spectra-command-tabs" role="tablist" aria-label={`${label} categories`}>
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className="spectra-command-tab"
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="spectra-workbar-rail-meta">{renderCustomizeMenu()}</div>
      </div>
      {/* Rail two: the active tab's commands, starting at the same left edge as
          the tabs. They used to live in the trailing cluster, which right-aligned
          them and left a quarter of the bar empty on a wide window. */}
      <div className="spectra-workbar-rail-commands">
        <div className="spectra-workbar-commands">
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
          {typeof children === "function" ? children(activeTab) : children}
          {storedLayout?.expanded ? (
            <div className="spectra-workbar-expanded-groups" role="group" aria-label={`${label} expanded commands`}>
              {Object.entries(Object.groupBy(barActions, (action) => action.group ?? activeTab)).map(([group, groupActions]) => (
                <div key={group} className="spectra-workbar-command-group" role="group" aria-label={group}>
                  <span className="spectra-workbar-command-group-label">{group}</span>
                  <div className="spectra-workbar-command-group-actions">
                    {(groupActions ?? []).map((action) => <WorkbarAction key={action.id} action={action} />)}
                  </div>
                </div>
              ))}
            </div>
          ) : barActions.map((action) => (
            <WorkbarAction key={action.id} action={action} />
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
          {customizing ? (
            <div className="spectra-workbar-tab-order" role="group" aria-label="Reorder tabs">
              <div className="spectra-workbar-customizer-heading">Tab order</div>
              {tabs.map((tab, index) => (
                <div key={`tab-${tab}`} className="spectra-command-tab-custom-row" role="group" aria-label={`Reorder the ${tab} tab`}>
                  <span className="min-w-0 truncate">{tab}</span>
                  <button
                    type="button"
                    aria-label={`Move the ${tab} tab earlier`}
                    title="Move tab earlier"
                    disabled={index === 0}
                    onClick={() => {
                      const next = [...tabs];
                      [next[index - 1], next[index]] = [next[index], next[index - 1]];
                      saveLayout({ ...storedLayout, tabOrder: next });
                    }}
                  >
                    <ChevronLeft className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move the ${tab} tab later`}
                    title="Move tab later"
                    disabled={index === tabs.length - 1}
                    onClick={() => {
                      const next = [...tabs];
                      [next[index], next[index + 1]] = [next[index + 1], next[index]];
                      saveLayout({ ...storedLayout, tabOrder: next });
                    }}
                  >
                    <ChevronRight className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {customizing ? (
            <div className="spectra-workbar-customizer" role="group" aria-label="Customize this workbar">
              <div className="spectra-workbar-customizer-search">
                <Search className="size-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
                <input
                  type="search"
                  value={customizeQuery}
                  aria-label="Find a command to customize"
                  placeholder={`Find a command in ${customizationCommands.length}`}
                  onChange={(event) => setCustomizeQuery(event.target.value)}
                  onKeyDown={(event) => {
                    // Escape clears the filter before it closes the menu, so a
                    // long list does not cost the whole panel.
                    if (event.key === "Escape" && customizeQuery) {
                      event.stopPropagation();
                      setCustomizeQuery("");
                    }
                  }}
                />
              </div>
              <div className="spectra-workbar-customizer-legend" aria-hidden="true">
                <span className="spectra-workbar-customizer-legend-name">Command</span>
                <span>Tab</span>
                <span>Order</span>
                <span>Pin</span>
                <span>Label</span>
                <span>Show</span>
              </div>
              {customizerGroups.length === 0 ? (
                <p className="spectra-workbar-customizer-empty">
                  No command matches “{customizeQuery}”.
                </p>
              ) : null}
              {customizerGroups.map(([groupTab, groupCommands]) => (
                <div key={`group-${groupTab}`} className="spectra-workbar-customizer-group">
                  <div className="spectra-workbar-customizer-heading">
                    {groupTab}
                    <span>{groupCommands.length}</span>
                  </div>
                  {groupCommands.map((command) => {
                    const current = storedLayout?.commands?.[command.id];
                    const currentTab = current?.pinned ? "General" : current?.tab ?? command.defaultPlacement.tab;
                    const label = current?.label ?? command.title;
                    const Icon = command.icon;
                    const customized = Boolean(
                      current && Object.values(current).some((value) => value !== undefined),
                    );
                    return (
                      <div
                        key={command.id}
                        className="spectra-command-custom-row"
                        role="group"
                        aria-label={`Customize ${command.title}`}
                        draggable
                        data-dragging={dragCommandId === command.id || undefined}
                        data-hidden={current?.hidden || undefined}
                        onDragStart={() => setDragCommandId(command.id)}
                        onDragEnd={() => setDragCommandId(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (!dragCommandId || dragCommandId === command.id) return;
                          const source = customizationCommands.findIndex((entry) => entry.id === dragCommandId);
                          const target = customizationCommands.findIndex((entry) => entry.id === command.id);
                          if (source < 0 || target < 0) return;
                          const sourceCommand = customizationCommands[source];
                          const targetCommand = customizationCommands[target];
                          const sourceOrder = storedLayout?.commands?.[sourceCommand.id]?.order ?? sourceCommand.defaultPlacement.order;
                          const targetOrder = storedLayout?.commands?.[targetCommand.id]?.order ?? targetCommand.defaultPlacement.order;
                          saveLayout({
                            ...storedLayout,
                            commands: {
                              ...storedLayout?.commands,
                              [sourceCommand.id]: { ...storedLayout?.commands?.[sourceCommand.id], order: targetOrder },
                              [targetCommand.id]: { ...storedLayout?.commands?.[targetCommand.id], order: sourceOrder },
                            },
                          });
                          setDragCommandId(null);
                        }}
                      >
                        {renameCommandId === command.id ? (
                          <input
                            autoFocus
                            value={renameDraft}
                            aria-label={`Rename ${command.title}`}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" && renameDraft.trim()) {
                                updateCommandLayout(command.id, { label: renameDraft.trim() });
                                setRenameCommandId(null);
                              }
                              if (event.key === "Escape") {
                                event.stopPropagation();
                                setRenameCommandId(null);
                              }
                            }}
                            className="spectra-command-custom-rename"
                          />
                        ) : (
                          <span className="spectra-command-custom-name" title={command.description}>
                            <GripVertical className="size-3 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
                            {Icon ? <Icon className="size-3.5 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" /> : null}
                            <span className="min-w-0 truncate">{label}</span>
                            {command.shortcut ? (
                              <kbd className="spectra-command-custom-shortcut">{command.shortcut.replace("Mod", modKeyLabel)}</kbd>
                            ) : null}
                          </span>
                        )}
                        <select
                          aria-label={`Move ${command.title} to tab`}
                          value={currentTab}
                          onChange={(event) => updateCommandLayout(command.id, { tab: event.target.value, pinned: false })}
                        >
                          {tabs.filter((tab) => !contextualTabsFor(contract.type).includes(tab)).map((tab) => <option key={tab} value={tab}>{tab}</option>)}
                        </select>
                        <span className="spectra-command-custom-order">
                          <button
                            type="button"
                            aria-label={`Move ${command.title} earlier`}
                            title="Move earlier"
                            onClick={() => updateCommandLayout(command.id, { order: (current?.order ?? command.defaultPlacement.order) - 1 })}
                          >
                            <ArrowUp className="size-3" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${command.title} later`}
                            title="Move later"
                            onClick={() => updateCommandLayout(command.id, { order: (current?.order ?? command.defaultPlacement.order) + 1 })}
                          >
                            <ArrowDown className="size-3" />
                          </button>
                        </span>
                        <button
                          type="button"
                          aria-label={current?.pinned ? `Unpin ${command.title} from General` : `Pin ${command.title} in General`}
                          aria-pressed={Boolean(current?.pinned) || command.defaultPlacement.tab === "General"}
                          title={current?.pinned ? "Unpin from General" : "Pin in General"}
                          data-active={current?.pinned || undefined}
                          onClick={() => updateCommandLayout(command.id, current?.pinned ? { pinned: false, tab: command.sourceTab ?? command.defaultPlacement.tab } : { pinned: true, tab: "General" })}
                        >
                          <Star className="size-3" />
                        </button>
                        {renameCommandId === command.id ? (
                          <button
                            type="button"
                            aria-label={`Save label for ${command.title}`}
                            title="Save label"
                            onClick={() => {
                              if (renameDraft.trim()) updateCommandLayout(command.id, { label: renameDraft.trim() });
                              setRenameCommandId(null);
                            }}
                          >
                            <Check className="size-3" />
                          </button>
                        ) : (
                          <span className="spectra-command-custom-order">
                            <button
                              type="button"
                              aria-label={`Rename ${command.title}`}
                              title="Rename the visible label"
                              onClick={() => { setRenameCommandId(command.id); setRenameDraft(label); }}
                            >
                              <Pencil className="size-3" />
                            </button>
                            <button
                              type="button"
                              aria-label={`${current?.density === "medium" ? "Shrink" : "Widen"} ${command.title}`}
                              aria-pressed={current?.density === "medium"}
                              title={current?.density === "medium" ? "Keep the label at every width" : "Icon only when the bar is tight"}
                              data-active={current?.density === "medium" || undefined}
                              onClick={() => updateCommandLayout(command.id, { density: current?.density === "medium" ? "compact" : "medium" })}
                            >
                              <CaseSensitive className="size-3.5" />
                            </button>
                          </span>
                        )}
                        <span className="spectra-command-custom-order">
                          <button
                            type="button"
                            aria-label={current?.hidden ? `Show ${command.title}` : `Hide ${command.title}`}
                            title={current?.hidden ? "Show in the workbar" : "Hide from the workbar"}
                            onClick={() => updateCommandLayout(command.id, { hidden: !current?.hidden })}
                          >
                            {current?.hidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                          </button>
                          <button
                            type="button"
                            aria-label={`Reset ${command.title} to its default`}
                            title="Reset this command"
                            disabled={!customized}
                            onClick={() => saveLayout({
                              ...storedLayout,
                              commands: Object.fromEntries(
                                Object.entries(storedLayout?.commands ?? {}).filter(([id]) => id !== command.id),
                              ),
                            })}
                          >
                            <RotateCcw className="size-3" />
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
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
function WorkbarAction({ action }: { action: CommandBinding }) {
  if (isRenderedControl(action)) {
    return <WorkbarCommandControl action={action} onEmit={(value) => action.onSelect(value)} />;
  }
  return <WorkbarActionButton action={action} />;
}

function WorkbarActionButton({ action }: { action: CommandBinding }) {
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
      disabled={action.disabled}
      onClick={() => action.onSelect()}
      className="spectra-artifact-workbar-action"
    >
      {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
      <span>{action.label}</span>
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
