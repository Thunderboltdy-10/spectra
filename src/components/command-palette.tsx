"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  KBarAnimator,
  KBarPortal,
  KBarPositioner,
  KBarProvider,
  KBarResults,
  KBarSearch,
  useMatches,
} from "kbar";
import { ALL_MODES, getModeConfig } from "@/lib/modes";
import { useSidebar } from "@/context/sidebar-context";

function toggleTheme() {
  const root = document.documentElement;
  const isDark = root.classList.contains("dark");
  if (isDark) {
    root.classList.remove("dark");
    localStorage.setItem("ai-school-theme", "light");
  } else {
    root.classList.add("dark");
    localStorage.setItem("ai-school-theme", "dark");
  }
}

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
        id: "toggle-theme",
        name: "Toggle theme",
        section: "Preferences",
        shortcut: ["t"],
        perform: () => toggleTheme(),
      },
      {
        id: "open-chat",
        name: "Open chat",
        section: "Navigation",
        perform: () => router.push("/"),
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
        name: `Switch mode: ${getModeConfig(mode.key).label}`,
        section: "Modes",
        perform: () => {
          router.push("/");
          window.dispatchEvent(
            new CustomEvent("ai-school:set-mode", { detail: mode.key }),
          );
        },
      })),
    ],
    [router, isAdmin, isSuperAdmin],
  );

  return (
    <KBarProvider actions={actions}>
      {children}
      <KBarPortal>
        <KBarPositioner className="z-[100] bg-[var(--bg-overlay)] backdrop-blur-sm">
          <KBarAnimator className="w-full max-w-xl rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-soft)]">
            <KBarSearch className="h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]" />
            <div className="mt-2 max-h-[420px] overflow-y-auto">
              <CommandResults />
            </div>
          </KBarAnimator>
        </KBarPositioner>
      </KBarPortal>
    </KBarProvider>
  );
}
