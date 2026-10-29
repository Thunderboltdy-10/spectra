"use client";

import { useClerk } from "@clerk/nextjs";
import { Icon, type IconName } from "@/components/icons";
import { OPEN_SHORTCUTS_EVENT } from "@/components/keyboard-shortcuts";
import { useTheme } from "@/components/theme-provider";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AdministrationIdentity } from "@/features/spectra/administration/api";
import { spectraBus } from "@/features/spectra/events";
import { useSpectraRouter } from "@/features/spectra/hooks/use-spectra-router";
import { useSpectraPreferences } from "@/features/spectra/settings/preference-store";
import { cn } from "@/lib/utils";

/*
 * The rail's one account row (SHELL.md, "The rail"): the avatar and name,
 * opening a menu with notifications, settings, a quick theme switch, help and
 * sign out. Everything that used to crowd the rail's bottom lives here now.
 */

type Theme = "system" | "light" | "dark";

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function MenuGlyph({ name }: { name?: IconName }) {
  return <span className="grid size-4 shrink-0 place-items-center text-[var(--text-secondary)]">{name ? <Icon name={name} size={16} /> : null}</span>;
}

export function AccountMenu({
  identity,
  collapsed,
  unreadCount,
  onOpenNotifications,
}: {
  identity: AdministrationIdentity | null;
  collapsed: boolean;
  unreadCount: number;
  onOpenNotifications: () => void;
}) {
  const router = useSpectraRouter();
  const { openUserProfile, signOut } = useClerk();
  const { setTheme } = useTheme();
  const { preferences, update } = useSpectraPreferences();
  const name = identity?.account.name ?? "Your account";
  const role = identity?.membership?.role.replace("_", " ") ?? "Signed in";
  const shortcut = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl K";

  const applyTheme = (value: string) => {
    const theme = value as Theme;
    update("appearance", { theme });
    setTheme(theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme);
  };

  return (
    <DropdownMenu>
      <Tooltip label={name} side="right" disabled={!collapsed} className="flex w-full">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-account-row
            aria-label={`Account menu${unreadCount ? `, ${unreadCount} unread notifications` : ""}`}
            className={cn(
              "flex h-10 w-full items-center gap-2.5 rounded-control px-1.5 text-left outline-none transition-colors",
              "hover:bg-[var(--bg-desk-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] data-[state=open]:bg-[var(--bg-desk-hover)]",
              collapsed && "justify-center px-0",
            )}
          >
            <span className="relative shrink-0">
              <span className="grid size-7 place-items-center overflow-hidden rounded-full bg-[var(--bg-tertiary)] text-micro font-semibold text-[var(--text-primary)]">
                {identity?.account.avatarUrl ? (
                  // External Clerk avatar URLs; next/image would need a broad remotePatterns allowlist.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={identity.account.avatarUrl} alt="" className="size-full object-cover" />
                ) : (
                  initials(name)
                )}
              </span>
              {unreadCount ? <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-[var(--brand-primary)] ring-2 ring-[var(--bg-primary)]" /> : null}
            </span>
            {collapsed ? null : (
              <span data-sidebar-expanded="" className="min-w-0 flex-1">
                <strong className="block truncate text-caption font-semibold text-[var(--text-primary)]">{name}</strong>
                <span className="block truncate text-micro capitalize text-[var(--text-tertiary)]">{role}</span>
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-64">
        <DropdownMenuLabel className="normal-case tracking-normal">
          <span className="block truncate text-caption font-semibold text-[var(--text-primary)]">{name}</span>
          {identity?.account.email ? <span className="block truncate text-micro font-normal text-[var(--text-tertiary)]">{identity.account.email}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenNotifications}>
          <MenuGlyph name="bell" />
          <span className="flex-1">Notifications</span>
          {unreadCount ? <span className="rounded-chip bg-[var(--brand-primary)] px-1.5 text-micro font-semibold leading-4 text-[var(--text-inverse)]">{unreadCount}</span> : null}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push("/settings")}>
          <MenuGlyph name="settings" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2.5 normal-case tracking-normal">
          <MenuGlyph name="theme" />
          <span className="text-ui font-normal text-[var(--text-primary)]">Theme</span>
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={preferences.appearance.theme} onValueChange={applyTheme}>
          {(["system", "light", "dark"] as const).map((theme) => (
            <DropdownMenuRadioItem key={theme} value={theme} className="pl-[34px] capitalize">
              {theme}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => spectraBus.emit("shell.openCommandBar", {})}>
          <MenuGlyph name="search" />
          <span className="flex-1">Search and commands</span>
          <kbd className="font-sans text-micro text-[var(--text-tertiary)]">{shortcut}</kbd>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT))}>
          <MenuGlyph name="keyboard" />
          Keyboard shortcuts
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => spectraBus.emit("tour.start", {})}>
          <MenuGlyph name="help" />
          Take the tour
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push("/analytics")}>
          <MenuGlyph name="analytics" />
          Analytics
        </DropdownMenuItem>
        {identity?.membership?.role === "school_admin" ? (
          <DropdownMenuItem onSelect={() => router.push("/admin")}>
            <MenuGlyph name="school" />
            School admin
          </DropdownMenuItem>
        ) : null}
        {identity?.account.platformOperator ? (
          <DropdownMenuItem onSelect={() => router.push("/superadmin")}>
            <MenuGlyph name="locked" />
            Platform
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openUserProfile()}>
          <MenuGlyph name="people" />
          Manage account
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut({ redirectUrl: "/" })}>
          <MenuGlyph name="signOut" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
