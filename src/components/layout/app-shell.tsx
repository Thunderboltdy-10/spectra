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
  Bot,
  Building2,
  Calculator,
  FlaskConical,
  Folders,
  GraduationCap,
  LayoutGrid,
  LibraryBig,
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
  getSpectraWorkspaces,
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

  useEffect(() => {
    setMobileWorkspaceOpen(false);
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

        <button
          type="button"
          aria-label="Settings"
          onClick={() =>
            window.dispatchEvent(new Event("ai-school:toggle-settings"))
          }
          className="group relative mx-auto mb-3.5 grid size-11 shrink-0 place-items-center rounded-[14px] text-[var(--text-tertiary)] outline-none transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
        >
          <Settings2 size={19} strokeWidth={1.7} />
          <RailTooltip>Settings</RailTooltip>
        </button>
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
