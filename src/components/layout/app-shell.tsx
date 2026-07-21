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
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sprout,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { SpectraLogo } from "@/components/spectra-logo";
import { cn } from "@/lib/utils";
import {
  getSpectraArtifactCommentNotifications,
  getSpectraPlannerReminderNotifications,
  getSpectraTimetableReminderNotifications,
  getSpectraWorkspaces,
  markSpectraArtifactCommentNotificationsRead,
  markSpectraPlannerReminderNotificationsRead,
  markSpectraTimetableReminderNotificationsRead,
  type SpectraArtifactCommentNotification,
  type SpectraPlannerReminderNotification,
  type SpectraTimetableReminderNotification,
  type SpectraWorkspace,
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
        label: "Superadmin",
        icon: ShieldCheck,
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
      coreDestinations.find(
        ({ href }) => pathname === href || pathname.startsWith(`${href}/`),
      )?.href ?? null
    );
  }, [pathname, selectedWorkspaceId]);

  return (
    <>
      <aside
        aria-label="Spectra navigation"
        className="fixed inset-y-0 left-0 z-40 hidden w-[76px] flex-col border-r md:flex"
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

        <nav
          aria-label="Main destinations"
          className="spectra-thin-scrollbar mt-5 flex max-h-[43dvh] shrink-0 flex-col items-center gap-1.5 overflow-y-auto overflow-x-visible px-2"
        >
          {coreDestinations.map(({ href, label, icon: Icon }) => {
            const active = activeCoreHref === href;
            return (
              <Link
                key={href}
                href={href}
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
  return (
    <div className="min-h-dvh bg-[var(--bg-primary)] text-[var(--text-primary)] md:pl-[76px]">
      <ShellNavigation />
      <main
        className={cn(
          "relative min-h-dvh pb-24 md:pb-0",
          noScroll && "h-dvh min-h-0 overflow-hidden",
          !fullBleed &&
            "mx-auto w-full max-w-[1540px] px-5 py-6 sm:px-8 lg:px-10",
          contentClassName,
        )}
      >
        {children}
      </main>
    </div>
  );
}
