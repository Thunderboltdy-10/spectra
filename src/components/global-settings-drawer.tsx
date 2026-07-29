"use client";

import { useEffect, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { Brain, ChevronRight, School, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rightPanelSurfaceClassName } from "@/components/ui/right-panel-surface";
import { ThemeToggle } from "@/components/theme-toggle";
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

          <Link
            href="/memory"
            onClick={onClose}
            className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[color-mix(in_oklab,var(--brand-primary)_9%,var(--bg-elevated))] text-[var(--brand-primary)]">
              <Brain className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-[var(--text-primary)]">
                Memory & personalization
              </span>
              <span className="mt-0.5 block text-[11px] leading-4 text-[var(--text-secondary)]">
                Inspect, correct, pause, export, or forget what Spectra
                remembers.
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-[var(--text-tertiary)]" />
          </Link>

          <Link
            href="/managebac"
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
                Connect your verified ManageBac identity and review synchronized
                classes, tasks, timetable, provenance, and conflicts.
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
