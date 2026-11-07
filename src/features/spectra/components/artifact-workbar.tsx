"use client";

import {
  Check,
  ChevronDown,
  GripVertical,
  RotateCcw,
  MoreHorizontal,
  Redo2,
  Settings2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { moveKey, planGroupedLayout, type GroupedLayout } from "@/components/ui/adaptive-groups";
import { SelectField } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { WorkCapability } from "../work/registry";
import {
  COMMAND_TABS,
  commandContext,
  commandForBinding,
  contextualTabsFor,
  eventBelongsToFocusedStudio,
  executeCommand,
  resolveCommandLayout,
  shortcutMatchesEvent,
  tabsFor,
  type CommandBinding,
  type CommandLayout,
  type CommandParam,
} from "../commands";
import { useSpectraPreferences } from "../settings/preference-store";
import {
  useStudioContract,
  type StudioContentHistory,
} from "./artifact-studio-shell";
import {
  WorkbarCommandControl,
  WorkbarControlMenuRow,
  isRenderedControl,
} from "./workbar-controls";
import {
  actionOnTab,
  arrangeWorkbar,
  groupedItemsOf,
  rareGroupsOf,
  rareSteps,
  type ArrangedAction,
  type ArrangedGroup,
  type WorkbarAction as PlacedAction,
} from "./workbar-arrange";
import {
  HISTORY_GROUP,
  WORKBAR_METRICS,
  estimateCommandWidths,
  estimateGroupMenuWidth,
  isHistoryCommand,
  planStepsFor,
} from "./workbar-plans";

export type { CommandBinding } from "../commands";

/**
 * Undo and Redo over the shell's content history (quiz, flashcards, plan,
 * timetable). They lead the bar, as the whiteboard's do, and are absent when
 * the viewer cannot edit.
 */
export function contentHistoryBindings(
  history: StudioContentHistory | undefined,
): CommandBinding[] {
  if (!history) return [];
  return [
    {
      id: "undo",
      label: "Undo",
      icon: Undo2,
      priority: "essential",
      requires: "edit",
      disabled: !history.canUndo,
      hint: "Ctrl+Z",
      onSelect: () => history.step("undo"),
    },
    {
      id: "redo",
      label: "Redo",
      icon: Redo2,
      priority: "essential",
      requires: "edit",
      disabled: !history.canRedo,
      hint: "Ctrl+Shift+Z",
      onSelect: () => history.step("redo"),
    },
  ];
}

/**
 * Spectra's one artifact workbar (EDITORS.md, "The workbar").
 *
 * Two rails at a fixed height: the tabs (contextual tabs appear while their
 * object is selected), and the active tab's commands in their groups. When
 * there is room every command shows inline with its words. When there is not,
 * the editor's hand-written plan (`workbar-plans.ts`) decides what gives way:
 * a label whose icon is unmistakable, or a whole group into its own dropdown,
 * or a group into More. Undo and redo lead every tab and never collapse;
 * universal symbols are never labelled; a command whose meaning is in its
 * words is never shrunk to an icon.
 *
 * A person can reorder groups and commands in customise mode. The order is
 * saved per person and per editor; the plan follows each command by id.
 */

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

type BarAction = ArrangedAction & { onSelect: (value?: CommandParam) => void };

const EMPTY_LAYOUT: Pick<GroupedLayout, "labelHidden" | "groupMenus" | "inMore"> = {
  labelHidden: new Set(),
  groupMenus: new Set(),
  inMore: new Set(),
};

function tooltipOf(action: CommandBinding) {
  return action.hint ? `${action.label} · ${action.hint}` : action.label;
}

function layoutKey(layout: Pick<GroupedLayout, "labelHidden" | "groupMenus" | "inMore">) {
  return [layout.labelHidden, layout.groupMenus, layout.inMore]
    .map((set) => [...set].sort().join(","))
    .join("|");
}

/**
 * The bar. `modes` is required with no default so a type has to make a visible
 * decision: `{ registry: true, … }` hands the mode list to `work/registry`
 * (the answer for every registered type), an explicit array is for surfaces the
 * registry does not model, and `[]` states that the type has no modes.
 */
const MAX_WORKBAR_OVERRUN = 64;

export function ArtifactWorkbar({
  label,
  modes,
  selector,
  context,
  actions = [],
  primary,
  trailing,
  overflow,
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
   * Extra items rendered inside More, after the bar's own. Use this for grouped
   * exports or templates — never for a second overflow control.
   */
  overflow?: ReactNode;
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
  const [collapse, setCollapse] = useState(EMPTY_LAYOUT);
  // Pixels the last plan overran by on screen (a font that rendered wider than
  // measured); the next plan leaves that much more room.
  const [overrun, setOverrun] = useState(0);
  const [dragging, setDragging] = useState<{ kind: "command" | "group"; id: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const commandsHostRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  // The context a work opens in is its resting one (a deck with nothing
  // selected): opening the work, or coming back to it, shows General, and
  // only a selection after that raises its own tab.
  const restingSelectionContext = useRef(selectionContext);
  const previousSelectionContext = useRef(selectionContext);
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
  const allTabs = useMemo(
    () => tabsFor(contract.type, selectionContext, storedLayout),
    [contract.type, selectionContext, storedLayout],
  );
  const contextualTabs = useMemo(() => {
    const permanent = COMMAND_TABS[contract.type];
    return new Set(contextualTabsFor(contract.type).filter((tab) => !permanent.includes(tab)));
  }, [contract.type]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!eventBelongsToFocusedStudio(event, contract.artifactId, rootRef.current)) return;
      const match = commands.find(({ command }) =>
        shortcutMatchesEvent(event, command.shortcut),
      );
      if (!match) return;
      event.preventDefault();
      executeCommand(match.command, commandCtx);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [commandCtx, commands, contract.artifactId]);

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
  const customized = Boolean(
    storedLayout?.tabOrder?.length ||
      Object.keys(storedLayout?.groupOrder ?? {}).length ||
      Object.keys(storedLayout?.commandOrder ?? {}).length ||
      Object.values(storedLayout?.commands ?? {}).some(
        (override) => override && Object.values(override).some((value) => value !== undefined),
      ),
  );

  const resolvedModes = useMemo<readonly WorkbarModeSpec[]>(() => {
    if (Array.isArray(modes)) return modes;
    const registryModes = modes as WorkbarRegistryModes;
    // The registry is the authority on which modes exist and who may enter
    // them, so authoring is always first and an activity cannot become a peer
    // tab a type invented for itself.
    return contract.modes.map((mode) => ({
      id: mode.id,
      label: mode.label,
      active: mode.id === registryModes.value,
      onSelect: () => registryModes.onChange(mode.id),
    }));
  }, [contract.modes, modes]);

  const placedActions = useMemo<PlacedAction[]>(() => commands
    .filter(({ command }) => !command.hidden && command.availability(commandCtx).state !== "hidden")
    .map(({ binding, command }) => {
      const availability = command.availability(commandCtx);
      return {
        ...binding,
        id: command.id,
        label: command.title,
        group: command.defaultPlacement.group,
        placedTab: command.defaultPlacement.tab,
        sourceTab: command.sourceTab,
        contextualTab: command.contextualTab,
        disabled: availability.state === "disabled",
        hint: availability.state === "disabled" ? availability.reason : binding.hint,
        // The one execute path. A pointer, a shortcut, a menu and the AI
        // dispatcher all arrive here, and a parameterized control hands its
        // value straight through rather than closing over a second setter.
        onSelect: (value?: CommandParam) => executeCommand(command, commandCtx, value),
      };
    }), [commandCtx, commands]);
  // A tab with nothing on it is not shown. While customising every tab stays,
  // so a command can be dropped onto one that is empty.
  const tabs = useMemo(
    () => customizing
      ? allTabs
      : allTabs.filter((tab) => tab === "General" || placedActions.some((action) => !isHistoryCommand(contract.type, action.id) && actionOnTab(action, tab))),
    [allTabs, contract.type, customizing, placedActions],
  );
  const tabSignature = tabs.join("\u001f");
  useEffect(() => {
    if (selectionContext !== previousSelectionContext.current) {
      previousSelectionContext.current = selectionContext;
      const next = selectionContext && selectionContext !== restingSelectionContext.current && tabs.includes(selectionContext)
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

  const arranged = useMemo(
    () => arrangeWorkbar({ type: contract.type, tab: activeTab, actions: placedActions, layout: storedLayout }),
    [activeTab, contract.type, placedActions, storedLayout],
  );
  const barGroups = useMemo<ArrangedGroup[]>(
    () => [
      ...(arranged.history.length ? [{ name: HISTORY_GROUP, actions: arranged.history }] : []),
      ...arranged.groups,
    ],
    [arranged],
  );
  // Rare commands give way first, then the tab's authored plan runs.
  const steps = useMemo(
    () => [...rareSteps(arranged), ...planStepsFor(contract.type, activeTab)],
    [activeTab, arranged, contract.type],
  );
  const folded = useMemo(() => rareGroupsOf(arranged), [arranged]);
  const moreAlways = Boolean(overflow);
  const measureSignature = barGroups
    .map((group) => `${group.name}:${group.actions.map((action) => `${action.id}/${action.label}/${action.disabled ? 1 : 0}`).join(",")}`)
    .join("\u001f");

  useLayoutEffect(() => {
    const host = commandsHostRef.current;
    const measure = measureRef.current;
    if (!host || !measure) return;
    const recompute = () => {
      const hostWidth = host.clientWidth;
      // Before the first layout there is nothing honest to plan against.
      if (hostWidth < 40) return;
      const reserved = [...host.querySelectorAll<HTMLElement>("[data-workbar-reserved]")]
        .reduce((total, node) => total + node.offsetWidth + WORKBAR_METRICS.groupGap, 0);
      const available = Math.max(0, hostWidth - reserved - overrun);
      const measured = new Map<string, { full: number; icon: number }>();
      const groupMenu: Record<string, number> = {};
      for (const node of measure.querySelectorAll<HTMLElement>("[data-measure-id]")) {
        const id = node.dataset.measureId!;
        const width = Math.ceil(node.offsetWidth);
        const current = measured.get(id) ?? { full: 0, icon: 0 };
        if (node.dataset.measureMode === "icon") current.icon = width;
        else current.full = width;
        measured.set(id, current);
      }
      for (const node of measure.querySelectorAll<HTMLElement>("[data-measure-group]")) {
        const width = Math.ceil(node.offsetWidth);
        if (width > 0) groupMenu[node.dataset.measureGroup!] = width;
      }
      const items = groupedItemsOf(arranged, (action) => {
        const real = measured.get(action.id);
        // A control that has not laid out yet (the first frame, jsdom) is
        // planned at its estimated width rather than as nothing.
        return real && real.full > 0 && real.icon > 0 ? real : estimateCommandWidths(action);
      });
      for (const group of arranged.groups) groupMenu[group.name] ??= estimateGroupMenuWidth(group.name);
      const next = planGroupedLayout({
        items,
        plan: steps,
        folded,
        available,
        metrics: {
          ...WORKBAR_METRICS,
          groupMenu,
          moreAlways,
        },
      });
      setCollapse((current) => (layoutKey(current) === layoutKey(next) ? current : next));
    };
    recompute();
    let width = host.clientWidth;
    const observer = new ResizeObserver(() => {
      // A new width is a new plan: what was too wide at the old one says nothing now.
      if (host.clientWidth !== width && overrun > 0) {
        width = host.clientWidth;
        setOverrun(0);
        return;
      }
      width = host.clientWidth;
      recompute();
    });
    observer.observe(host);
    return () => observer.disconnect();
    // `measureSignature` stands for `arranged`: a fresh array with the same
    // commands must not re-plan, or a selection that only changes state would
    // relayout the bar every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureSignature, customizing, moreAlways, overrun]);

  // A new set of commands is planned from what is measured again.
  useLayoutEffect(() => setOverrun(0), [measureSignature]);
  // The plan is checked against the bar it produced: if the last group still
  // runs past the edge, plan again with that much less room.
  useLayoutEffect(() => {
    const host = commandsHostRef.current;
    if (!host || customizing) return;
    const shown = [...host.children].filter((child) => !child.classList.contains("spectra-workbar-measure"));
    const right = Math.max(...shown.map((child) => child.getBoundingClientRect().right));
    const over = Math.ceil(right - host.getBoundingClientRect().right);
    // A font rendering wider than measured is a few pixels, never the whole bar.
    if (over > 0) setOverrun((current) => Math.min(MAX_WORKBAR_OVERRUN, current + over));
  }, [collapse, customizing]);

  const layout = customizing ? EMPTY_LAYOUT : collapse;
  const moreGroups = useMemo(
    () => arranged.groups
      .map((group) => ({ name: group.name, actions: group.actions.filter((action) => layout.inMore.has(action.id)) }))
      .filter((group) => group.actions.length),
    [arranged, layout.inMore],
  );

  const showPrimary = !primary?.requires || can(primary.requires);

  /** Customise mode: move a command within its group, or a group within the tab. */
  const moveCommand = (id: string, before: string | null) => {
    const order = arranged.groups.flatMap((group) => group.actions.map((action) => action.id));
    saveLayout({
      ...storedLayout,
      commandOrder: { ...storedLayout?.commandOrder, [activeTab]: moveKey(order, id, before) },
    });
  };
  const moveGroup = (name: string, before: string | null) => {
    const order = arranged.groups.map((group) => group.name);
    saveLayout({
      ...storedLayout,
      groupOrder: { ...storedLayout?.groupOrder, [activeTab]: moveKey(order, name, before) },
    });
  };
  const stepCommand = (group: ArrangedGroup, index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= group.actions.length) return;
    const id = group.actions[index]!.id;
    const before = delta < 0 ? group.actions[target]!.id : group.actions[target + 1]?.id ?? null;
    if (before === null) {
      // Moving to the end of its group is moving before the next group's first.
      const next = arranged.groups[arranged.groups.indexOf(group) + 1]?.actions[0]?.id ?? null;
      moveCommand(id, next);
    } else moveCommand(id, before);
  };
  const stepGroup = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= arranged.groups.length) return;
    const name = arranged.groups[index]!.name;
    moveGroup(name, delta < 0 ? arranged.groups[target]!.name : arranged.groups[target + 1]?.name ?? null);
  };
  const arrowStep = (event: ReactKeyboardEvent, step: (delta: -1 | 1) => void) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    step(event.key === "ArrowLeft" ? -1 : 1);
  };

  return (
    <div
      ref={rootRef}
      className={cn("spectra-editor-workbar spectra-artifact-workbar", className)}
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      data-workbar-density={contract.density}
      data-workbar-customizing={customizing || undefined}
    >
      {/* Rail one: the tab strip, and the bar's own settings at its right edge. */}
      <div className="spectra-workbar-rail-tabs">
        <div className="spectra-command-tabs" role="tablist" aria-label={`${label} categories`}>
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              data-contextual={contextualTabs.has(tab) || undefined}
              data-life-receive={customizing || undefined}
              onClick={() => setActiveTab(tab)}
              onDragOver={(event) => {
                if (customizing && dragging?.kind === "command") event.preventDefault();
              }}
              onDrop={(event) => {
                // A command dropped on a tab moves to that tab.
                if (!customizing || dragging?.kind !== "command") return;
                event.preventDefault();
                saveLayout({
                  ...storedLayout,
                  commands: {
                    ...storedLayout?.commands,
                    [dragging.id]: { ...storedLayout?.commands?.[dragging.id], tab, pinned: false },
                  },
                });
                setDragging(null);
              }}
              className="spectra-command-tab"
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="spectra-workbar-rail-meta">
          {customizing ? (
            <button
              type="button"
              className="spectra-workbar-menu-trigger spectra-workbar-done"
              aria-pressed
              aria-label="Finish customizing"
              onClick={() => setCustomizing(false)}
            >
              <Check className="size-3.5" />
              <span>Done</span>
            </button>
          ) : (
            <Tooltip label="Customize workbar" side="bottom">
              <button
                type="button"
                className="spectra-workbar-menu-trigger"
                aria-pressed={false}
                aria-label="Customize workbar"
                onClick={() => setCustomizing(true)}
              >
                <Settings2 className="size-3.5" />
              </button>
            </Tooltip>
          )}
          <Tooltip
            label={customized ? "Reset this workbar to its shipped order" : "This workbar is already in its shipped order"}
            side="bottom"
          >
            <button
              type="button"
              className="spectra-workbar-menu-trigger"
              aria-label="Reset this workbar"
              disabled={!customized}
              onClick={() => saveLayout({})}
            >
              <RotateCcw className="size-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>
      {/* Rail two: the active tab's commands, in their groups. */}
      <div className="spectra-workbar-rail-commands">
        <div className="spectra-workbar-commands relative" ref={commandsHostRef}>
          <div ref={measureRef} className="spectra-workbar-measure" aria-hidden inert>
            {barGroups.flatMap((group) => group.actions).map((action) => (
              <Fragment key={action.id}>
                <span data-measure-id={action.id} data-measure-mode="full">
                  <WorkbarAction action={action as BarAction} />
                </span>
                <span data-measure-id={action.id} data-measure-mode="icon">
                  <WorkbarAction action={action as BarAction} iconOnly />
                </span>
              </Fragment>
            ))}
            {arranged.groups.map((group) => (
              <span key={group.name} data-measure-group={group.name} className="spectra-workbar-menu-trigger">
                {group.name}
                <span className="inline-block size-3" />
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
          {customizing
            ? renderCustomizing()
            : barGroups.map((group) => {
                const shown = group.actions.filter((action) => !layout.inMore.has(action.id));
                if (!shown.length) return null;
                const folded = layout.groupMenus.has(group.name);
                return (
                  <div
                    key={group.name}
                    className="spectra-workbar-group"
                    role="group"
                    aria-label={group.name}
                    data-workbar-group={group.name}
                    data-workbar-history={group.name === HISTORY_GROUP || undefined}
                  >
                    {folded ? (
                      <WorkbarMenu
                        label={group.name}
                        ariaLabel={`${group.name} group`}
                        triggerClassName="spectra-workbar-group-menu"
                      >
                        {shown.map((action) => (
                          <WorkbarMenuEntry key={action.id} action={action as BarAction} />
                        ))}
                      </WorkbarMenu>
                    ) : (
                      shown.map((action) => (
                        <WorkbarAction
                          key={action.id}
                          action={action as BarAction}
                          iconOnly={action.labelPolicy === "never" || layout.labelHidden.has(action.id)}
                        />
                      ))
                    )}
                  </div>
                );
              })}
          {/* More sits with the commands it holds: `⋯` here means "more of these". */}
          {!customizing && (moreGroups.length || overflow) ? (
            <WorkbarMenu
              label={<MoreHorizontal className="size-4" />}
              ariaLabel={`More ${label.toLowerCase()}`}
              align="end"
              triggerClassName="spectra-workbar-overflow"
            >
              <MoreGroups groups={moreGroups} />
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
   * Customise mode, on the live bar: every group open, each command a chip a
   * person can drag (or move with the arrow keys) within its group, and each
   * group a handle that moves the whole group. Undo and redo stay first and
   * cannot move. Nothing executes while customising.
   */
  function renderCustomizing() {
    return (
      <div className="spectra-workbar-customize" aria-label={`Arrange ${activeTab}`} role="group">
        {arranged.history.length ? (
          <div className="spectra-workbar-group" data-workbar-history role="group" aria-label={HISTORY_GROUP}>
            {arranged.history.map((action) => (
              <span key={action.id} className="spectra-workbar-chip" data-fixed aria-label={`${action.label} stays first`}>
                {action.icon ? <action.icon className="size-3.5" /> : action.label}
              </span>
            ))}
          </div>
        ) : null}
        {arranged.groups.map((group, groupIndex) => (
          <div
            key={group.name}
            className="spectra-workbar-group"
            role="group"
            aria-label={group.name}
            data-workbar-group={group.name}
            data-drop-target={dragging?.kind === "group" && dragging.id !== group.name ? "" : undefined}
            onDragOver={(event) => {
              if (dragging?.kind === "group") event.preventDefault();
            }}
            onDrop={(event) => {
              if (dragging?.kind !== "group" || dragging.id === group.name) return;
              event.preventDefault();
              moveGroup(dragging.id, group.name);
              setDragging(null);
            }}
          >
            <button
              type="button"
              draggable
              className="spectra-workbar-group-handle"
              aria-label={`Move group ${group.name}`}
              aria-roledescription="movable group"
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                setDragging({ kind: "group", id: group.name });
              }}
              onDragEnd={() => setDragging(null)}
              onKeyDown={(event) => arrowStep(event, (delta) => stepGroup(groupIndex, delta))}
            >
              <GripVertical className="size-3" />
              <span>{group.name}</span>
            </button>
            {group.actions.map((action, index) => (
              <button
                key={action.id}
                type="button"
                draggable
                className="spectra-workbar-chip"
                aria-label={`Move ${action.label}`}
                aria-roledescription="movable command"
                data-dragging={dragging?.id === action.id || undefined}
                onDragStart={(event) => {
                  event.stopPropagation();
                  event.dataTransfer.effectAllowed = "move";
                  setDragging({ kind: "command", id: action.id });
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(event) => {
                  if (dragging?.kind === "command") event.preventDefault();
                }}
                onDrop={(event) => {
                  if (dragging?.kind !== "command" || dragging.id === action.id) return;
                  event.preventDefault();
                  event.stopPropagation();
                  moveCommand(dragging.id, action.id);
                  setDragging(null);
                }}
                onKeyDown={(event) => arrowStep(event, (delta) => stepCommand(group, index, delta))}
              >
                {action.icon ? <action.icon className="size-3.5 shrink-0" /> : null}
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    );
  }
}

/**
 * One command, one shape. A command that declares a control renders as that
 * control; everything else is the plain action button.
 */
function WorkbarAction({ action, iconOnly }: { action: BarAction; iconOnly?: boolean }) {
  return (
    <div data-workbar-action="" data-workbar-id={action.id} data-workbar-icon-only={iconOnly || undefined}>
      {isRenderedControl(action) ? (
        <WorkbarCommandControl action={action} onEmit={(value) => action.onSelect(value)} />
      ) : (
        <WorkbarActionButton action={action} iconOnly={iconOnly} />
      )}
    </div>
  );
}

function WorkbarActionButton({ action, iconOnly }: { action: BarAction; iconOnly?: boolean }) {
  const Icon = action.icon;
  const showLabel = !(iconOnly && Icon);
  const hintId = useId();
  const button = (
    <button
      type="button"
      aria-label={action.label}
      aria-describedby={action.hint ? hintId : undefined}
      aria-pressed={action.active}
      data-active={action.active || undefined}
      data-workbar-icon-only={!showLabel || undefined}
      disabled={action.disabled}
      onClick={() => action.onSelect()}
      className="spectra-artifact-workbar-action"
    >
      {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
      {showLabel ? <span>{action.label}</span> : null}
      {action.hint ? <span id={hintId} hidden>{action.hint}</span> : null}
    </button>
  );
  // The words are on screen when the label shows; the tooltip is for the icon
  // alone, or for the reason and the shortcut the label does not carry.
  return !showLabel || action.hint ? <Tooltip label={tooltipOf(action)}>{button}</Tooltip> : button;
}

/**
 * What More holds. One group is listed as it is; several are one row each that
 * opens its commands beside the menu, so the list stays short. A group of one
 * is just that command.
 */
function MoreGroups({ groups }: { groups: ReadonlyArray<{ name: string; actions: ArrangedAction[] }> }) {
  if (groups.length === 1) {
    return groups[0]!.actions.map((action) => <WorkbarMenuEntry key={action.id} action={action as BarAction} />);
  }
  return groups.map((group) => {
    const only = group.actions.length === 1 ? (group.actions[0] as BarAction) : null;
    // A lone command is just itself; a lone control still opens, to show its choices.
    if (only && !isRenderedControl(only)) return <WorkbarMenuEntry key={group.name} action={only} />;
    const Lead = group.actions.find((action) => action.icon)?.icon;
    return (
      <DropdownMenuSub key={group.name}>
        <DropdownMenuSubTrigger className={workbarMenuItemClass()}>
          <span className="grid size-4 shrink-0 place-items-center text-[var(--text-secondary)]">
            {Lead ? <Lead className="size-3.5" /> : null}
          </span>
          <span className="min-w-0 flex-1 truncate text-left">{only ? only.label : group.name}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent layer="dropdown" className="spectra-workbar-menu" data-single-control={only ? "" : undefined}>
          {group.actions.map((action) => (
            <WorkbarMenuEntry key={action.id} action={action as BarAction} />
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  });
}

/** A command inside a group's dropdown or More: the choice is already open. */
function WorkbarMenuEntry({ action }: { action: BarAction }) {
  if (isRenderedControl(action)) {
    return <WorkbarControlMenuRow action={action} onEmit={(value) => action.onSelect(value)} />;
  }
  const Icon = action.icon;
  return (
    <WorkbarMenuAction
      disabled={action.disabled}
      title={action.hint}
      data-active={action.active || undefined}
      onSelect={() => action.onSelect()}
    >
      <span className="grid size-4 shrink-0 place-items-center text-[var(--text-secondary)]">
        {Icon ? <Icon className="size-3.5" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{action.label}</span>
    </WorkbarMenuAction>
  );
}

// The item picker lives in its own module; the bar re-exports it so every
// studio keeps importing its tools from one place.
export { WorkbarItemSelector } from "./workbar-item-selector";

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
  const resolvedOpen = open ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <DropdownMenu modal={false} open={resolvedOpen} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel ?? (typeof label === "string" ? label : "More")}
          className={cn("spectra-workbar-menu-trigger", triggerClassName)}
        >
          {label}
          {typeof label === "string" ? (
            <ChevronDown className="size-3 shrink-0 text-[var(--text-secondary)]" />
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        layer="dropdown"
        className="spectra-workbar-menu"
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A keyboard-aware action row for callers that contribute to WorkbarMore. */
export function WorkbarMenuAction({
  children,
  disabled,
  title,
  onSelect,
  ...data
}: {
  children: ReactNode;
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
  "data-active"?: boolean;
}) {
  return (
    <DropdownMenuItem
      className={workbarMenuItemClass()}
      disabled={disabled}
      title={title}
      onSelect={onSelect}
      {...data}
    >
      {children}
    </DropdownMenuItem>
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
  return "flex w-full items-center gap-2.5 rounded-chip px-2.5 py-[7px] text-left text-ui font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:pointer-events-none disabled:opacity-45";
}
