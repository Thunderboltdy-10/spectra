"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Atom,
  BarChart3,
  BookOpen,
  Brain,
  Bell,
  Bot,
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
  HelpCircle,
  Moon,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sprout,
  UsersRound,
  X,
  Share2,
  Star,
  MoreHorizontal,
  ChevronRight,
  CircleCheck,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { SpectraLogo } from "@/components/spectra-logo";
import { cn } from "@/lib/utils";
import {
  getSpectraArtifactCommentNotifications,
  getSpectraPlannerReminderNotifications,
  getSpectraTimetableReminderNotifications,
  getSpectraWorkspaces,
  getSpectraThreads,
  markSpectraArtifactCommentNotificationsRead,
  markSpectraPlannerReminderNotificationsRead,
  markSpectraTimetableReminderNotificationsRead,
  type SpectraArtifactCommentNotification,
  type SpectraPlannerReminderNotification,
  type SpectraTimetableReminderNotification,
  type SpectraWorkspace,
  type SpectraThread,
} from "@/features/spectra/data/api";
import {
  getAdministration,
  type AdministrationIdentity,
} from "@/features/spectra/administration/api";

type AppShellProps = {
  children: ReactNode;
  fullBleed?: boolean;
  noScroll?: boolean;
  contentClassName?: string;
};

const ordinaryDestinations = [
  { href: "/chat", label: "Chat", icon: MessageSquareText },
  { href: "/workspace", label: "Home", icon: LayoutGrid },
  { href: "/artifacts", label: "Artifacts", icon: LibraryBig },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/models", label: "Models", icon: Brain },
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
  return `/workspace?workspaceId=${encodeURIComponent(workspaceId)}`;
}

function RailTooltip({ children }: { children: ReactNode }) {
  return (
    <span
      className="pointer-events-none absolute left-[58px] z-[70] hidden max-w-56 whitespace-nowrap rounded-[7px] border px-2.5 py-1.5 text-[11px] font-semibold shadow-[0_8px_26px_rgba(27,20,12,.13)] group-hover:block group-focus-visible:block"
      style={{
        borderColor: "var(--border-default)",
        background: "var(--bg-elevated)",
        color: "var(--text-primary)",
      }}
    >
      {children}
    </span>
  );
}

function ActiveRailMarker() {
  return (
    <span
      aria-hidden="true"
      className="absolute -left-2 h-6 w-[3px] rounded-r-full bg-[var(--brand-primary)]"
    />
  );
}

function ShellNavigation() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedWorkspaceId = searchParams.get("workspaceId");
  const [workspaces, setWorkspaces] = useState<SpectraWorkspace[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [workspacesUnavailable, setWorkspacesUnavailable] = useState(false);
  const [threads, setThreads] = useState<SpectraThread[]>([]);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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

  useEffect(() => {
    const stored = window.localStorage.getItem("spectra:sidebar-collapsed");
    if (stored === "true") setSidebarCollapsed(true);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      window.localStorage.setItem("spectra:sidebar-collapsed", String(next));
      window.dispatchEvent(new CustomEvent("spectra:sidebar-layout", { detail: { collapsed: next } }));
      return next;
    });
  }, []);

  const coreDestinations = useMemo(() => {
    const destinations: Array<{
      href: string;
      label: string;
      icon: LucideIcon;
    }> = [...ordinaryDestinations];
    if (administrationIdentity?.membership.role === "school_admin")
      destinations.push({ href: "/admin", label: "Admin", icon: Building2 });
    if (administrationIdentity?.account.platformOperator)
      destinations.push({
        href: "/superadmin",
        label: "Super Admin",
        icon: ShieldCheck,
      });
    if (administrationIdentity?.membership.role === "school_admin")
      destinations.push({
        href: "/admin?tab=feedback",
        label: "Feedback",
        icon: MessageSquareText,
      });
    return destinations;
  }, [administrationIdentity]);

  const refreshWorkspaces = useCallback(async (force = false) => {
    try {
      const next = await getSpectraWorkspaces(force);
      setWorkspaces(next.filter((workspace) => workspace.status === "active"));
      setWorkspacesUnavailable(false);
    } catch {
      setWorkspacesUnavailable(true);
    } finally {
      setWorkspacesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshWorkspaces();
    const refresh = () => void refreshWorkspaces(true);
    window.addEventListener("spectra:workspaces-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("spectra:workspaces-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refreshWorkspaces]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void getSpectraThreads({ limit: 40 })
        .then(({ threads: rows }) => {
          if (active) setThreads(rows.filter((thread) => thread.status === "active"));
        })
        .catch(() => undefined);
    };
    refresh();
    window.addEventListener("spectra:threads-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("spectra:threads-changed", refresh);
    };
  }, []);

  const refreshNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    try {
      const [comments, planner, timetable] = await Promise.all([
        getSpectraArtifactCommentNotifications(false, 30),
        getSpectraPlannerReminderNotifications(false, 30),
        getSpectraTimetableReminderNotifications(false, 30),
      ]);
      setCommentNotifications(comments.notifications);
      setPlannerNotifications(planner.notifications);
      setTimetableNotifications(timetable.notifications);
    } catch {
      // Navigation remains fully usable when the notification service is unavailable.
    } finally {
      setNotificationsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshNotifications();
    const interval = window.setInterval(refreshNotifications, 60_000);
    return () => window.clearInterval(interval);
  }, [refreshNotifications]);

  const notifications = useMemo(
    () =>
      [
        ...commentNotifications.map((item) => ({
          id: item._id,
          kind: "comment" as const,
          artifactId: item.artifactId,
          title:
            item.kind === "mention"
              ? `${item.author?.name ?? "Someone"} mentioned you`
              : item.kind === "reply"
                ? `${item.author?.name ?? "Someone"} replied`
                : `New comment from ${item.author?.name ?? "a collaborator"}`,
          detail: `${item.artifact.title} · ${item.comment.body}`,
          createdAt: item.createdAt,
          readAt: item.readAt,
        })),
        ...plannerNotifications.map((item) => ({
          id: item._id,
          kind: "planner" as const,
          artifactId: item.artifactId,
          title: item.taskTitle,
          detail: `Due ${new Date(item.dueAt).toLocaleString()}`,
          createdAt: item.createdAt,
          readAt: item.readAt,
        })),
        ...timetableNotifications.map((item) => ({
          id: item._id,
          kind: "timetable" as const,
          artifactId: item.artifactId,
          title: item.eventTitle,
          detail: `${item.artifactTitle} · ${new Date(item.occurrenceStart).toLocaleString()}`,
          createdAt: item.createdAt,
          readAt: item.readAt,
        })),
      ].sort((a, b) => b.createdAt - a.createdAt),
    [commentNotifications, plannerNotifications, timetableNotifications],
  );
  const unreadCount = notifications.filter((item) => !item.readAt).length;

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
  }, [pathname, selectedWorkspaceId]);

  return (
    <>
      <aside aria-label="Spectra navigation" className={cn("spectra-shell-sidebar fixed inset-y-0 left-0 z-40 w-[240px] flex-col border-r border-[var(--border-default)] bg-[var(--bg-sidebar)]", sidebarCollapsed ? "hidden" : "hidden md:flex")}>
        <button type="button" onClick={toggleSidebar} aria-label="Collapse sidebar" title="Collapse sidebar" className="absolute right-3 top-4 z-10 grid size-8 place-items-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><PanelLeftClose size={14}/></button>
        <Link href="/workspace?home=1" className="mx-4 mt-4 flex h-9 items-center gap-2 rounded-[7px] px-1 outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]" aria-label="Spectra home">
          <SpectraLogo size={22} />
          <span className="font-[family-name:var(--font-display)] text-[19px] font-semibold tracking-[-.025em] text-[#171513]">spectra</span>
        </Link>
        <label className="relative mx-3 mt-3 block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input value={sidebarSearch} onChange={(event) => setSidebarSearch(event.target.value)} placeholder="Search" className="h-8 w-full rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-elevated)] pl-8 pr-10 text-[11px] outline-none placeholder:text-[var(--text-placeholder)] focus:border-[var(--border-strong)]" />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-[4px] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px] text-[var(--text-tertiary)]">⌘ K</span>
        </label>
        <nav aria-label="Main destinations" className="mt-3 flex flex-col gap-0.5 px-3">
          {coreDestinations.map(({ href, label, icon: Icon }) => {
            const active = activeCoreHref === href;
            return <Link key={href} href={href === "/workspace" ? "/workspace?home=1" : href} onClick={() => { if (href === "/workspace") window.dispatchEvent(new Event("spectra:navigate-workspace-home")); }} aria-current={active ? "page" : undefined} className={cn("flex h-8 items-center gap-2.5 rounded-[6px] px-2 text-[11px] font-medium transition-colors", active ? "bg-[#eeece9] text-[#171513]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]")}><Icon size={14} strokeWidth={active ? 2.05 : 1.65} /><span>{label === "Home" ? "Workspace" : label}</span></Link>;
          })}
        </nav>
        <Link href="/chat" className="mx-3 mt-3 flex h-8 items-center justify-center gap-2 rounded-[6px] bg-[#7659ef] text-[11px] font-semibold text-white shadow-[0_1px_2px_rgba(83,61,180,.22)] transition hover:bg-[#684ce3]"><Plus size={14} /> New chat</Link>
        <div className="relative mx-3 mt-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input value={sidebarSearch} onChange={(event) => setSidebarSearch(event.target.value)} placeholder="Search chats" className="h-8 w-full rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-elevated)] pl-8 pr-2 text-[10px] outline-none placeholder:text-[var(--text-placeholder)]" />
        </div>
        <div className="spectra-thin-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {([true, false] as const).map((pinned) => {
            const term = sidebarSearch.trim().toLowerCase();
            const rows = threads.filter((thread) => Boolean(thread.pinned) === pinned && (!term || thread.title.toLowerCase().includes(term))).slice(0, pinned ? 5 : 10);
            if (!rows.length) return null;
            return <section key={String(pinned)} className="mt-3"><h2 className="px-1 text-[8px] font-semibold uppercase tracking-[.09em] text-[var(--text-tertiary)]">{pinned ? "Pinned" : "Recents"}</h2><div className="mt-1 space-y-0.5">{rows.map((thread, index) => <Link key={thread._id} href={`/chat?threadId=${encodeURIComponent(thread._id)}`} className="flex h-7 items-center gap-2 rounded-[5px] px-1.5 text-[9.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><i className="size-1.5 shrink-0 rounded-full" style={{background:index % 4 === 3 ? "#8371ee" : "#1aa47b"}}/><span className="min-w-0 flex-1 truncate">{thread.title}</span></Link>)}</div></section>;
          })}
          {workspaces.length ? <section className="mt-4 border-t border-[var(--border-subtle)] pt-3"><div className="flex items-center justify-between px-1"><h2 className="text-[8px] font-semibold uppercase tracking-[.09em] text-[var(--text-tertiary)]">Workspaces</h2><Link href="/workspace?create=1" aria-label="Create workspace" className="grid size-5 place-items-center rounded-[4px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"><Plus size={12}/></Link></div><div className="mt-1 space-y-0.5">{workspaces.filter((workspace) => !sidebarSearch.trim() || workspace.title.toLowerCase().includes(sidebarSearch.trim().toLowerCase())).slice(0,8).map((workspace,index) => { const Icon=workspaceIcon(workspace); const active=pathname==="/workspace"&&selectedWorkspaceId===workspace._id; return <Link key={workspace._id} href={workspaceHref(workspace._id)} className={cn("flex h-8 items-center gap-2 rounded-[6px] px-1.5 text-[10px]",active?"bg-[var(--bg-hover)] font-semibold text-[var(--text-primary)]":"text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]")}><span className="grid size-5 place-items-center rounded-[5px] text-white" style={{background:workspaceColor(workspace,index)}}><Icon size={11}/></span><span className="min-w-0 flex-1 truncate">{workspace.title}</span>{workspace.isShared||workspace.ownership==="shared"?<UsersRound size={11}/>:null}</Link>})}</div></section> : null}
          {workspacesLoading ? <div className="mt-4 h-16 animate-pulse rounded-[7px] bg-[var(--bg-secondary)]"/> : null}
          {workspacesUnavailable ? <button type="button" onClick={() => void refreshWorkspaces(true)} className="mt-3 w-full rounded-[6px] px-2 py-2 text-left text-[10px] text-[var(--danger)] hover:bg-[var(--bg-hover)]">Workspaces unavailable · Retry</button> : null}
        </div>
        <div className="relative shrink-0 border-t border-[var(--border-subtle)] px-3 py-2">
          <div className="flex items-center justify-between">
            <button type="button" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} onClick={() => { setNotificationsOpen((open) => !open); void refreshNotifications(); }} className="relative grid size-8 place-items-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"><Bell size={15}/>{unreadCount?<span className="absolute right-0 top-0 grid min-w-3.5 place-items-center rounded-full bg-[var(--danger)] px-0.5 text-[7px] leading-3.5 text-white">{unreadCount}</span>:null}</button>
            <button type="button" aria-label="Help" className="grid size-8 place-items-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"><HelpCircle size={15}/></button>
            <button type="button" aria-label="Toggle theme" onClick={() => window.dispatchEvent(new Event("ai-school:toggle-theme"))} className="grid size-8 place-items-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"><Moon size={15}/></button>
            <button type="button" aria-label="Settings" onClick={() => window.dispatchEvent(new Event("ai-school:toggle-settings"))} className="grid size-8 place-items-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"><Settings2 size={15}/></button>
          </div>
          {administrationIdentity ? <div className="mt-2 flex items-center gap-2 rounded-[7px] px-1 py-1"><span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-[7px] bg-[#d8d0fa] text-[10px] font-semibold text-[#3e327f]">{administrationIdentity.account.avatarUrl ? <img src={administrationIdentity.account.avatarUrl} alt="" className="size-full object-cover"/> : administrationIdentity.account.name.split(/\s+/).map((part) => part[0]).join("").slice(0,2).toUpperCase()}</span><span className="min-w-0 flex-1"><strong className="block truncate text-[10px] font-semibold text-[var(--text-primary)]">{administrationIdentity.account.name}</strong><span className="block truncate text-[8.5px] capitalize text-[var(--text-tertiary)]">{administrationIdentity.membership.role.replace("_"," ")}</span></span></div> : null}
          {notificationsOpen ? <section className="absolute bottom-2 left-[228px] z-[80] w-[340px] overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[0_22px_70px_rgba(27,20,12,.18)]"><header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3"><div><strong className="text-[12px]">Notifications</strong><p className="text-[9px] text-[var(--text-tertiary)]">Comments, tasks, and calendar reminders</p></div><button type="button" disabled={!unreadCount} onClick={() => void markAllNotificationsRead()} className="flex h-7 items-center gap-1 rounded-[6px] px-2 text-[9px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-35"><CheckCheck size={12}/>Mark read</button></header><div className="spectra-thin-scrollbar max-h-[420px] overflow-y-auto p-1.5">{notifications.slice(0,30).map((item) => <Link key={`wide:${item.kind}:${item.id}`} href={`/artifacts?artifactId=${encodeURIComponent(item.artifactId)}`} onClick={() => { setNotificationsOpen(false); void markNotificationRead(item); }} className="flex gap-2.5 rounded-[7px] px-2.5 py-2 hover:bg-[var(--bg-hover)]"><span className="min-w-0 flex-1"><strong className="block truncate text-[10px] font-semibold">{item.title}</strong><span className="mt-0.5 block line-clamp-2 text-[9px] leading-3.5 text-[var(--text-secondary)]">{item.detail}</span></span>{!item.readAt?<i className="mt-1 size-1.5 shrink-0 rounded-full bg-[var(--brand-primary)]"/>:null}</Link>)}{!notifications.length&&!notificationsLoading?<p className="px-4 py-8 text-center text-[10px] text-[var(--text-tertiary)]">You are all caught up.</p>:null}</div></section> : null}
        </div>
      </aside>
      <aside
        aria-label="Spectra navigation"
        className={cn("fixed inset-y-0 left-0 z-40 w-[76px] flex-col border-r", sidebarCollapsed ? "hidden md:flex" : "hidden")}
        style={{
          borderColor: "var(--border-default)",
          background:
            "linear-gradient(180deg, color-mix(in oklab, var(--bg-elevated) 94%, var(--brand-primary) 6%) 0%, var(--bg-elevated) 48%, color-mix(in oklab, var(--bg-elevated) 96%, var(--brand-accent) 4%) 100%)",
        }}
      >
        <Link
          href="/chat"
          aria-label="Open Spectra"
          className="mx-auto mt-3.5 grid size-11 shrink-0 place-items-center rounded-2xl outline-none transition-transform hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
        >
          <SpectraLogo size={34} />
        </Link>
        <button type="button" onClick={toggleSidebar} aria-label="Expand sidebar" title="Expand sidebar" className="absolute right-1 top-1 grid size-7 place-items-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><PanelLeftOpen size={13}/></button>

        <nav
          aria-label="Main destinations"
          className="spectra-thin-scrollbar mt-5 flex max-h-[43dvh] shrink-0 flex-col items-center gap-1.5 overflow-y-auto overflow-x-visible px-2"
        >
          {coreDestinations.map(({ href, label, icon: Icon }) => {
            const active = activeCoreHref === href;
            return (
              <Link
                key={href}
                href={href === "/workspace" ? "/workspace?home=1" : href}
                onClick={() => {
                  if (href === "/workspace")
                    window.dispatchEvent(
                      new Event("spectra:navigate-workspace-home"),
                    );
                }}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-[8px] text-[10px] font-medium outline-none transition-[background,color,transform,box-shadow] duration-200",
                  active
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_2px_8px_rgba(27,20,12,.055)]"
                    : "text-[var(--text-secondary)] hover:-translate-y-px hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                )}
              >
                {active ? <ActiveRailMarker /> : null}
                <Icon size={16} strokeWidth={active ? 2 : 1.7} />
                <span className="max-w-[52px] truncate leading-none">
                  {label}
                </span>
                <RailTooltip>{label}</RailTooltip>
              </Link>
            );
          })}
        </nav>

        <div
          aria-hidden="true"
          className="mx-auto my-3 h-px w-8 shrink-0 bg-[var(--border-subtle)]"
        />

        <nav
          aria-label="Workspaces"
          className="flex min-h-0 flex-1 flex-col items-center px-2"
        >
          <div className="spectra-thin-scrollbar flex w-full min-h-0 flex-1 flex-col items-center gap-2 overflow-x-visible overflow-y-auto py-0.5">
            {workspaces.map((workspace, index) => {
              const Icon = workspaceIcon(workspace);
              const active =
                pathname === "/workspace" &&
                selectedWorkspaceId === workspace._id;
              const shared =
                workspace.isShared || workspace.ownership === "shared";
              return (
                <Link
                  key={workspace._id}
                  href={workspaceHref(workspace._id)}
                  aria-label={workspace.title}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex w-14 shrink-0 flex-col items-center gap-1 rounded-[8px] px-1 py-2 text-[10px] font-medium outline-none transition-[background,transform,box-shadow] duration-200",
                    active
                      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_2px_8px_rgba(27,20,12,.055)]"
                      : "text-[var(--text-secondary)] hover:-translate-y-px hover:bg-[var(--bg-hover)]",
                  )}
                >
                  {active ? <ActiveRailMarker /> : null}
                  <span
                    className="relative grid size-8 place-items-center rounded-[9px] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.18)]"
                    style={{ background: workspaceColor(workspace, index) }}
                  >
                    <Icon size={15} strokeWidth={1.9} />
                    {shared ? (
                      <span className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full border-2 border-[var(--bg-elevated)] bg-[var(--text-primary)] text-[var(--bg-primary)]">
                        <UsersRound size={8} strokeWidth={2.2} />
                      </span>
                    ) : null}
                  </span>
                  <span className="max-w-[52px] truncate leading-none">
                    {workspace.title}
                  </span>
                  <RailTooltip>
                    {workspace.title}
                    {shared ? " · Shared" : ""}
                  </RailTooltip>
                </Link>
              );
            })}
            {workspacesLoading ? (
              <span
                className="size-8 shrink-0 animate-pulse rounded-[9px] bg-[var(--bg-secondary)]"
                aria-label="Loading workspaces"
              />
            ) : null}
            {workspacesUnavailable ? (
              <button
                type="button"
                onClick={() => void refreshWorkspaces(true)}
                className="group relative grid size-10 shrink-0 place-items-center rounded-[12px] text-[var(--danger)] outline-none hover:bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-elevated))]"
                aria-label="Retry loading workspaces"
              >
                <Folders size={17} />
                <RailTooltip>Workspaces unavailable · Retry</RailTooltip>
              </button>
            ) : null}
          </div>
          <Link
            href="/workspace?create=1"
            className="group relative my-1 grid size-10 shrink-0 place-items-center rounded-[12px] text-[var(--text-tertiary)] outline-none hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            aria-label="Create workspace"
          >
            <Plus size={17} strokeWidth={1.8} />
            <RailTooltip>Create workspace</RailTooltip>
          </Link>
        </nav>

        <div className="relative mx-auto mb-3.5 flex shrink-0 flex-col items-center gap-1">
          <button
            type="button"
            aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
            aria-expanded={notificationsOpen}
            onClick={() => {
              setNotificationsOpen((open) => !open);
              void refreshNotifications();
            }}
            className="group relative grid size-11 place-items-center rounded-[14px] text-[var(--text-tertiary)] outline-none transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          >
            <Bell size={19} strokeWidth={1.7} />
            {unreadCount ? (
              <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-[var(--danger)] px-1 text-[8px] font-bold leading-4 text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
            <RailTooltip>Notifications</RailTooltip>
          </button>
          {notificationsOpen ? (
            <section className="absolute bottom-0 left-[58px] z-[80] w-[340px] overflow-hidden rounded-[14px] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[0_22px_70px_rgba(27,20,12,.2)]">
              <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
                <div>
                  <strong className="text-[13px] text-[var(--text-primary)]">
                    Notifications
                  </strong>
                  <p className="text-[10px] text-[var(--text-tertiary)]">
                    Comments, tasks, and calendar reminders
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!unreadCount}
                  onClick={() => void markAllNotificationsRead()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[10px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-35"
                >
                  <CheckCheck size={14} /> Mark read
                </button>
              </header>
              <div className="spectra-thin-scrollbar max-h-[420px] overflow-y-auto p-1.5">
                {notifications.slice(0, 50).map((item) => {
                  const Icon =
                    item.kind === "comment"
                      ? MessageSquareText
                      : item.kind === "planner"
                        ? ListTodo
                        : CalendarClock;
                  return (
                    <Link
                      key={`${item.kind}:${item.id}`}
                      href={`/artifacts?artifactId=${encodeURIComponent(item.artifactId)}`}
                      onClick={() => {
                        setNotificationsOpen(false);
                        void markNotificationRead(item);
                      }}
                      className="flex gap-3 rounded-[10px] px-3 py-2.5 hover:bg-[var(--bg-hover)]"
                    >
                      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[9px] bg-[color-mix(in_oklab,var(--brand-primary)_9%,var(--bg-primary))] text-[var(--brand-primary)]">
                        <Icon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <strong className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-primary)]">
                            {item.title}
                          </strong>
                          {!item.readAt ? (
                            <i className="size-1.5 shrink-0 rounded-full bg-[var(--brand-primary)]" />
                          ) : null}
                        </span>
                        <span className="mt-0.5 block line-clamp-2 text-[10px] leading-4 text-[var(--text-secondary)]">
                          {item.detail}
                        </span>
                        <time className="mt-1 block text-[9px] text-[var(--text-tertiary)]">
                          {new Date(item.createdAt).toLocaleString()}
                        </time>
                      </span>
                    </Link>
                  );
                })}
                {!notifications.length && !notificationsLoading ? (
                  <div className="px-5 py-9 text-center text-[11px] text-[var(--text-tertiary)]">
                    You are all caught up.
                  </div>
                ) : null}
                {notificationsLoading && !notifications.length ? (
                  <div className="px-5 py-9 text-center text-[11px] text-[var(--text-tertiary)]">
                    Loading notifications…
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
          <button
            type="button"
            aria-label="Settings"
            onClick={() =>
              window.dispatchEvent(new Event("ai-school:toggle-settings"))
            }
            className="group relative grid size-11 place-items-center rounded-[14px] text-[var(--text-tertiary)] outline-none transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          >
            <Settings2 size={19} strokeWidth={1.7} />
            <RailTooltip>Settings</RailTooltip>
          </button>
        </div>
      </aside>

      {mobileWorkspaceOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-50 bg-[rgba(18,23,34,.24)] backdrop-blur-[1px] md:hidden"
            onClick={() => setMobileWorkspaceOpen(false)}
            aria-label="Close workspace navigation"
          />
          <section
            aria-label="Choose a workspace"
            className="fixed inset-x-3 bottom-[84px] z-[51] max-h-[min(70dvh,560px)] overflow-hidden rounded-[20px] border bg-[var(--bg-elevated)] shadow-[0_24px_70px_rgba(18,23,34,.24)] md:hidden"
            style={{ borderColor: "var(--border-default)" }}
          >
            <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
              <div>
                <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
                  Workspaces
                </h2>
                <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
                  Open any shared or personal workspace
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMobileWorkspaceOpen(false)}
                className="grid size-9 place-items-center rounded-[10px] text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"
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
                    className="flex min-h-12 items-center gap-3 rounded-[12px] px-3 py-2 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                  >
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-[9px] text-white"
                      style={{ background: workspaceColor(workspace, index) }}
                    >
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {workspace.title}
                    </span>
                    {workspace.isShared || workspace.ownership === "shared" ? (
                      <UsersRound
                        size={14}
                        className="text-[var(--text-tertiary)]"
                      />
                    ) : null}
                  </Link>
                );
              })}
              <Link
                href="/workspace?create=1"
                className="mt-1 flex min-h-12 items-center gap-3 rounded-[12px] px-3 py-2 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
              >
                <span className="grid size-8 place-items-center rounded-[9px] border border-dashed border-[var(--border-default)]">
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
            className="fixed inset-0 z-50 bg-[rgba(18,23,34,.24)] backdrop-blur-[1px] md:hidden"
            onClick={() => setNotificationsOpen(false)}
            aria-label="Close notifications"
          />
          <section
            aria-label="Notifications"
            className="fixed inset-x-3 bottom-[84px] z-[51] max-h-[min(72dvh,620px)] overflow-hidden rounded-[20px] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[0_24px_70px_rgba(18,23,34,.24)] md:hidden"
          >
            <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
              <div>
                <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
                  Notifications
                </h2>
                <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
                  Comments, tasks, and calendar reminders
                </p>
              </div>
              <button
                type="button"
                disabled={!unreadCount}
                onClick={() => void markAllNotificationsRead()}
                className="inline-flex h-9 items-center gap-1.5 rounded-[9px] px-2.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-35"
              >
                <CheckCheck size={15} /> Mark read
              </button>
            </header>
            <div className="max-h-[calc(min(72dvh,620px)-68px)] overflow-y-auto p-2">
              {notifications.slice(0, 50).map((item) => {
                const Icon =
                  item.kind === "comment"
                    ? MessageSquareText
                    : item.kind === "planner"
                      ? ListTodo
                      : CalendarClock;
                return (
                  <Link
                    key={`mobile:${item.kind}:${item.id}`}
                    href={`/artifacts?artifactId=${encodeURIComponent(item.artifactId)}`}
                    onClick={() => {
                      setNotificationsOpen(false);
                      void markNotificationRead(item);
                    }}
                    className="flex gap-3 rounded-[12px] px-3 py-3 hover:bg-[var(--bg-hover)]"
                  >
                    <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[10px] bg-[color-mix(in_oklab,var(--brand-primary)_9%,var(--bg-primary))] text-[var(--brand-primary)]">
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <strong className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-primary)]">
                          {item.title}
                        </strong>
                        {!item.readAt ? (
                          <i className="size-1.5 shrink-0 rounded-full bg-[var(--brand-primary)]" />
                        ) : null}
                      </span>
                      <span className="mt-0.5 block line-clamp-2 text-[11px] leading-4 text-[var(--text-secondary)]">
                        {item.detail}
                      </span>
                    </span>
                  </Link>
                );
              })}
              {!notifications.length && !notificationsLoading ? (
                <div className="px-5 py-10 text-center text-[12px] text-[var(--text-tertiary)]">
                  You are all caught up.
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}

      <nav
        aria-label="Spectra navigation"
        className="spectra-thin-scrollbar fixed inset-x-3 bottom-3 z-[52] flex h-16 items-center gap-1 overflow-x-auto rounded-[22px] border px-2 shadow-[0_18px_60px_-22px_rgba(11,18,36,.55)] backdrop-blur-xl md:hidden"
        style={{
          borderColor: "var(--border-default)",
          background:
            "color-mix(in oklab, var(--bg-elevated) 88%, transparent)",
        }}
      >
        {coreDestinations.map(({ href, label, icon: Icon }) => {
          const active = activeCoreHref === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-[62px] flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-semibold",
                active
                  ? "text-[var(--brand-primary)]"
                  : "text-[var(--text-tertiary)]",
              )}
            >
              <Icon size={19} strokeWidth={active ? 2.1 : 1.7} />
              {label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMobileWorkspaceOpen((open) => !open)}
          aria-expanded={mobileWorkspaceOpen}
          className={cn(
            "flex min-w-[62px] flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-semibold",
            selectedWorkspaceId || mobileWorkspaceOpen
              ? "text-[var(--brand-primary)]"
              : "text-[var(--text-tertiary)]",
          )}
        >
          <Folders size={19} strokeWidth={selectedWorkspaceId ? 2.1 : 1.7} />
          Workspaces
        </button>
        <button
          type="button"
          onClick={() => {
            setMobileWorkspaceOpen(false);
            setNotificationsOpen((open) => !open);
            void refreshNotifications();
          }}
          aria-expanded={notificationsOpen}
          className={cn(
            "relative flex min-w-[62px] flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-semibold",
            notificationsOpen
              ? "text-[var(--brand-primary)]"
              : "text-[var(--text-tertiary)]",
          )}
        >
          <Bell size={19} strokeWidth={notificationsOpen ? 2.1 : 1.7} />
          {unreadCount ? (
            <span className="absolute right-3 top-1 grid min-w-4 place-items-center rounded-full bg-[var(--danger)] px-1 text-[8px] font-bold leading-4 text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
          Alerts
        </button>
      </nav>
    </>
  );
}

export function AppShell({
  children,
  fullBleed = false,
  noScroll = false,
  contentClassName,
}: AppShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [shellSidebarCollapsed, setShellSidebarCollapsed] = useState(false);
  const [pageContext, setPageContext] = useState<{
    source?: string;
    kind?: string;
    title?: string;
  } | null>(null);
  const workspaceId = searchParams.get("workspaceId");
  const sectionLabel = pathname.startsWith("/workspace")
    ? "Workspaces"
    : pathname.startsWith("/artifacts")
      ? "Artifacts"
      : pathname.startsWith("/agents")
        ? "Agents"
        : pathname.startsWith("/chat")
          ? "Chat"
          : pathname.startsWith("/superadmin")
            ? "Super Admin"
            : pathname.startsWith("/admin")
              ? "Admin"
              : pathname.startsWith("/managebac")
                ? "ManageBac"
                : "Spectra";

  const requestPageAction = (action: "share" | "favorite" | "more") => {
    window.dispatchEvent(new CustomEvent(`spectra:page-${action}`));
  };

  useEffect(() => {
    setShellSidebarCollapsed(
      window.localStorage.getItem("spectra:sidebar-collapsed") === "true",
    );
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ collapsed?: boolean }>).detail;
      setShellSidebarCollapsed(Boolean(detail?.collapsed));
    };
    window.addEventListener("spectra:sidebar-layout", update);
    return () => window.removeEventListener("spectra:sidebar-layout", update);
  }, []);

  useEffect(() => {
    const update = (event: Event) => {
      setPageContext(
        (event as CustomEvent<{ source?: string; kind?: string; title?: string }>).detail ?? null,
      );
    };
    const clear = () => setPageContext(null);
    window.addEventListener("spectra:page-context", update);
    window.addEventListener("spectra:clear-page-context", clear);
    return () => {
      window.removeEventListener("spectra:page-context", update);
      window.removeEventListener("spectra:clear-page-context", clear);
    };
  }, []);

  return (
    <div className={cn("min-h-dvh bg-[#fbfaf8] text-[var(--text-primary)] transition-[padding] duration-200", shellSidebarCollapsed ? "md:pl-[76px]" : "md:pl-[240px]")}>
      <ShellNavigation />
      <main
        className={cn(
          "relative min-h-dvh pb-24 md:flex md:h-dvh md:min-h-0 md:flex-col md:gap-1 md:px-[17px] md:pb-3 md:pt-5",
          noScroll && "h-dvh min-h-0 overflow-hidden",
          !fullBleed &&
            "mx-auto w-full max-w-[1540px] px-5 py-6 sm:px-8 lg:px-10",
        )}
      >
        <header className="spectra-global-commandbar hidden h-10 shrink-0 items-center justify-between rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-5 md:flex">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[10.5px] text-[var(--text-secondary)]">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[5px] font-medium hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              onClick={() => window.dispatchEvent(new CustomEvent("spectra:return-to-section"))}
            >
              <LayoutGrid size={13} strokeWidth={1.7}/>{pageContext?.source ?? sectionLabel}
            </button>
            {pageContext?.kind ? <><ChevronRight size={12} className="text-[var(--text-tertiary)]"/><span>{pageContext.kind}</span></> : null}
            {pageContext?.title ? <><ChevronRight size={12} className="text-[var(--text-tertiary)]"/><span className="truncate font-semibold text-[var(--text-primary)]">{pageContext.title}</span></> : workspaceId ? <><ChevronRight size={12} className="text-[var(--text-tertiary)]"/><span className="truncate font-semibold text-[var(--text-primary)]">Current workspace</span></> : null}
          </nav>
          <div className="flex items-center gap-2">
            <span className="mr-2 inline-flex items-center gap-1.5 text-[9.5px] text-[var(--text-tertiary)]"><CircleCheck size={13} className="text-[var(--success)]"/>Saved just now</span>
            <button type="button" onClick={() => requestPageAction("share")} className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[10px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"><Share2 size={13}/>Share</button>
            <button type="button" onClick={() => requestPageAction("favorite")} aria-label="Favorite" className="grid size-8 place-items-center rounded-[6px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><Star size={14}/></button>
            <button type="button" onClick={() => requestPageAction("more")} aria-label="More page actions" className="grid size-8 place-items-center rounded-[6px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><MoreHorizontal size={15}/></button>
          </div>
        </header>
        <div className={cn("spectra-global-stage min-h-0 flex-1 md:overflow-hidden md:rounded-[8px] md:border md:border-[var(--border-default)] md:bg-[var(--bg-elevated)]", noScroll && "overflow-hidden", contentClassName)}>{children}</div>
      </main>
    </div>
  );
}
