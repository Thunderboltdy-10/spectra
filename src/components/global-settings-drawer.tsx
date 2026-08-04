"use client";

import { useEffect, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { ChevronRight, Cpu, School, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rightPanelSurfaceClassName } from "@/components/ui/right-panel-surface";
import { Switch } from "@/components/ui/switch";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSpectraPreferences } from "@/features/spectra/settings/preference-store";
import { spectraBus } from "@/features/spectra/events";
import { hasClerkPublishableKey } from "@/lib/clerk-config";

type DrawerBodyProps = {
  open: boolean;
  onClose: () => void;
  onManageAccount?: () => void;
  onSignOut?: () => void;
};

function DrawerBody({
  open,
  onClose,
  onManageAccount,
  onSignOut,
}: DrawerBodyProps) {
  const { preferences, update } = useSpectraPreferences();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95]">
      <button
        type="button"
        className="absolute inset-0 bg-transparent"
        aria-label="Close settings"
        onClick={onClose}
      />
      <aside
        className={`${rightPanelSurfaceClassName()} absolute inset-y-0 right-0 w-[92vw] max-w-[400px] border-l p-4 shadow-[var(--shadow-soft)]`}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="font-display text-xl text-[var(--text-primary)]">
            Settings
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5">
            <p className="text-sm text-[var(--text-primary)]">Theme</p>
            <ThemeToggle />
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]">
            <div className="flex items-center gap-3 px-3 py-2.5">
              <Sparkles className="size-4 text-[var(--accent)]" />
              <span className="min-w-0 flex-1 text-sm text-[var(--text-primary)]">Smart completion</span>
              <Switch aria-label="Smart completion" checked={preferences.writing.smartCompletion} onCheckedChange={(smartCompletion) => update("writing", { smartCompletion })} />
            </div>
            <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] px-3 py-2.5">
              <Cpu className="size-4 text-[var(--accent)]" />
              <label htmlFor="quick-local-compute" className="min-w-0 flex-1 text-sm text-[var(--text-primary)]">Local compute</label>
              <select id="quick-local-compute" value={preferences.compute.local} onChange={(event) => update("compute", { local: event.target.value as typeof preferences.compute.local })} className="h-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-[11px] text-[var(--text-primary)]">
                <option value="auto">Auto</option>
                <option value="prefer_local">Prefer local</option>
                <option value="never">Never</option>
              </select>
            </div>
          </div>

          <Link href="/settings" onClick={onClose} className="flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-3 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]">
            All settings
            <ChevronRight className="size-4 text-[var(--text-tertiary)]" />
          </Link>

          <Link href="/settings?section=privacy" onClick={onClose} className="flex items-center justify-between rounded-xl px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
            Privacy and data
            <ChevronRight className="size-4 text-[var(--text-tertiary)]" />
          </Link>

          <Link
            href="/school"
            onClick={onClose}
            className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[color-mix(in_oklab,#3c8a70_10%,var(--bg-elevated))] text-[#3c8a70]">
              <School className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-[var(--text-primary)]">
                School data
              </span>
              <span className="mt-0.5 block text-[11px] leading-4 text-[var(--text-secondary)]">
                Review connected school data, freshness, permissions and source
                provenance.
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-[var(--text-tertiary)]" />
          </Link>

          {onManageAccount && onSignOut ? (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-[var(--text-secondary)]">
                Account
              </h4>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={onManageAccount}
                >
                  Manage account
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={onSignOut}
                >
                  Sign out
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
              Local mode: account controls are unavailable.
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function GlobalSettingsDrawerWithClerk(props: {
  open: boolean;
  onClose: () => void;
}) {
  const { openUserProfile, signOut } = useClerk();
  useEffect(
    () => spectraBus.handle("settings.manageAccount", () => openUserProfile()),
    [openUserProfile],
  );
  return (
    <DrawerBody
      open={props.open}
      onClose={props.onClose}
      onManageAccount={() => openUserProfile()}
      onSignOut={() => void signOut()}
    />
  );
}

export function GlobalSettingsDrawer() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onToggle = () => setOpen((prev) => !prev);
    window.addEventListener("ai-school:toggle-settings", onToggle);
    return () =>
      window.removeEventListener("ai-school:toggle-settings", onToggle);
  }, []);

  if (hasClerkPublishableKey()) {
    return (
      <GlobalSettingsDrawerWithClerk
        open={open}
        onClose={() => setOpen(false)}
      />
    );
  }

  return <DrawerBody open={open} onClose={() => setOpen(false)} />;
}
