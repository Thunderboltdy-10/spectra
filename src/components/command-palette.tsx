"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  KBarAnimator,
  KBarPortal,
  KBarPositioner,
  KBarProvider,
  KBarResults,
  KBarSearch,
  useKBar,
  useMatches,
  useRegisterActions,
} from "kbar";
import { FileText, MessageSquare, CalendarClock, Code2, Image, Layers, Plus } from "lucide-react";
import { ALL_MODES, getModeConfig, isModeAvailable } from "@/lib/modes";
import { useSidebar } from "@/context/sidebar-context";

function CommandResults() {
  const { results } = useMatches();
  return (
    <KBarResults
      items={results}
      onRender={({ item, active }) =>
        typeof item === "string" ? (
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--text-secondary)]">
            {item}
          </div>
        ) : (
          <div
            className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
              active ? "bg-[var(--bg-hover)]" : ""
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              {item.icon && <div className="shrink-0 text-[var(--text-secondary)]">{item.icon}</div>}
              <div className="min-w-0">
                <p className="truncate text-[var(--text-primary)]">{item.name}</p>
                {item.subtitle && (
                  <p className="truncate text-xs text-[var(--text-secondary)]">{item.subtitle}</p>
                )}
              </div>
            </div>
            {item.shortcut?.length ? (
              <div className="flex items-center gap-1">
                {item.shortcut.map((shortcut) => (
                  <kbd
                    key={shortcut}
                    className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1 py-0.5 text-[10px] text-[var(--text-secondary)]"
                  >
                    {shortcut}
                  </kbd>
                ))}
              </div>
            ) : null}
          </div>
        )
      }
    />
  );
}

function CommandPaletteHotkeys() {
  const { query, visualState } = useKBar((state) => ({
    visualState: state.visualState,
  }));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isModK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isModK) {
        event.preventDefault();
        event.stopPropagation();
        query.toggle();
        return;
      }

      if (
        event.key === "Escape" &&
        (visualState === "showing" || visualState === "animating-in")
      ) {
        event.preventDefault();
        query.toggle();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [query, visualState]);

  return null;
}

/* ─── Workspace search bridge ──────────────────────────────── */

type WorkspaceSearchResult = {
  id: string;
  title: string;
  type: string;
  itemType?: string;
  renderMode?: string;
  workstreamId?: string;
  workstreamTitle?: string | null;
};

function typeIcon(itemType?: string, renderMode?: string) {
  const mode = renderMode ?? itemType ?? "";
  if (mode === "code_project" || mode === "code_output") return <Code2 className="h-3.5 w-3.5" />;
  if (mode === "visualization" || mode === "image" || mode === "diagram") return <Image className="h-3.5 w-3.5" />;
  if (mode === "thread" || itemType === "thread") return <MessageSquare className="h-3.5 w-3.5" />;
  if (mode === "planner" || itemType === "planner") return <CalendarClock className="h-3.5 w-3.5" />;
  return <FileText className="h-3.5 w-3.5" />;
}

function WorkspaceSearchBridge() {
  const { searchQuery } = useKBar((state) => ({ searchQuery: state.searchQuery }));
  const [wsResults, setWsResults] = useState<WorkspaceSearchResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchRef = useRef(0);

  useEffect(() => {
    const q = searchQuery.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q) { setWsResults([]); return; }

    debounceRef.current = setTimeout(async () => {
      const fetchId = ++fetchRef.current;
      try {
        const r = await fetch(`/api/workspace-items?action=search&q=${encodeURIComponent(q)}&limit=10`);
        if (!r.ok || fetchId !== fetchRef.current) return;
        const data = await r.json() as { results?: WorkspaceSearchResult[] };
        setWsResults(data.results ?? []);
      } catch { /* silent — palette stays usable even if workspace search fails */ }
    }, 280);
  }, [searchQuery]);

  const wsActions = useMemo(
    () =>
      wsResults.map((r) => ({
        id: `ws-search-${r.id}`,
        name: r.title,
        subtitle: r.workstreamTitle ? `in ${r.workstreamTitle}` : undefined,
        section: "Workspace",
        icon: typeIcon(r.itemType, r.renderMode),
        perform: () => {
          if (r.workstreamId) {
            window.dispatchEvent(new CustomEvent("workspace:navigate-to-item", {
              detail: { itemId: r.id, workstreamId: r.workstreamId },
            }));
          }
        },
      })),
    [wsResults],
  );

  useRegisterActions(wsActions, [wsActions]);

  return null;
}

/* ─── Workspace quick commands ─────────────────────────────── */

function WorkspaceQuickCommands() {
  const { searchQuery } = useKBar((state) => ({ searchQuery: state.searchQuery }));

  useRegisterActions(
    searchQuery.trim() === ""
      ? [
          {
            id: "ws-new-note",
            name: "New note",
            section: "Quick actions",
            icon: <FileText className="h-3.5 w-3.5" />,
            perform: () => window.dispatchEvent(new CustomEvent("workspace:create", { detail: { type: "note" } })),
          },
          {
            id: "ws-new-workspace",
            name: "New workspace",
            section: "Quick actions",
            icon: <Layers className="h-3.5 w-3.5" />,
            perform: () => window.dispatchEvent(new CustomEvent("workspace:create", { detail: { type: "workspace" } })),
          },
          {
            id: "ws-switch-workspace",
            name: "Switch to workspace…",
            section: "Quick actions",
            icon: <Plus className="h-3.5 w-3.5" />,
            perform: () => window.dispatchEvent(new Event("workspace:center-home")),
          },
        ]
      : [],
    [searchQuery],
  );

  return null;
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { role, isSuperAdmin } = useSidebar();
  const isAdmin = role === "admin" || isSuperAdmin;

  const actions = useMemo(
    () => [
      {
        id: "new-chat",
        name: "New chat",
        shortcut: ["c"],
        section: "Chat",
        perform: () => window.dispatchEvent(new Event("ai-school:new-chat")),
      },
      {
        id: "toggle-settings",
        name: "Toggle settings",
        section: "Chat",
        perform: () => window.dispatchEvent(new Event("ai-school:toggle-settings")),
      },
      {
        id: "open-tour",
        name: "Open page tour",
        section: "Navigation",
        perform: () => window.dispatchEvent(new Event("ai-school:open-tour")),
      },
      {
        id: "open-feedback",
        name: "Open feedback",
        section: "Navigation",
        perform: () => window.dispatchEvent(new Event("ai-school:open-feedback")),
      },
      {
        id: "open-focus-timer",
        name: "Open focus timer",
        section: "Navigation",
        perform: () => window.dispatchEvent(new Event("ai-school:open-focus-timer")),
      },
      {
        id: "cookie-settings",
        name: "Open cookie settings",
        section: "Preferences",
        perform: () => window.dispatchEvent(new Event("ai-school:open-cookie-settings")),
      },
      {
        id: "toggle-theme",
        name: "Toggle theme",
        section: "Preferences",
        shortcut: ["t"],
        perform: () => window.dispatchEvent(new Event("ai-school:toggle-theme")),
      },
      {
        id: "open-chat",
        name: "Open chat",
        section: "Navigation",
        perform: () => router.push("/chat"),
      },
      {
        id: "open-agents",
        name: "Open agents",
        section: "Navigation",
        perform: () => router.push("/agents"),
      },
      {
        id: "open-models",
        name: "Open models",
        section: "Navigation",
        perform: () => router.push("/models"),
      },
      {
        id: "open-analytics",
        name: "Open analytics",
        section: "Navigation",
        perform: () => router.push("/analytics"),
      },
      ...(isAdmin
        ? [
            {
              id: "open-admin",
              name: "Open admin",
              section: "Navigation",
              perform: () => router.push("/admin"),
            },
            {
              id: "open-school-admin",
              name: "Open school admin",
              section: "Navigation",
              perform: () => router.push("/admin/school"),
            },
            {
              id: "open-school-soul",
              name: "Open school SOUL",
              section: "Navigation",
              perform: () => router.push("/admin/school/soul"),
            },
            {
              id: "open-school-branding",
              name: "Open school branding",
              section: "Navigation",
              perform: () => router.push("/admin/school/branding"),
            },
          ]
        : []),
      ...(isSuperAdmin
        ? [
            {
              id: "open-super-admin",
              name: "Open super admin",
              section: "Navigation",
              perform: () => router.push("/super-admin"),
            },
          ]
        : []),
      ...ALL_MODES.map((mode) => ({
        id: `mode-${mode.key}`,
        name: `Switch mode: ${getModeConfig(mode.key).label}${isModeAvailable(mode.key) ? "" : " (Coming Soon)"}`,
        section: "Modes",
        perform: () => {
          if (!isModeAvailable(mode.key)) return;
          router.push("/chat");
          window.dispatchEvent(
            new CustomEvent("ai-school:set-mode", { detail: mode.key }),
          );
        },
      })),
    ],
    [router, isAdmin, isSuperAdmin],
  );

  return (
    <KBarProvider
      actions={actions}
      options={{
        toggleShortcut: "$mod+shift+k",
      }}
    >
      {children}
      <CommandPaletteHotkeys />
      <WorkspaceSearchBridge />
      <WorkspaceQuickCommands />
      <KBarPortal>
        <KBarPositioner className="z-[100] bg-[var(--bg-overlay)]">
          <KBarAnimator className="w-full max-w-xl rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-soft)]">
            <KBarSearch className="h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] pl-5 pr-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus-visible:border-[var(--border-default)] focus-visible:ring-0" />
            <div className="mt-2 max-h-[60vh] overflow-y-auto overscroll-contain pb-3">
              <CommandResults />
            </div>
          </KBarAnimator>
        </KBarPositioner>
      </KBarPortal>
    </KBarProvider>
  );
}
