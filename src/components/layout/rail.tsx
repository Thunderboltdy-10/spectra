"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/icons";
import { PrismLoader } from "@/components/spectra-prism-optic";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getAdministration, type AdministrationIdentity } from "@/features/spectra/administration/api";
import { CatalogProgress } from "@/features/spectra/components/catalog-progress";
import { formatRelativeTime } from "@/features/spectra/components/spectra-view-model";
import { useWorkspaceCatalog } from "@/features/spectra/data/use-catalog-pages";
import type { SpectraWorkspace } from "@/features/spectra/data/api";
import { spectraBus } from "@/features/spectra/events";
import { useSpectraRouter } from "@/features/spectra/hooks/use-spectra-router";
import { life } from "@/features/spectra/life/life";
import { useLifeEntrance, unformElement } from "@/features/spectra/life/use-life";
import { useTreeQuickView } from "@/features/spectra/organization/tree-client";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./account-menu";
import { reviewShareInvitations, type ShellNotification } from "./shell-notifications";
import { useShellNotifications } from "./use-shell-notifications";

/*
 * The rail (SHELL.md, "The rail"): the prism as the brand beside a compact
 * workspace switcher, the seven destinations, a few pinned works, and one
 * account row. It is 232 px wide, or 56 px of icons when collapsed — by the
 * user, by a crowded page, or below 1024 px. Its width is one CSS variable,
 * `--spectra-rail-width`, so the stage and the island follow it exactly.
 */

export const RAIL_WIDTH = 232;
export const RAIL_COLLAPSED_WIDTH = 56;
const NARROW = "(max-width: 1023px)";
const STORAGE_KEY = "spectra:sidebar-collapsed";
const PINNED_LIMIT = 6;

export type RailDestination = {
  key: "home" | "library" | "calendar" | "conversations" | "school" | "agents" | "devices";
  href: string;
  label: string;
  glyph: IconName;
  routes: string[];
};

export const RAIL_DESTINATIONS: RailDestination[] = [
  { key: "home", href: "/workspace", label: "Home", glyph: "home", routes: ["/workspace"] },
  { key: "library", href: "/library", label: "Library", glyph: "library", routes: ["/library"] },
  { key: "calendar", href: "/calendar", label: "Calendar", glyph: "calendar", routes: ["/calendar"] },
  { key: "conversations", href: "/chat", label: "Conversations", glyph: "conversations", routes: ["/chat"] },
  { key: "school", href: "/school", label: "School", glyph: "school", routes: ["/school", "/managebac"] },
  { key: "agents", href: "/agents", label: "Agents", glyph: "agents", routes: ["/agents"] },
  { key: "devices", href: "/devices", label: "Devices", glyph: "devices", routes: ["/devices"] },
];

/** Which destination is current: the threads view claims Conversations while it is open. */
export function activeRailDestination(pathname: string, threadsOpen: boolean): RailDestination["key"] | null {
  if (threadsOpen) return "conversations";
  return RAIL_DESTINATIONS.find(({ routes }) => routes.some((route) => pathname === route || pathname.startsWith(`${route}/`)))?.key ?? null;
}

const TYPE_GLYPH: Record<string, IconName> = {
  document: "document",
  presentation: "slides",
  sheets: "sheet",
  quiz: "quiz",
  flashcard_deck: "flashcards",
  whiteboard: "whiteboard",
  code: "code",
  planner_task: "task",
  timetable: "timetable",
  agent: "agent",
  pdf: "pdf",
};

const WORKSPACE_HUES = ["#2397c9", "#5c7bd9", "#9a70c7", "#d17858", "#58a17a", "#c18a35"];
function workspaceHue(workspace: SpectraWorkspace, index: number) {
  return workspace.color?.trim() || WORKSPACE_HUES[index % WORKSPACE_HUES.length]!;
}

const subscribeThreadsView = (listener: () => void) => spectraBus.subscribe("threads.view", listener);
const threadsViewOpen = () => Boolean(spectraBus.getQuery("threads.view")?.open);

function pulseFrom(element: Element, strength = 0.7) {
  if (!life.on) return;
  const r = element.getBoundingClientRect();
  life.pulse(r.left + r.width / 2, r.top + r.height / 2, strength);
}

export function Rail() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useSpectraRouter();
  const selectedWorkspaceId = pathname.startsWith("/workspace/")
    ? decodeURIComponent(pathname.slice("/workspace/".length).split("/", 1)[0] ?? "") || null
    : searchParams.get("workspaceId");

  /* Geometry. The user's preference is stored; a crowded page
     (`shell.sidebarCrowd`) and a narrow window collapse the rail without
     rewriting it, and an explicit toggle meanwhile wins until they clear. */
  const [preferred, setPreferred] = useState(false);
  const [crowded, setCrowded] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [override, setOverride] = useState(false);
  useLayoutEffect(() => {
    setPreferred(window.localStorage.getItem(STORAGE_KEY) === "true");
    const query = window.matchMedia?.(NARROW);
    if (!query) return;
    const sync = () => {
      setNarrow(query.matches);
      if (!query.matches) setOverride(false);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(
    () =>
      spectraBus.on("shell.sidebarCrowd", ({ crowded: next }) => {
        setCrowded(next);
        if (!next) setOverride(false);
      }),
    [],
  );
  const collapsed = preferred || ((crowded || narrow) && !override);
  useLayoutEffect(() => {
    document.documentElement.dataset.spectraSidebarCollapsed = String(collapsed);
  }, [collapsed]);
  const toggle = useCallback(() => {
    const next = !collapsed;
    setPreferred(next);
    window.localStorage.setItem(STORAGE_KEY, String(next));
    if (crowded || narrow) setOverride(!next);
    spectraBus.emit("shell.sidebarLayout", { collapsed: next });
  }, [collapsed, crowded, narrow]);

  // The old sidebar search lives in the threads view now.
  useEffect(() => spectraBus.on("shell.focusSidebarSearch", () => spectraBus.emit("threads.open", {})), []);
  const threadsOpen = useSyncExternalStore(subscribeThreadsView, threadsViewOpen, () => false);
  const active = activeRailDestination(pathname, threadsOpen);

  const [identity, setIdentity] = useState<AdministrationIdentity | null>(null);
  useEffect(() => {
    let live = true;
    void getAdministration<AdministrationIdentity>("identity")
      .then((value) => live && setIdentity(value))
      .catch(() => live && setIdentity(null));
    return () => {
      live = false;
    };
  }, []);

  const notifications = useShellNotifications();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const openNotification = useCallback(
    (item: ShellNotification) => {
      if (item.kind === "share") reviewShareInvitations(router);
      else router.push(item.href ?? `/library/${encodeURIComponent(item.artifactId)}`);
      void notifications.markRead(item);
    },
    [notifications, router],
  );
  // A notification opened from the island acts as it would from the list.
  const chooseRef = useRef({ items: notifications.items, open: openNotification });
  chooseRef.current = { items: notifications.items, open: openNotification };
  useEffect(
    () =>
      spectraBus.on("notifications.choose", ({ id }) => {
        const item = chooseRef.current.items.find((candidate) => candidate.id === id);
        if (item) chooseRef.current.open(item);
      }),
    [],
  );
  useEffect(() => setNotificationsOpen(false), [pathname]);

  /* The marker glides to whatever the pointer is over, and home again. */
  const navRef = useRef<HTMLElement>(null);
  const [marker, setMarker] = useState({ top: 0, height: 20, visible: false });
  const placeMarker = useCallback((element: Element | null) => {
    const nav = navRef.current;
    if (!nav || !element) return setMarker((current) => ({ ...current, visible: false }));
    const navBox = nav.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const height = Math.max(16, Math.round(box.height * 0.56));
    setMarker({ top: box.top - navBox.top + (box.height - height) / 2, height, visible: true });
  }, []);
  const settleMarker = useCallback(() => placeMarker(navRef.current?.querySelector("[aria-current='page']") ?? null), [placeMarker]);
  useLayoutEffect(() => settleMarker(), [active, collapsed, settleMarker]);

  const openConversations = (element: HTMLElement) => {
    pulseFrom(element);
    if (threadsOpen) spectraBus.emit("threads.close", {});
    else spectraBus.emit("threads.open", {});
  };

  return (
    <>
      <aside
        aria-label="Spectra navigation"
        data-collapsed={collapsed}
        className={cn(
          "spectra-shell-sidebar fixed inset-y-0 left-0 z-chrome flex w-[var(--spectra-rail-width,232px)] flex-col overflow-hidden border-r border-[var(--border-subtle)]",
          "bg-[color-mix(in_oklab,var(--bg-primary)_84%,transparent)] backdrop-blur-[6px] transition-[width] duration-[var(--motion-base)] ease-standard",
        )}
      >
        <div className={cn("flex h-14 shrink-0 items-center gap-1", collapsed ? "justify-center px-2" : "pl-3 pr-2")}>
          <Tooltip label="Home" side="right" disabled={!collapsed}>
            <Link
              href="/workspace?home=1"
              prefetch={false}
              aria-label="Spectra home"
              data-rail-brand
              onClick={(event) => pulseFrom(event.currentTarget, 1)}
              className="grid size-8 shrink-0 place-items-center rounded-control outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
            >
              <PrismLoader size={22} optics="dormant" interactive />
            </Link>
          </Tooltip>
          {collapsed ? null : (
            <>
              <WorkspaceSwitcher selectedWorkspaceId={selectedWorkspaceId} />
              <IconButton icon="sidebar" label="Collapse the rail" size="compact" tooltipSide="bottom" onClick={toggle} />
            </>
          )}
        </div>

        <nav ref={navRef} aria-label="Main destinations" className="spectra-shell-nav relative flex flex-col gap-px px-2" onMouseLeave={settleMarker}>
          <span
            aria-hidden="true"
            className="spectra-shell-rail-marker"
            data-visible={marker.visible || undefined}
            style={{ height: marker.height, transform: `translateY(${marker.top}px)` }}
          />
          {RAIL_DESTINATIONS.map((destination) => {
            const current = active === destination.key;
            const itemClass = cn(
              "relative flex h-9 w-full items-center gap-2.5 rounded-control text-ui font-medium outline-none transition-colors duration-[var(--motion-fast)]",
              "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]",
              collapsed ? "justify-center px-0" : "px-2.5",
              current ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
            );
            const body = (
              <>
                <Icon name={destination.glyph} size={18} animate={current} />
                {collapsed ? <span className="sr-only">{destination.label}</span> : <span data-sidebar-expanded="">{destination.label}</span>}
              </>
            );
            return (
              <Tooltip key={destination.key} label={destination.label} side="right" disabled={!collapsed} className="flex w-full">
                {destination.key === "conversations" ? (
                  <button
                    type="button"
                    data-rail-item="conversations"
                    aria-current={current ? "page" : undefined}
                    aria-expanded={threadsOpen}
                    onMouseEnter={(event) => placeMarker(event.currentTarget)}
                    onClick={(event) => openConversations(event.currentTarget)}
                    className={itemClass}
                  >
                    {body}
                  </button>
                ) : (
                  <Link
                    href={destination.key === "home" ? "/workspace?home=1" : destination.href}
                    prefetch={false}
                    data-rail-item={destination.key}
                    // The page it opens grows out of it; the page already open stays as it is.
                    data-life-launch={current ? undefined : ""}
                    aria-current={current ? "page" : undefined}
                    onMouseEnter={(event) => placeMarker(event.currentTarget)}
                    onClick={(event) => {
                      pulseFrom(event.currentTarget);
                      if (threadsOpen) spectraBus.emit("threads.close", {});
                      if (destination.key === "home" && pathname.startsWith("/workspace")) {
                        event.preventDefault();
                        void spectraBus.command("navigation.home", {});
                      }
                    }}
                    className={itemClass}
                  >
                    {body}
                  </Link>
                )}
              </Tooltip>
            );
          })}
        </nav>

        {collapsed ? <div className="flex-1" /> : <PinnedWorks />}

        <div className={cn("shrink-0 border-t border-[var(--border-subtle)] py-2", collapsed ? "flex flex-col items-center gap-1 px-2" : "px-2")}>
          {collapsed ? <IconButton icon="sidebar" label="Expand the rail" tooltipSide="right" onClick={toggle} /> : null}
          <AccountMenu
            identity={identity}
            collapsed={collapsed}
            unreadCount={notifications.unreadCount}
            onOpenNotifications={() => {
              setNotificationsOpen(true);
              void notifications.refresh();
            }}
          />
        </div>
      </aside>
      {notificationsOpen ? (
        <NotificationsPanel
          items={notifications.items}
          loading={notifications.loading}
          unreadCount={notifications.unreadCount}
          onMarkAllRead={() => void notifications.markAllRead()}
          onChoose={(item) => {
            setNotificationsOpen(false);
            if (item.kind === "share") reviewShareInvitations(router);
            void notifications.markRead(item);
          }}
          onClose={() => setNotificationsOpen(false)}
        />
      ) : null}
    </>
  );
}

function WorkspaceSwitcher({ selectedWorkspaceId }: { selectedWorkspaceId: string | null }) {
  const catalog = useWorkspaceCatalog(selectedWorkspaceId);
  const workspaces = catalog.items;
  const current = workspaces.find((workspace) => workspace._id === selectedWorkspaceId) ?? null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Workspace: ${current?.title ?? "All workspaces"}. Switch workspace`}
          className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-control px-1.5 text-left outline-none transition-colors hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] data-[state=open]:bg-[var(--bg-hover)]"
        >
          <span data-sidebar-expanded="" className="min-w-0 flex-1 truncate font-[family-name:var(--font-display)] text-ui font-semibold text-[var(--text-primary)]">
            {current?.title ?? "Spectra"}
          </span>
          <Icon name="chevronDown" size={14} className="shrink-0 text-[var(--text-tertiary)]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/workspace?home=1" prefetch={false} aria-current={!current ? "page" : undefined}>
            <span className="grid size-4 place-items-center text-[var(--text-secondary)]">
              <Icon name="home" size={16} />
            </span>
            All workspaces
          </Link>
        </DropdownMenuItem>
        {workspaces.map((workspace, index) => (
          <DropdownMenuItem key={workspace._id} asChild>
            <Link href={`/workspace/${encodeURIComponent(workspace._id)}`} prefetch={false} aria-current={workspace._id === current?._id ? "page" : undefined}>
              <span className="grid size-4 place-items-center">
                <span className="size-2.5 rounded-full" style={{ background: workspaceHue(workspace, index) }} />
              </span>
              <span className="min-w-0 flex-1 truncate">{workspace.title}</span>
              {workspace.isShared || workspace.ownership === "shared" ? (
                <span role="img" aria-label="Shared workspace" className="text-[var(--text-tertiary)]">
                  <Icon name="people" size={14} aria-hidden="true" />
                </span>
              ) : null}
            </Link>
          </DropdownMenuItem>
        ))}
        <CatalogProgress catalog={catalog} />
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/workspace?create=1" prefetch={false}>
            <span className="grid size-4 place-items-center text-[var(--text-secondary)]">
              <Icon name="add" size={16} />
            </span>
            New workspace
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A few pinned works, opened where the page can hold them (the Side), else in the Library. */
function PinnedWorks() {
  const router = useSpectraRouter();
  const { nodes } = useTreeQuickView("favorites", ["work"]);
  const pinned = nodes.filter((node) => node.sourceId).slice(0, PINNED_LIMIT);
  return (
    <div className="spectra-thin-scrollbar mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2" data-sidebar-recents="">
      {pinned.length ? (
        <section aria-label="Pinned">
          <h2 className="px-2.5 pb-1 text-micro font-semibold text-[var(--text-tertiary)]">Pinned</h2>
          <ul className="space-y-px">
            {pinned.map((node) => (
              <li key={node.nodeId}>
                <button
                  type="button"
                  data-life-launch=""
                  onClick={(event) => {
                    pulseFrom(event.currentTarget, 0.5);
                    const handled = spectraBus.command("work.open", { workId: node.sourceId!, surface: "panel" });
                    if (!handled) router.push(`/library/${encodeURIComponent(node.sourceId!)}`);
                  }}
                  title={`${node.name} · ${formatRelativeTime(node.activityAt)}`}
                  className="flex h-8 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-caption text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                >
                  <Icon name={TYPE_GLYPH[node.typeKey ?? ""] ?? "document"} size={16} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{node.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function NotificationsPanel({
  items,
  loading,
  unreadCount,
  onMarkAllRead,
  onChoose,
  onClose,
}: {
  items: ShellNotification[];
  loading: boolean;
  unreadCount: number;
  onMarkAllRead: () => void;
  onChoose: (item: ShellNotification) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const account = typeof document !== "undefined" ? document.querySelector("[data-account-row]") : null;
  const from = useMemo(() => {
    if (!account) return undefined;
    const r = account.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as [number, number];
  }, [account]);
  useLifeEntrance(panelRef, { from, bars: "[data-panel-title]" });
  const close = useCallback(() => {
    if (panelRef.current) void unformElement(panelRef.current, { bars: "[data-panel-title]", from });
    onClose();
  }, [from, onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target && !panelRef.current?.contains(target) && !target.closest("[data-account-row], [role='menu']")) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [close]);
  return (
    <section
      ref={panelRef}
      aria-label="Notifications"
      className="fixed bottom-3 left-[calc(var(--spectra-rail-width,232px)+8px)] z-panel w-[340px] overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
    >
      <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] py-2 pl-4 pr-2">
        <div className="min-w-0 flex-1">
          <strong data-panel-title className="text-caption">
            Notifications
          </strong>
          <p className="text-micro text-[var(--text-tertiary)]">Shares, comments, tasks and reminders</p>
        </div>
        <button
          type="button"
          disabled={!unreadCount}
          onClick={onMarkAllRead}
          className="flex h-7 items-center gap-1 rounded-chip px-2 text-micro text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-35"
        >
          <Icon name="check" size={14} />
          Mark read
        </button>
        <IconButton icon="close" label="Close" size="compact" shortcut="Esc" onClick={close} />
      </header>
      <div className="spectra-thin-scrollbar max-h-[420px] overflow-y-auto p-1.5">
        {items.slice(0, 30).map((item) => (
          <Link
            key={`${item.kind}:${item.id}`}
            href={item.href ?? `/library/${encodeURIComponent(item.artifactId)}`}
            prefetch={false}
            onClick={() => onChoose(item)}
            className="flex gap-2.5 rounded-control px-2.5 py-2 hover:bg-[var(--bg-hover)]"
          >
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-micro font-semibold">{item.title}</strong>
              <span className="mt-0.5 line-clamp-2 block text-micro leading-3.5 text-[var(--text-secondary)]">{item.detail}</span>
            </span>
            {!item.readAt && item.kind !== "share" ? <i className="mt-1 size-1.5 shrink-0 rounded-full bg-[var(--brand-primary)]" /> : null}
          </Link>
        ))}
        {!items.length && !loading ? <p className="px-4 py-8 text-center text-micro text-[var(--text-tertiary)]">You are all caught up.</p> : null}
      </div>
    </section>
  );
}
