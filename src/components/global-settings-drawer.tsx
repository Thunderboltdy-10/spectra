"use client";

import { useEffect, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rightPanelSurfaceClassName } from "@/components/ui/right-panel-surface";
import { ThemeToggle } from "@/components/theme-toggle";
import { hasClerkPublishableKey } from "@/lib/clerk-config";
import { useWorkspaceStore } from "@/stores/workspace-store";

type DrawerBodyProps = {
  open: boolean;
  onClose: () => void;
  onManageAccount?: () => void;
  onSignOut?: () => void;
};

function DrawerBody({ open, onClose, onManageAccount, onSignOut }: DrawerBodyProps) {
  const autoSelectContext = useWorkspaceStore((state) => state.autoSelectContext);
  const setAutoSelectContext = useWorkspaceStore((state) => state.setAutoSelectContext);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95]">
      <button
        type="button"
        className="absolute inset-0 bg-transparent"
        aria-label="Close settings"
        onClick={onClose}
      />
      <aside className={`${rightPanelSurfaceClassName()} absolute inset-y-0 right-0 w-[92vw] max-w-[400px] border-l p-4 shadow-[var(--shadow-soft)]`}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="font-display text-xl text-[var(--text-primary)]">Settings</h3>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close settings">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5">
            <p className="text-sm text-[var(--text-primary)]">Theme</p>
            <ThemeToggle />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5">
            <div>
              <p className="text-sm text-[var(--text-primary)]">Auto-select workspace context</p>
              <p className="text-xs text-[var(--text-secondary)]">Automatically enter the nearest workspace while navigating the canvas.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoSelectContext}
              onClick={() => setAutoSelectContext(!autoSelectContext)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${autoSelectContext ? "bg-[var(--accent-cyan)]" : "bg-[var(--border-default)]"}`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${autoSelectContext ? "translate-x-5" : "translate-x-1"}`}
              />
            </button>
          </div>

          {onManageAccount && onSignOut ? (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-[var(--text-secondary)]">Account</h4>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={onManageAccount}>
                  Manage account
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={onSignOut}>
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
    return () => window.removeEventListener("ai-school:toggle-settings", onToggle);
  }, []);

  if (hasClerkPublishableKey()) {
    return <GlobalSettingsDrawerWithClerk open={open} onClose={() => setOpen(false)} />;
  }

  return <DrawerBody open={open} onClose={() => setOpen(false)} />;
}
