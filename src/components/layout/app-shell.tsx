"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useAccountStorageReady } from "../account-storage-boundary";
import { usePathname, useSearchParams } from "next/navigation";
import { captureSpectraNavigation, useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import { toast } from "sonner";
import {
  Atom,
  BarChart3,
  BookOpen,
  Brain,
  Bell,
  Bot,
  Command,
  Building2,
  Calculator,
  FlaskConical,
  Folders,
  GraduationCap,
  LayoutGrid,
  LibraryBig,
  ListTodo,
  CalendarClock,
  CheckCheck,
  MessageSquareText,
  Search,
  Plus,
  School,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sprout,
  UsersRound,
  X,
  Share2,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { useClerk } from "@clerk/nextjs";
import { SpectraLogo } from "@/components/spectra-logo";
import { SignedInContinue } from "@/components/signed-in-continue";
import { UniversalKBar } from "@/features/spectra/components/universal-kbar";
import { ViewportReadinessMount } from "@/features/spectra/components/viewport-readiness-mount";
import { cn } from "@/lib/utils";
import {
  getSpectraNotificationCenter,
  getSpectraThreads,
  markSpectraArtifactCommentNotificationsRead,
  markSpectraPlannerReminderNotificationsRead,
  markSpectraTimetableReminderNotificationsRead,
  type SpectraArtifactCommentNotification,
  type SpectraPlannerReminderNotification,
  type SpectraTimetableReminderNotification,
  type SpectraShareInvitation,
  type SpectraWorkspace,
  type SpectraThread,
} from "@/features/spectra/data/api";
import { useWorkspaceCatalog } from "@/features/spectra/data/use-catalog-pages";
import { CatalogProgress } from "@/features/spectra/components/catalog-progress";
import {
  getAdministration,
  type AdministrationIdentity,
} from "@/features/spectra/administration/api";
import { formatRelativeTime } from "@/features/spectra/components/spectra-view-model";
import {
  KeyboardShortcutsHelp,
  KeyboardShortcutsRegistrar,
  ShortcutsButton,
} from "@/components/keyboard-shortcuts";
import { RouteSidePanelHost } from "@/features/spectra/components/route-side-panel-host";
import { ViewportContextPicker } from "@/features/spectra/components/viewport-context-picker";
import { GlobalRouteWorkbench } from "@/features/spectra/components/global-route-workbench";
import { OverflowMenu } from "@/components/ui/dropdown-menu";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import { ProductOfflineBanner } from "@/features/spectra/bridge/product-offline-banner";
import { AppChoreographyMount } from "@/features/spectra/collaboration/app-choreography-host";
import { spectraBus } from "@/features/spectra/events";
import { sidebarThreadSections } from "./sidebar-threads";
import {
  buildShellNotifications,
  reviewShareInvitations,
} from "./shell-notifications";

type AppShellProps = {
  children: ReactNode;
  fullBleed?: boolean;
  noScroll?: boolean;
  contentClassName?: string;
};

const ordinaryDestinations = [
  { href: "/chat", label: "Chat", icon: MessageSquareText },
  { href: "/workspace", label: "Home", icon: LayoutGrid },
  { href: "/library", label: "Library", icon: LibraryBig },
  { href: "/calendar", label: "Calendar", icon: CalendarClock },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/school", label: "School", icon: School },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
] as const;

const workspaceIconMap: Record<string, LucideIcon> = {
  Atom,
  BarChart3,
  BookOpen,
  Brain,
  Calculator,
  FlaskConical,
  GraduationCap,
  Sparkles,
  Sprout,
};

const workspacePalette = [
  "#2397c9",
  "#5c7bd9",
  "#9a70c7",
  "#d17858",
  "#58a17a",
  "#c18a35",
];

function workspaceIcon(workspace: SpectraWorkspace) {
  return workspaceIconMap[workspace.icon ?? ""] ?? Sparkles;
}

function workspaceColor(workspace: SpectraWorkspace, index: number) {
  return (
    workspace.color?.trim() ||
    workspacePalette[index % workspacePalette.length]!
  );
}

function workspaceHref(workspaceId: string) {
  return `/workspace/${encodeURIComponent(workspaceId)}`;
}

function ShellNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { openUserProfile } = useClerk();
  const selectedWorkspaceId = pathname.startsWith("/workspace/")
    ? decodeURIComponent(
        pathname.slice("/workspace/".length).split("/", 1)[0] ?? "",
      ) || null
    : searchParams.get("workspaceId");
  const workspaceCatalog = useWorkspaceCatalog(selectedWorkspaceId);
  const workspaces = workspaceCatalog.items;
  const [threads, setThreads] = useState<SpectraThread[]>([]);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const activeThreadId = searchParams.get("threadId");
  const threadSections = useMemo(
    () =>
      sidebarThreadSections(threads, {
        term: sidebarSearch,
        chatPage: pathname === "/chat",
      }),
    [threads, sidebarSearch, pathname],
  );
  const [isMacPlatform, setIsMacPlatform] = useState(false);
  const [preferredSidebarCollapsed, setPreferredSidebarCollapsed] =
    useState(false);
  /* The workbench can ask chrome to rail the sidebar while open panels need
     the room (`shell.sidebarCrowd`). Auto-rail is presentational only: the
     stored preference is never rewritten, an explicit toggle during a
     crowded episode wins until the crowding clears, and the sidebar returns
     to the user's preference the moment the row fits again. */
  const [sidebarCrowded, setSidebarCrowded] = useState(false);
  const [crowdOverride, setCrowdOverride] = useState(false);
  useEffect(
    () =>
      spectraBus.on("shell.sidebarCrowd", ({ crowded }) => {
        setSidebarCrowded(crowded);
        if (!crowded) setCrowdOverride(false);
      }),
    [],
  );
  const sidebarCollapsed =
    preferredSidebarCollapsed || (sidebarCrowded && !crowdOverride);
  const [mobileWorkspaceOpen, setMobileWorkspaceOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [commentNotifications, setCommentNotifications] = useState<
    SpectraArtifactCommentNotification[]
  >([]);
  const [plannerNotifications, setPlannerNotifications] = useState<
    SpectraPlannerReminderNotification[]
  >([]);
  const [timetableNotifications, setTimetableNotifications] = useState<
    SpectraTimetableReminderNotification[]
  >([]);
  const [shareInvitations, setShareInvitations] = useState<
    SpectraShareInvitation[]
  >([]);
  const knownShareInvitationIdsRef = useRef<Set<string> | null>(null);
  const [administrationIdentity, setAdministrationIdentity] =
    useState<AdministrationIdentity | null>(null);

  useEffect(() => {
    let active = true;
    void getAdministration<AdministrationIdentity>("identity")
      .then((identity) => {
        if (active) setAdministrationIdentity(identity);
      })
      .catch(() => {
        if (active) setAdministrationIdentity(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useLayoutEffect(() => {
    const stored = window.localStorage.getItem("spectra:sidebar-collapsed");
    setPreferredSidebarCollapsed(stored === "true");
  }, []);

  useEffect(() => {
    setIsMacPlatform(
      /mac|iphone|ipad|ipod/i.test(
        navigator.platform || navigator.userAgent,
      ),
    );
  }, []);

  /* The dataset mirrors the *effective* geometry so the pre-hydration CSS in
     spectra-field.css and the live tree never disagree, whether the rail came
     from the user's preference or from a crowded workbench. */
  useEffect(() => {
    if (sidebarCollapsed)
      document.documentElement.dataset.spectraSidebarCollapsed = "true";
    else delete document.documentElement.dataset.spectraSidebarCollapsed;
  }, [sidebarCollapsed]);

  const toggleSidebar = useCallback(() => {
    // The toggle steers the geometry the user is looking at; during a
    // crowded episode that explicit choice wins over the auto-rail.
    const next = !sidebarCollapsed;
    setPreferredSidebarCollapsed(next);
    window.localStorage.setItem("spectra:sidebar-collapsed", String(next));
    spectraBus.emit("shell.sidebarLayout", { collapsed: next });
    if (sidebarCrowded) setCrowdOverride(true);
  }, [sidebarCollapsed, sidebarCrowded]);

  const focusSidebarSearch = useCallback(() => {
    setPreferredSidebarCollapsed(false);
    window.localStorage.setItem("spectra:sidebar-collapsed", "false");
    if (sidebarCrowded) setCrowdOverride(true);
    spectraBus.emit("shell.sidebarLayout", { collapsed: false });
    window.requestAnimationFrame(() => {
      const search = document.querySelector<HTMLInputElement>(
        "[data-spectra-sidebar-search]",
      );
      search?.focus();
      search?.select();
    });
  }, [sidebarCrowded]);

  useEffect(
    () => spectraBus.on("shell.focusSidebarSearch", focusSidebarSearch),
    [focusSidebarSearch],
  );

  const coreDestinations = useMemo(() => {
    const destinations: Array<{
      href: string;
      label: string;
      icon: LucideIcon;
    }> = [...ordinaryDestinations];
    if (administrationIdentity?.membership?.role === "school_admin")
      destinations.push({ href: "/admin", label: "Admin", icon: Building2 });
    if (administrationIdentity?.account.platformOperator)
      destinations.push({
        href: "/superadmin",
        label: "Super Admin",
        icon: ShieldCheck,
      });
    return destinations;
  }, [administrationIdentity]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void getSpectraThreads()
        .then(({ threads: rows }) => {
          if (!active) return;
          setThreads(rows.filter((thread) => thread.status === "active"));
          setThreadsLoaded(true);
        })
        .catch(() => undefined);
    };
    refresh();
    const removeChanged = spectraBus.on("threads.changed", refresh);
    return () => {
      active = false;
      removeChanged();
    };
  }, []);

  const refreshNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    try {
      const center = await getSpectraNotificationCenter(false, 30);
      setCommentNotifications(center.comments);
      setPlannerNotifications(center.planner);
      setTimetableNotifications(center.timetable);
      const shares = { invitations: center.invitations };
      const nextShareIds = new Set(
        shares.invitations.map((invitation) => invitation.invitationId),
      );
      const knownShareIds = knownShareInvitationIdsRef.current;
      if (knownShareIds) {
        for (const invitation of shares.invitations) {
          if (knownShareIds.has(invitation.invitationId)) continue;
          toast.message(
            `${invitation.inviter?.name ?? "A collaborator"} shared ${invitation.resource.title}`,
            {
              description:
                invitation.level === "modify"
                  ? "You can collaborate and make changes."
                  : "You have read-only access.",
              action: {
                label: "Review",
                onClick: () => reviewShareInvitations(router),
              },
            },
          );
        }
      }
      knownShareInvitationIdsRef.current = nextShareIds;
      setShareInvitations(shares.invitations);
    } catch {
      // Navigation remains fully usable when the notification service is unavailable.
    } finally {
      setNotificationsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void refreshNotifications();
    // Push events and focus/visibility changes cover the interactive path. The
    // fallback poll is intentionally sparse and never fetches in a hidden tab.
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshNotifications();
    }, 180_000);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refreshNotifications();
    };
    window.addEventListener("focus", refreshVisible);
    const removeChanged = spectraBus.on("notifications.changed", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      removeChanged();
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refreshNotifications]);

  const notifications = useMemo(
    () =>
      buildShellNotifications({
        comments: commentNotifications,
        planner: plannerNotifications,
        timetable: timetableNotifications,
        invitations: shareInvitations,
      }),
    [
      commentNotifications,
      plannerNotifications,
      shareInvitations,
      timetableNotifications,
    ],
  );
  // Pending share invitations are outstanding actions, not clearable
  // "unread" notifications. Counting them as unread made Mark-read a no-op
  // while the badge stayed hot (AUDIT-A F3 / AUDIT-D). Keep them listed with
  // Accept deep-link; exclude from unread math and unread dots.
  const unreadCount = notifications.filter(
    (item) => !item.readAt && item.kind !== "share",
  ).length;

  const markAllNotificationsRead = useCallback(async () => {
    const comments = commentNotifications
      .filter((item) => !item.readAt)
      .map((item) => item._id);
    const planners = plannerNotifications
      .filter((item) => !item.readAt)
      .map((item) => item._id);
    const timetables = timetableNotifications
      .filter((item) => !item.readAt)
      .map((item) => item._id);
    await Promise.all([
      comments.length
        ? markSpectraArtifactCommentNotificationsRead(comments)
        : Promise.resolve(),
      planners.length
        ? markSpectraPlannerReminderNotificationsRead(planners)
        : Promise.resolve(),
      timetables.length
        ? markSpectraTimetableReminderNotificationsRead(timetables)
        : Promise.resolve(),
    ]);
    await refreshNotifications();
  }, [
    commentNotifications,
    plannerNotifications,
    refreshNotifications,
    timetableNotifications,
  ]);

  const markNotificationRead = useCallback(
    async (item: (typeof notifications)[number]) => {
      if (item.readAt) return;
      if (item.kind === "share") return;
      if (item.kind === "comment")
        await markSpectraArtifactCommentNotificationsRead([item.id]);
      else if (item.kind === "planner")
        await markSpectraPlannerReminderNotificationsRead([item.id]);
      else await markSpectraTimetableReminderNotificationsRead([item.id]);
      await refreshNotifications();
    },
    [refreshNotifications],
  );

  useEffect(() => {
    setMobileWorkspaceOpen(false);
    setNotificationsOpen(false);
  }, [coreDestinations, pathname, selectedWorkspaceId]);

  const activeCoreHref = useMemo(() => {
    if (pathname === "/workspace" && selectedWorkspaceId) return null;
    return (
      coreDestinations.find(({ href }) => {
        const baseHref = href.split("?", 1)[0]!;
        return pathname === baseHref || pathname.startsWith(`${baseHref}/`);
      })?.href ?? null
    );
  }, [pathname, selectedWorkspaceId, coreDestinations]);

  const mobilePrimaryDestinations = coreDestinations.slice(0, 4);
  const mobileOverflowItems = useMemo(
    () => [
      ...coreDestinations.slice(4).map(({ href, label, icon }) => ({
        key: `route:${href}`,
        label: label === "Home" ? "Workspace" : label,
        icon,
      })),
      { key: "workspaces", label: "Workspaces", icon: Folders },
      {
        key: "alerts",
        label: unreadCount ? `Alerts (${unreadCount} unread)` : "Alerts",
        icon: Bell,
      },
    ],
    [coreDestinations, unreadCount],
  );
  const selectMobileOverflow = useCallback(
    (key: string) => {
      if (key === "workspaces") {
        setNotificationsOpen(false);
        setMobileWorkspaceOpen(true);
        return;
      }
      if (key === "alerts") {
        setMobileWorkspaceOpen(false);
        setNotificationsOpen(true);
        void refreshNotifications();
        return;
      }
      if (key.startsWith("route:")) router.push(key.slice("route:".length));
    },
    [refreshNotifications, router],
  );

  const navRef = useRef<HTMLElement>(null);
  const [railMarker, setRailMarker] = useState({
    top: 6,
    height: 22,
    visible: false,
  });

  const placeRailMarker = useCallback((element: HTMLElement | null) => {
    const nav = navRef.current;
    if (!nav || !element) {
      setRailMarker((current) => ({ ...current, visible: false }));
      return;
    }
    const navBox = nav.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const height = Math.max(16, Math.round(box.height * 0.62));
    setRailMarker({
      top: box.top - navBox.top + (box.height - height) / 2,
      height,
      visible: true,
    });
  }, []);

  const snapRailMarkerToActive = useCallback(() => {
    const active = navRef.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    placeRailMarker(active ?? null);
  }, [placeRailMarker]);

  useLayoutEffect(() => {
    snapRailMarkerToActive();
  }, [activeCoreHref, sidebarCollapsed, snapRailMarkerToActive]);

  return (
    <>
      <aside
        aria-label="Spectra navigation"
        data-collapsed={sidebarCollapsed}
        className={cn(
          "spectra-shell-sidebar fixed inset-y-0 left-0 z-chrome hidden flex-col overflow-hidden border-r border-[var(--border-default)] bg-[var(--bg-sidebar)] transition-[width] duration-[var(--motion-base)] ease-standard md:flex",
          sidebarCollapsed ? "w-[76px]" : "w-[240px]",
        )}
      >
        <div className="mt-3 flex h-8 shrink-0 items-center gap-1 px-2">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="grid size-8 shrink-0 place-items-center rounded-chip text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={14} />
            ) : (
              <PanelLeftClose size={14} />
            )}
          </button>
          <Link
            href="/workspace?home=1"
            prefetch={false}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-chip px-1 outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
            aria-label="Spectra home"
          >
            <SpectraLogo size={20} />
            <span
              data-sidebar-expanded=""
              className={cn(
                "font-[family-name:var(--font-display)] text-title font-semibold tracking-[-.025em] text-[var(--text-primary)] transition-opacity",
                sidebarCollapsed && "pointer-events-none opacity-0",
              )}
            >
              spectra
            </span>
          </Link>
        </div>
        <label
          data-sidebar-expanded=""
          className={cn(
            "relative mx-3 mt-2.5 block",
            sidebarCollapsed &&
              "pointer-events-none h-0 overflow-hidden opacity-0",
          )}
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            data-spectra-sidebar-search=""
            value={sidebarSearch}
            onChange={(event) => setSidebarSearch(event.target.value)}
            placeholder="Search recent chats"
            aria-label="Search recent chats"
            className="h-8 w-full rounded-chip border border-[var(--border-default)] bg-[var(--bg-elevated)] pl-8 pr-10 text-micro outline-none placeholder:text-[var(--text-placeholder)] focus:border-[var(--border-strong)]"
          />
        </label>
        <nav
          ref={navRef}
          aria-label="Main destinations"
          className="spectra-shell-nav relative mt-2.5 flex flex-col gap-px px-3"
          onMouseLeave={snapRailMarkerToActive}
        >
          <span
            aria-hidden="true"
            className="spectra-shell-rail-marker"
            data-visible={railMarker.visible || undefined}
            style={{
              height: railMarker.height,
              transform: `translateY(${railMarker.top}px)`,
            }}
          />
          {coreDestinations.map(({ href, label, icon: Icon }) => {
            const active = activeCoreHref === href;
            return (
              <Link
                key={href}
                href={href === "/workspace" ? "/workspace?home=1" : href}
                prefetch={false}
                onClick={(event) => {
                  if (
                    href === "/workspace" &&
                    pathname.startsWith("/workspace")
                  ) {
                    event.preventDefault();
                    void spectraBus.command("navigation.home", {});
                  }
                }}
                onMouseEnter={(event) => placeRailMarker(event.currentTarget)}
                aria-current={active ? "page" : undefined}
                title={
                  sidebarCollapsed
                    ? label === "Home"
                      ? "Workspace"
                      : label
                    : undefined
                }
                className={cn(
                  "relative flex h-9 items-center gap-2.5 rounded-chip text-ui font-medium transition-colors",
                  sidebarCollapsed ? "justify-center px-0" : "px-2.5",
                  active
                    ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                )}
              >
                <Icon size={15} strokeWidth={active ? 2.05 : 1.65} />
                <span
                  data-sidebar-expanded=""
                  className={cn(sidebarCollapsed && "sr-only")}
                >
                  {label === "Home" ? "Workspace" : label}
                </span>
              </Link>
            );
          })}
        </nav>
        <Link
          href="/chat"
          prefetch={false}
          className={cn(
            "mx-3 mt-2.5 flex h-8 items-center justify-center gap-2 rounded-control bg-[var(--brand-primary)] text-micro font-semibold text-[var(--text-inverse)] shadow-soft transition hover:brightness-95",
            sidebarCollapsed && "mx-auto w-10",
          )}
        >
          <Plus size={15} />{" "}
          <span
            data-sidebar-expanded=""
            className={cn(sidebarCollapsed && "sr-only")}
          >
            New chat
          </span>
        </Link>
        <div
          className={cn(
            "spectra-thin-scrollbar min-h-0 flex-1 overflow-y-auto pb-3",
            sidebarCollapsed ? "px-2" : "px-3",
          )}
          data-sidebar-recents=""
        >
          {sidebarCollapsed
            ? null
            : threadSections.map(({ pinned, rows }) => {
                return (
                  <section key={String(pinned)} className="mt-3">
                    <h2 className="flex items-center justify-between px-1 text-micro font-semibold uppercase tracking-[.1em] text-[var(--text-tertiary)]">
                      <span>{pinned ? "Pinned" : pathname === "/chat" ? "Chats" : "Recents"}</span>
                      {pathname === "/chat" && !pinned ? <span className="font-normal normal-case tracking-normal text-[var(--text-placeholder)]">{rows.length}</span> : null}
                    </h2>
                    <div className="mt-1 space-y-0.5">
                      {rows.map((thread) => (
                        <Link
                          key={thread._id}
                          href={`/chat?threadId=${encodeURIComponent(thread._id)}`}
                          prefetch={false}
                          aria-current={pathname === "/chat" && activeThreadId === thread._id ? "page" : undefined}
                          className={cn("group flex items-center gap-2 rounded-chip px-1.5 text-caption text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]", pathname === "/chat" ? "min-h-10 py-1" : "h-8")}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            <span className="block truncate">{thread.title}</span>
                            {pathname === "/chat" && thread.contexts ? (
                              <span className="block truncate text-micro text-[var(--text-placeholder)]">
                                {[...(thread.contexts.workspaces ?? []).map((context) => context.title), ...(thread.contexts.artifacts ?? []).map((context) => context.title)].slice(0, 2).join(" · ") || "Inbox"}
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-micro tabular-nums text-[var(--text-tertiary)]">
                            {formatRelativeTime(
                              thread.lastMessageAt ?? thread.updatedAt,
                            )}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </section>
                );
              })}
          {!sidebarCollapsed && threadsLoaded && threadSections.length === 0 ? (
            <p className="mt-3 px-1 text-micro leading-4 text-[var(--text-tertiary)]">
              {sidebarSearch.trim()
                ? `No recent chats match “${sidebarSearch.trim()}”.`
                : "Your chats will appear here. Start one with New chat."}
            </p>
          ) : null}
        </div>
        <div
          className={cn(
            "relative mt-auto shrink-0 border-t border-[var(--border-subtle)] py-2",
            sidebarCollapsed ? "px-2" : "px-3",
          )}
        >
          <div
            className={cn(
              "flex items-center justify-between",
              sidebarCollapsed && "flex-col justify-center gap-1",
            )}
          >
            <button
              type="button"
              aria-label="Open Spectra command bar"
              onClick={() => spectraBus.emit("shell.openCommandBar", {})}
              title={`Command bar · ${isMacPlatform ? "⌘" : "Ctrl"} K`}
              className="grid size-8 place-items-center rounded-chip text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            >
              <Command size={15} />
            </button>
            <button
              type="button"
              aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
              onClick={() => {
                setNotificationsOpen((open) => !open);
                void refreshNotifications();
              }}
              className="relative grid size-8 place-items-center rounded-chip text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            >
              <Bell size={15} />
              {unreadCount ? (
                <span className="absolute right-0 top-0 grid min-w-3.5 place-items-center rounded-full bg-[var(--danger)] px-0.5 text-micro leading-3.5 text-white">
                  {unreadCount}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              aria-label="Settings"
              onClick={() => router.push("/settings")}
              className="grid size-8 place-items-center rounded-chip text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"
            >
              <Settings2 size={15} />
            </button>
            <ShortcutsButton compact />
          </div>
          {administrationIdentity ? (
            <button
              type="button"
              onClick={() => openUserProfile()}
              className={cn(
                "mt-2 flex w-full items-center gap-2 rounded-control px-1 py-1 text-left hover:bg-[var(--bg-secondary)]",
                sidebarCollapsed && "justify-center",
              )}
              aria-label="Manage account"
            >
              <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-control bg-[var(--bg-user-bubble)] text-micro font-semibold text-[var(--brand-primary)]">
                {administrationIdentity.account.avatarUrl ? (
                  // External Clerk avatar URLs; next/image would need a broad remotePatterns allowlist.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={administrationIdentity.account.avatarUrl}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  administrationIdentity.account.name
                    .split(/\s+/)
                    .map((part) => part[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()
                )}
              </span>
              <span
                data-sidebar-expanded=""
                className={cn("min-w-0 flex-1", sidebarCollapsed && "sr-only")}
              >
                <strong className="block truncate text-micro font-semibold text-[var(--text-primary)]">
                  {administrationIdentity.account.name}
                </strong>
                <span className="block truncate text-micro capitalize text-[var(--text-tertiary)]">
                  {administrationIdentity.membership?.role.replace("_", " ") ??
                    "Signed in"}
                </span>
              </span>
            </button>
          ) : null}
          {notificationsOpen ? (
            <section className="fixed right-4 top-4 z-panel w-[340px] overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]">
              <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
                <div>
                  <strong className="text-caption">Notifications</strong>
                  <p className="text-micro text-[var(--text-tertiary)]">
                    Shares, comments, tasks, and reminders
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!unreadCount}
                  onClick={() => void markAllNotificationsRead()}
                  className="flex h-7 items-center gap-1 rounded-chip px-2 text-micro text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-35"
                >
                  <CheckCheck size={12} />
                  Mark read
                </button>
              </header>
              <div className="spectra-thin-scrollbar max-h-[420px] overflow-y-auto p-1.5">
                {notifications.slice(0, 30).map((item) => (
                  <Link
                    key={`wide:${item.kind}:${item.id}`}
                    href={
                      item.href ??
                      `/library/${encodeURIComponent(item.artifactId)}`
                    }
                    onClick={() => {
                      setNotificationsOpen(false);
                      if (item.kind === "share") reviewShareInvitations();
                      void markNotificationRead(item);
                    }}
                    className="flex gap-2.5 rounded-control px-2.5 py-2 hover:bg-[var(--bg-hover)]"
                  >
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-micro font-semibold">
                        {item.title}
                      </strong>
                      <span className="mt-0.5 block line-clamp-2 text-micro leading-3.5 text-[var(--text-secondary)]">
                        {item.detail}
                      </span>
                    </span>
                    {!item.readAt && item.kind !== "share" ? (
                      <i className="mt-1 size-1.5 shrink-0 rounded-full bg-[var(--brand-primary)]" />
                    ) : null}
                  </Link>
                ))}
                {!notifications.length && !notificationsLoading ? (
                  <p className="px-4 py-8 text-center text-micro text-[var(--text-tertiary)]">
                    You are all caught up.
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </aside>
      {mobileWorkspaceOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-modal bg-[var(--bg-overlay)] md:hidden"
            onClick={() => setMobileWorkspaceOpen(false)}
            aria-label="Close workspace navigation"
          />
          <section
            aria-label="Choose a workspace"
            className="fixed inset-x-3 bottom-[84px] z-panel max-h-[min(70dvh,560px)] overflow-hidden rounded-surface border bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)] md:hidden"
            style={{ borderColor: "var(--border-default)" }}
          >
            <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
              <div>
                <h2 className="text-body font-semibold text-[var(--text-primary)]">
                  Workspaces
                </h2>
                <p className="mt-0.5 text-micro text-[var(--text-tertiary)]">
                  Open any shared or personal workspace
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMobileWorkspaceOpen(false)}
                className="grid size-9 place-items-center rounded-card text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"
                aria-label="Close"
              >
                <X size={17} />
              </button>
            </header>
            <div className="max-h-[calc(min(70dvh,560px)-70px)] overflow-y-auto p-2">
              {workspaces.map((workspace, index) => {
                const Icon = workspaceIcon(workspace);
                return (
                  <Link
                    key={workspace._id}
                    href={workspaceHref(workspace._id)}
                    className="flex min-h-12 items-center gap-3 rounded-surface px-3 py-2 text-ui font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                  >
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-card text-white"
                      style={{ background: workspaceColor(workspace, index) }}
                    >
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {workspace.title}
                    </span>
                    {workspace.isShared || workspace.ownership === "shared" ? (
                      <>
                        <UsersRound
                          size={14}
                          aria-hidden="true"
                          className="text-[var(--text-tertiary)]"
                        />
                        <span className="sr-only">Shared</span>
                      </>
                    ) : null}
                  </Link>
                );
              })}
              <CatalogProgress catalog={workspaceCatalog} />
              <Link
                href="/workspace?create=1"
                className="mt-1 flex min-h-12 items-center gap-3 rounded-surface px-3 py-2 text-ui font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
              >
                <span className="grid size-8 place-items-center rounded-card border border-dashed border-[var(--border-default)]">
                  <Plus size={15} />
                </span>
                Create workspace
              </Link>
            </div>
          </section>
        </>
      ) : null}

      {notificationsOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-modal bg-[var(--bg-overlay)] md:hidden"
            onClick={() => setNotificationsOpen(false)}
            aria-label="Close notifications"
          />
          <section
            aria-label="Notifications"
            className="fixed inset-x-3 bottom-[84px] z-panel max-h-[min(72dvh,620px)] overflow-hidden rounded-surface border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)] md:hidden"
          >
            <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
              <div>
                <h2 className="text-body font-semibold text-[var(--text-primary)]">
                  Notifications
                </h2>
                <p className="mt-0.5 text-micro text-[var(--text-tertiary)]">
                  Shares, comments, tasks, and reminders
                </p>
              </div>
              <button
                type="button"
                disabled={!unreadCount}
                onClick={() => void markAllNotificationsRead()}
                className="inline-flex h-9 items-center gap-1.5 rounded-card px-2.5 text-micro font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-35"
              >
                <CheckCheck size={15} /> Mark read
              </button>
            </header>
            <div className="max-h-[calc(min(72dvh,620px)-68px)] overflow-y-auto p-2">
              {notifications.slice(0, 50).map((item) => {
                const Icon =
                  item.kind === "comment"
                    ? MessageSquareText
                    : item.kind === "share"
                      ? Share2
                      : item.kind === "planner"
                        ? ListTodo
                        : CalendarClock;
                return (
                  <Link
                    key={`mobile:${item.kind}:${item.id}`}
                    href={
                      item.href ??
                      `/library/${encodeURIComponent(item.artifactId)}`
                    }
                    onClick={() => {
                      setNotificationsOpen(false);
                      if (item.kind === "share") reviewShareInvitations();
                      void markNotificationRead(item);
                    }}
                    className="flex gap-3 rounded-surface px-3 py-3 hover:bg-[var(--bg-hover)]"
                  >
                    <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-card bg-[color-mix(in_oklab,var(--brand-primary)_9%,var(--bg-primary))] text-[var(--brand-primary)]">
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <strong className="min-w-0 flex-1 truncate text-caption text-[var(--text-primary)]">
                          {item.title}
                        </strong>
                        {!item.readAt && item.kind !== "share" ? (
                          <i className="size-1.5 shrink-0 rounded-full bg-[var(--brand-primary)]" />
                        ) : null}
                      </span>
                      <span className="mt-0.5 block line-clamp-2 text-micro leading-4 text-[var(--text-secondary)]">
                        {item.detail}
                      </span>
                    </span>
                  </Link>
                );
              })}
              {!notifications.length && !notificationsLoading ? (
                <div className="px-5 py-10 text-center text-caption text-[var(--text-tertiary)]">
                  You are all caught up.
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}

      <nav
        aria-label="Primary navigation"
        className="fixed inset-x-3 bottom-3 z-chrome flex h-16 items-center gap-1 rounded-surface border px-2 shadow-[var(--shadow-lg)] backdrop-blur-xl md:hidden"
        style={{
          borderColor: "var(--border-default)",
          background:
            "color-mix(in oklab, var(--bg-elevated) 88%, transparent)",
        }}
      >
        {mobilePrimaryDestinations.map(({ href, label, icon: Icon }) => {
          const active = activeCoreHref === href;
          return (
            <Link
              key={href}
              href={href === "/workspace" ? "/workspace?home=1" : href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2 text-micro font-semibold",
                active
                  ? "text-[var(--brand-primary)]"
                  : "text-[var(--text-tertiary)]",
              )}
            >
              <Icon size={19} strokeWidth={active ? 2.1 : 1.7} />
              {label === "Home" ? "Workspace" : label}
            </Link>
          );
        })}
        <OverflowMenu
          label="More destinations"
          items={mobileOverflowItems}
          onSelect={selectMobileOverflow}
          active={Boolean(
            (activeCoreHref &&
              !mobilePrimaryDestinations.some(
                ({ href }) => href === activeCoreHref,
              )) ||
              selectedWorkspaceId ||
              mobileWorkspaceOpen ||
              notificationsOpen,
          )}
          size={52}
          triggerClassName="flex flex-1 flex-col gap-1 rounded-xl px-1 py-2 text-micro font-semibold"
        />
      </nav>
    </>
  );
}

export function AppShell(props: AppShellProps) {
  const ready = useAccountStorageReady();
  return ready ? (
    <AppShellContent {...props} />
  ) : (
    <div className="min-h-dvh bg-[var(--bg-primary)]" aria-busy="true" />
  );
}

function AppShellContent({
  children,
  fullBleed = false,
  noScroll = false,
  contentClassName,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [shellSidebarCollapsed, setShellSidebarCollapsed] = useState(false);
  /* Mirrors the sidebar's crowd derivation so the content padding and the
     dock band's left edge follow the auto-rail, not just the stored
     preference. An explicit toggle during crowding (delivered through
     `shell.sidebarLayout`) takes control until the crowding clears. */
  const [shellSidebarCrowded, setShellSidebarCrowded] = useState(false);
  const [shellCrowdOverride, setShellCrowdOverride] = useState(false);
  const shellSidebarCrowdedRef = useRef(false);
  shellSidebarCrowdedRef.current = shellSidebarCrowded;
  const shellEffectiveCollapsed =
    shellSidebarCollapsed || (shellSidebarCrowded && !shellCrowdOverride);
  const showTabRail =
    pathname === "/workspace" ||
    pathname.startsWith("/workspace/") ||
    pathname === "/library" ||
    pathname.startsWith("/library/");

  useLayoutEffect(() => {
    // The persisted work session is deliberately restored after mount. This
    // keeps SSR and the first client tree identical while still restoring tabs
    // before the browser paints the settled shell.
    void useSpectraContextStore.persist.rehydrate();
  }, []);

  useLayoutEffect(() => {
    setShellSidebarCollapsed(
      window.localStorage.getItem("spectra:sidebar-collapsed") === "true",
    );
    return spectraBus.on("shell.sidebarLayout", ({ collapsed }) => {
      setShellSidebarCollapsed(collapsed);
      // An explicit layout choice while the workbench is crowded wins over
      // the auto-rail for the rest of the crowded episode.
      setShellCrowdOverride((current) =>
        shellSidebarCrowdedRef.current ? true : current,
      );
    });
  }, []);
  useEffect(
    () =>
      spectraBus.on("shell.sidebarCrowd", ({ crowded }) => {
        setShellSidebarCrowded(crowded);
        if (!crowded) setShellCrowdOverride(false);
      }),
    [],
  );

  return (
    <div
      onClickCapture={captureSpectraNavigation}
      data-sidebar-collapsed={shellEffectiveCollapsed}
      style={{
        minHeight: "100dvh",
        ...(noScroll ? { height: "100dvh", overflow: "hidden" } : {}),
      }}
      className={cn(
        "spectra-app-shell min-h-dvh bg-[var(--bg-primary)] text-[var(--text-primary)] transition-[padding] duration-[var(--motion-base)] ease-standard",
        shellEffectiveCollapsed ? "md:pl-[76px]" : "md:pl-[240px]",
      )}
    >
      <KeyboardShortcutsRegistrar
        onNewChat={() => {
          router.push("/chat");
        }}
        onOpenSettings={() => {
          router.push("/settings");
        }}
        onFocusComposer={() => {
          const composer = document.querySelector<HTMLElement>(
            "[data-spectra-composer], textarea[placeholder*='Ask Spectra'], [contenteditable='true']",
          );
          composer?.focus();
        }}
        onFocusSearch={() => spectraBus.emit("shell.focusSidebarSearch", {})}
      />
      <KeyboardShortcutsHelp />
      <SignedInContinue />
      <UniversalKBar />
      <ShellNavigation />
      <main
        id="main-content"
        tabIndex={-1}
        style={{
          minHeight: "100dvh",
          ...(noScroll
            ? {
                height: "100dvh",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }
            : {}),
        }}
        className={cn(
          "relative min-h-dvh pb-24 md:flex md:h-dvh md:min-h-0 md:flex-col md:pb-0",
          noScroll && "h-dvh min-h-0 overflow-hidden",
        )}
      >
        {showTabRail ? (
          <header className="spectra-shell-tab-header hidden h-[44px] shrink-0 items-center gap-3 border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-4 md:flex">
            <div
              className="flex min-w-0 flex-1 items-center overflow-hidden"
              id="spectra-shell-tab-slot"
            />
          </header>
        ) : (
          <div id="spectra-shell-tab-slot" className="hidden" />
        )}
        <ProductOfflineBanner />
        <AppChoreographyMount />
        <ViewportReadinessMount />
        <div
          style={{ minHeight: 0 }}
          className={cn(
            "spectra-global-stage flex min-h-0 flex-1 md:overflow-hidden",
            noScroll && "overflow-hidden",
            !fullBleed && "px-5 py-6 sm:px-8",
            contentClassName,
          )}
        >
          <div className="relative min-h-0 min-w-0 flex-1" data-spectra-app-surface="true">
            {children}
            <GlobalRouteWorkbench />
          </div>
          <RouteSidePanelHost />
          <ViewportContextPicker />
        </div>
      </main>
    </div>
  );
}
