"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "@/components/icons";
import { PrismLoader } from "@/components/spectra-prism-optic";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";
import type { AdministrationIdentity } from "@/features/spectra/administration/api";
import { readIdentity } from "@/features/spectra/administration/identity";
import { formatRelativeTime } from "@/features/spectra/components/spectra-view-model";
import { useWorkspaceCatalog } from "@/features/spectra/data/use-catalog-pages";
import { getSpectraThreads, type SpectraSchoolMessage, type SpectraThread } from "@/features/spectra/data/api";
import { threadClick } from "@/features/spectra/components/side-open";
import { spectraBus } from "@/features/spectra/events";
import { useSpectraRouter } from "@/features/spectra/hooks/use-spectra-router";
import { life } from "@/features/spectra/life/life";
import { useLifeEntrance } from "@/features/spectra/life/use-life";
import { isActiveRunStatus, useRunTabs } from "@/features/spectra/island/run-tabs";
import { useTreeQuickView } from "@/features/spectra/organization/tree-client";
import { useSpectraPreferences } from "@/features/spectra/settings/preference-store";
import { applyOrder, useDragReorder } from "@/components/ui/use-drag-reorder";
import { RailRecentWorks } from "./rail-recent-works";
import { useClassBook } from "@/features/spectra/school/use-class-book";
import { threadName } from "@/features/spectra/threads/threads-model";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./account-menu";
import { FeedbackButton } from "./feedback-button";
import { MessageLetter } from "./message-letter";
import { reviewShareInvitations, type ShellNotification } from "./shell-notifications";
import { useShellNotifications } from "./use-shell-notifications";
import { WorkingMark } from "@/components/ui/skeleton";
import { HOME_PATH, threadHref } from "@/features/spectra/chat/home-routes";

/*
 * The rail (SHELL.md, "The rail"): the prism and the name as the way home,
 * the six destinations, recent threads, a few pinned works, and one account
 * row. Collapsed, the prism itself opens it again. It is 232 px wide, or 56 px of icons when collapsed — by the
 * user, by a crowded page, or below 1024 px. Its width is one CSS variable,
 * `--spectra-rail-width`, so the stage and the island follow it exactly.
 */

export const RAIL_WIDTH = 232;
export const RAIL_COLLAPSED_WIDTH = 56;
const NARROW = "(max-width: 1023px)";
/** Phones: the rail leaves the screen and opens over the page (spectra-field.css). */
const PHONE = "(max-width: 639px)";
const STORAGE_KEY = "spectra:sidebar-collapsed";
const PINNED_LIMIT = 6;
const THREAD_LIMIT = 8;

export type RailDestination = {
  key: "home" | "library" | "calendar" | "school" | "agents" | "devices" | "admin" | "platform";
  href: string;
  label: string;
  glyph: IconName;
  /** Paths it owns: exactly, or with anything under them unless `exact`. */
  routes: string[];
  exact?: boolean;
};

export const RAIL_DESTINATIONS: RailDestination[] = [
  // Home is the day, and the conversations started from it; a workspace is a place in the Library.
  { key: "home", href: HOME_PATH, label: "Home", glyph: "home", routes: [HOME_PATH, "/chat"], exact: true },
  { key: "library", href: "/library", label: "Library", glyph: "library", routes: ["/library", "/workspace"] },
  { key: "calendar", href: "/calendar", label: "Calendar", glyph: "calendar", routes: ["/calendar"] },
  { key: "school", href: "/school", label: "School", glyph: "school", routes: ["/school", "/managebac"] },
  { key: "agents", href: "/agents", label: "Agents", glyph: "agents", routes: ["/agents"] },
  { key: "devices", href: "/devices", label: "Devices", glyph: "devices", routes: ["/devices"] },
  // Shown only to those who hold them: a school's administrators, and the platform's operator.
  { key: "admin", href: "/admin", label: "School admin", glyph: "shield", routes: ["/admin"] },
  { key: "platform", href: "/superadmin", label: "Superadmin", glyph: "globe", routes: ["/superadmin"] },
];

/** The destinations this person can open: the admin pages only for those who hold them. */
const LIBRARY_PLACE_KEY = "spectra:library-place";

/** Called before any press in the app, so leaving the Library knows where it was. */
export function rememberLibraryPlace() {
  const { pathname, search } = window.location;
  if (pathname !== "/library" && !pathname.startsWith("/library/") && !pathname.startsWith("/workspace")) return;
  try {
    window.sessionStorage.setItem(LIBRARY_PLACE_KEY, pathname + search);
  } catch {}
}

function libraryPlace() {
  try {
    return window.sessionStorage.getItem(LIBRARY_PLACE_KEY);
  } catch {
    return null;
  }
}

function destinationsFor(identity: AdministrationIdentity | null) {
  return RAIL_DESTINATIONS.filter(
    (destination) =>
      (destination.key !== "admin" || identity?.membership?.role === "school_admin") &&
      (destination.key !== "platform" || identity?.account.platformOperator === true),
  );
}

/** Which destination is current. Threads have their own section below the destinations. */
export function activeRailDestination(pathname: string): RailDestination["key"] | null {
  return RAIL_DESTINATIONS.find(({ routes, exact }) => routes.some((route) => pathname === route || (!exact && pathname.startsWith(`${route}/`))))?.key ?? null;
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

function pulseFrom(element: Element, strength = 0.7) {
  if (!life.on) return;
  const r = element.getBoundingClientRect();
  life.pulse(r.left + r.width / 2, r.top + r.height / 2, strength);
}

export function Rail() {
  const pathname = usePathname();
  const router = useSpectraRouter();
  const { preferences, update: updatePreferences } = useSpectraPreferences();

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
  // On a phone the open rail lies over the page; going somewhere puts it away.
  useEffect(() => {
    if (window.matchMedia?.(PHONE).matches) setOverride(false);
  }, [pathname]);
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

  // The old sidebar search finds threads now.
  useEffect(() => spectraBus.on("shell.focusSidebarSearch", () => spectraBus.emit("threads.open", {})), []);
  const active = activeRailDestination(pathname);

  const [identity, setIdentity] = useState<AdministrationIdentity | null>(null);
  useEffect(() => {
    let live = true;
    void readIdentity()
      .then((value) => live && setIdentity(value))
      .catch(() => live && setIdentity(null));
    return () => {
      live = false;
    };
  }, []);

  const notifications = useShellNotifications();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [reading, setReading] = useState<SpectraSchoolMessage | null>(null);
  const openNotification = useCallback(
    (item: ShellNotification) => {
      if (item.kind === "message") setReading(item.message ?? null);
      else if (item.kind === "share") reviewShareInvitations(router);
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
  const destinations = useMemo(() => destinationsFor(identity), [identity]);
  const destinationOrder = useDragReorder({
    ids: useMemo(
      () => applyOrder(destinations, (destination) => destination.key, preferences.appearance.railOrder).map((destination) => destination.key),
      [destinations, preferences.appearance.railOrder],
    ),
    onReorder: (railOrder) => updatePreferences("appearance", { railOrder }),
  });
  const railNavRef = useCallback(
    (node: HTMLElement | null) => {
      navRef.current = node;
      destinationOrder.containerRef.current = node;
    },
    [destinationOrder.containerRef],
  );
  const placeMarker = useCallback((element: Element | null) => {
    const nav = navRef.current;
    if (!nav || !element) return setMarker((current) => ({ ...current, visible: false }));
    const navBox = nav.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const height = Math.max(16, Math.round(box.height * 0.56));
    setMarker({ top: box.top - navBox.top + (box.height - height) / 2, height, visible: true });
  }, []);
  const settleMarker = useCallback(() => placeMarker(navRef.current?.querySelector("[aria-current='page']") ?? null), [placeMarker]);
  useLayoutEffect(() => settleMarker(), [active, collapsed, settleMarker, destinationOrder.order]);

  return (
    <>
      <aside
        aria-label="Spectra navigation"
        data-collapsed={collapsed}
        className={cn(
          "spectra-shell-sidebar fixed inset-y-0 left-0 z-chrome flex w-[var(--spectra-rail-width,232px)] flex-col overflow-hidden",
          "transition-[width] duration-[var(--motion-base)] ease-standard",
        )}
      >
        <div className={cn("flex h-14 shrink-0 items-center gap-1", collapsed ? "justify-center px-2" : "pl-3 pr-2")}>
          {collapsed ? (
            <Tooltip label="Open the rail" side="right">
              <button
                type="button"
                aria-label="Open the rail"
                data-rail-brand
                onClick={toggle}
                className="spectra-rail-opener grid size-9 shrink-0 place-items-center rounded-control outline-none hover:bg-[var(--bg-desk-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
              >
                <span className="spectra-rail-opener-brand">
                  <PrismLoader size={22} optics="dormant" interactive />
                </span>
                <Icon name="sidebar" size={18} className="spectra-rail-opener-glyph" />
              </button>
            </Tooltip>
          ) : (
            <>
              <Link
                href={HOME_PATH}
                prefetch={false}
                aria-label="Spectra home"
                data-rail-brand
                onClick={(event) => pulseFrom(event.currentTarget, 1)}
                className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control pr-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
              >
                <span className="grid size-8 shrink-0 place-items-center">
                  <PrismLoader size={22} optics="dormant" interactive />
                </span>
                <span data-sidebar-expanded="" className="truncate font-[family-name:var(--font-display)] text-ui font-semibold text-[var(--text-primary)]">
                  Spectra
                </span>
              </Link>
              <IconButton icon="sidebar" label="Collapse the rail" size="compact" tooltipSide="bottom" onClick={toggle} />
            </>
          )}
        </div>

        <nav ref={railNavRef} aria-label="Main destinations" className="spectra-shell-nav relative flex flex-col gap-px px-2" onMouseLeave={settleMarker}>
          <span
            aria-hidden="true"
            className="spectra-shell-rail-marker"
            data-visible={marker.visible || undefined}
            style={{ height: marker.height, transform: `translateY(${marker.top}px)` }}
          />
          {destinationOrder.order.map((key) => {
            const destination = destinations.find((item) => item.key === key);
            if (!destination) return null;
            const current = active === destination.key;
            const itemClass = cn(
              "relative flex h-9 w-full items-center gap-2.5 rounded-control text-ui font-medium outline-none transition-colors duration-[var(--motion-fast)]",
              "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]",
              collapsed ? "justify-center px-0" : "px-2.5",
              current ? "spectra-rail-current text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-desk-hover)] hover:text-[var(--text-primary)]",
            );
            const body = (
              <>
                <Icon name={destination.glyph} size={18} animate={current} />
                {collapsed ? <span className="sr-only">{destination.label}</span> : <span data-sidebar-expanded="">{destination.label}</span>}
              </>
            );
            return (
              <Tooltip key={destination.key} label={destination.label} side="right" disabled={!collapsed} className="flex w-full">
                <Link
                  {...destinationOrder.itemProps(destination.key)}
                  href={destination.href}
                  data-rail-item={destination.key}
                  // The page it opens grows out of it; the page already open stays as it is.
                  data-life-launch={current ? undefined : ""}
                  aria-current={current ? "page" : undefined}
                  onMouseEnter={(event) => placeMarker(event.currentTarget)}
                  onClick={(event) => {
                    pulseFrom(event.currentTarget);
                    // The Library opens where it was left.
                    const place = destination.key === "library" && !current ? libraryPlace() : null;
                    if (place && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
                      event.preventDefault();
                      router.push(place);
                    }
                  }}
                  className={itemClass}
                >
                  {body}
                </Link>
              </Tooltip>
            );
          })}
        </nav>

        {collapsed ? <div className="flex-1" /> : (
          <div className="spectra-thin-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-2" data-sidebar-recents="">
            <RailRecentWorks />
            <RailThreads />
            <PinnedWorks />
          </div>
        )}

        <div className={cn("shrink-0 border-t border-[var(--border-subtle)] py-2", collapsed ? "flex flex-col items-center gap-1 px-2" : "flex items-center gap-1 px-2")}>
          <div className={collapsed ? undefined : "min-w-0 flex-1"}>
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
          <Tooltip label="Settings" side={collapsed ? "right" : "top"}>
            <Link href="/settings" aria-label="Settings" className="feedback-trigger" aria-current={pathname?.startsWith("/settings") ? "page" : undefined}>
              <Icon name="settings" size={16} aria-hidden="true" />
            </Link>
          </Tooltip>
          <FeedbackButton collapsed={collapsed} />
        </div>
      </aside>
      {/* Phones only (spectra-field.css): the rail is off the screen until this opens it, and a tap beside it puts it away. */}
      {collapsed ? (
        <button type="button" aria-label="Show navigation" className="spectra-rail-phone-opener" onClick={toggle}>
          <PrismLoader size={20} optics="dormant" />
        </button>
      ) : (
        <button type="button" aria-label="Hide navigation" tabIndex={-1} className="spectra-rail-phone-scrim" onClick={toggle} />
      )}
      {notificationsOpen ? (
        <NotificationsPanel
          items={notifications.items}
          loading={notifications.loading}
          unreadCount={notifications.unreadCount}
          onMarkAllRead={() => void notifications.markAllRead()}
          onChoose={(item) => {
            setNotificationsOpen(false);
            if (item.kind === "message") setReading(item.message ?? null);
            else if (item.kind === "share") reviewShareInvitations(router);
            void notifications.markRead(item);
          }}
          onClose={() => setNotificationsOpen(false)}
        />
      ) : null}
      <MessageLetter message={reading} onClose={() => setReading(null)} />
    </>
  );
}

/**
 * The threads a student comes back to (SHELL.md, "Threads"): the ones Spectra
 * is still moving come first, carrying its light, then the most recent. Each
 * opens as its own page; the + starts a new one right where the student is.
 */
function RailThreads() {
  const tabs = useRunTabs();
  const [threads, setThreads] = useState<SpectraThread[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      void getSpectraThreads({ brief: true })
        .then(({ threads: rows }) => live && setThreads(rows.filter((thread) => thread.status === "active")))
        .catch(() => live && setThreads((current) => current ?? []));
    load();
    const off = spectraBus.on("threads.changed", load);
    return () => {
      live = false;
      off();
    };
  }, []);
  const moving = useMemo(() => new Set(tabs.filter((tab) => isActiveRunStatus(tab.run.status)).map((tab) => tab.threadId)), [tabs]);
  const placeOf = useThreadPlaces();
  const shown = useMemo(
    () => [...(threads ?? [])].sort((a, b) => Number(moving.has(b._id)) - Number(moving.has(a._id))).slice(0, THREAD_LIMIT),
    [moving, threads],
  );

  return (
    <section aria-label="Threads">
      <div className="flex h-7 items-center gap-1 pl-2.5 pr-1">
        <Link
          href={HOME_PATH}
          prefetch={false}
          className="min-w-0 flex-1 truncate text-micro font-medium text-[var(--text-tertiary)] outline-none transition-colors hover:text-[var(--text-primary)] focus-visible:text-[var(--text-primary)]"
        >
          Threads
        </Link>
        <Tooltip label="New thread" shortcut="Ctrl Shift N" side="right">
          <button
            type="button"
            aria-label="New thread"
            onClick={(event) => {
              pulseFrom(event.currentTarget, 0.6);
              spectraBus.emit("island.compose", { fresh: true });
            }}
            className="grid size-6 place-items-center rounded-chip text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--bg-desk-hover)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          >
            <Icon name="add" size={14} />
          </button>
        </Tooltip>
      </div>
      {threads === null ? (
        <ul aria-hidden className="space-y-px">
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index} className="flex h-8 items-center gap-2.5 px-2.5">
              <span className="grid size-4 place-items-center">
                <span className="size-1.5 rounded-full bg-[var(--bg-tertiary)]" />
              </span>
              <span className="h-2.5 animate-pulse rounded-full bg-[var(--bg-tertiary)]" style={{ width: `${55 + ((index * 19) % 35)}%` }} />
            </li>
          ))}
        </ul>
      ) : shown.length ? (
        <ul className="space-y-px">
          {shown.map((thread) => {
            const place = placeOf(thread);
            const name = threadName(thread);
            return (
            <li key={thread._id}>
              <Link
                href={threadHref(thread._id)}
                prefetch={false}
                onClick={threadClick(thread)}
                title={`${name}${place ? `, in ${place.title}` : ""}, ${formatRelativeTime(thread.lastMessageAt ?? thread.updatedAt)}`}
                className="flex h-8 w-full items-center gap-2.5 rounded-control px-2.5 text-caption text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--bg-desk-hover)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
              >
                <span className="grid size-4 shrink-0 place-items-center">
                  {moving.has(thread._id) ? (
                    <WorkingMark />
                  ) : (
                    <span
                      aria-hidden
                      className="spectra-rail-thread-mark"
                      style={place ? ({ "--thread-ink": place.ink } as CSSProperties) : undefined}
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">{name}</span>
              </Link>
            </li>
            );
          })}
          <li>
            <Link
              href={HOME_PATH}
              prefetch={false}
              className="flex h-8 items-center gap-2.5 rounded-control px-2.5 text-caption text-[var(--text-tertiary)] outline-none transition-colors hover:bg-[var(--bg-desk-hover)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
            >
              <span className="grid size-4 place-items-center">
                <Icon name="search" size={13} />
              </span>
              All threads
            </Link>
          </li>
        </ul>
      ) : (
        <p className="px-2.5 py-1 text-caption leading-5 text-[var(--text-tertiary)]">Threads you start appear here.</p>
      )}
    </section>
  );
}

/**
 * The workspace a thread was started in, by its title and ink: a class's in
 * the colour School gives it, any other in its own. A thread from no
 * workspace has none, and keeps the thread colour.
 */
function useThreadPlaces() {
  const workspaces = useWorkspaceCatalog().items;
  const book = useClassBook();
  return useCallback(
    (thread: SpectraThread) => {
      const workspace = thread.workspaceId ? workspaces.find((item) => item._id === thread.workspaceId) : undefined;
      if (!workspace) return null;
      const ink = book.named(workspace.title)?.ink ?? workspace.color?.trim();
      return ink ? { title: workspace.title, ink } : null;
    },
    [book, workspaces],
  );
}

/** A few pinned works, opened where the page can hold them (the Side), else in the Library. */
function PinnedWorks() {
  const router = useSpectraRouter();
  const { nodes } = useTreeQuickView("favorites", ["work"]);
  const pinned = nodes.filter((node) => node.sourceId).slice(0, PINNED_LIMIT);
  return (
    <>
      {pinned.length ? (
        <section aria-label="Pinned" className="mt-4">
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
                  className="flex h-8 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-caption text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--bg-desk-hover)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                >
                  <Icon name={TYPE_GLYPH[node.typeKey ?? ""] ?? "document"} size={16} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{node.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
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
  useLifeEntrance(panelRef);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target && !panelRef.current?.contains(target) && !target.closest("[data-account-row], [role='menu']")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [onClose]);
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
          <p className="text-micro text-[var(--text-tertiary)]">Messages, shares, comments and reminders</p>
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
        <IconButton icon="close" label="Close" size="compact" shortcut="Esc" onClick={onClose} />
      </header>
      <div className="spectra-thin-scrollbar max-h-[420px] overflow-y-auto p-1.5">
        {items.slice(0, 30).map((item) => {
          const face = (
            <>
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-micro font-semibold">{item.title}</strong>
                <span className="mt-0.5 line-clamp-2 block text-micro leading-3.5 text-[var(--text-secondary)]">{item.detail}</span>
              </span>
              {!item.readAt && item.kind !== "share" ? <i className="mt-1 size-1.5 shrink-0 rounded-full bg-[var(--brand-primary)]" /> : null}
            </>
          );
          const row = "flex w-full gap-2.5 rounded-control px-2.5 py-2 text-left hover:bg-[var(--bg-hover)]";
          // A message opens where it is read, not on a page of its own.
          return item.kind === "message" ? (
            <button key={`${item.kind}:${item.id}`} type="button" onClick={() => onChoose(item)} className={row}>
              {face}
            </button>
          ) : (
            <Link
              key={`${item.kind}:${item.id}`}
              href={item.href ?? `/library/${encodeURIComponent(item.artifactId)}`}
              prefetch={false}
              onClick={() => onChoose(item)}
              className={row}
            >
              {face}
            </Link>
          );
        })}
        {!items.length && !loading ? <p className="px-4 py-8 text-center text-micro text-[var(--text-tertiary)]">You are all caught up.</p> : null}
      </div>
    </section>
  );
}
