"use client";

import { useEffect, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rightPanelSurfaceClassName } from "@/components/ui/right-panel-surface";
import { ThemeToggle } from "@/components/theme-toggle";

export function GlobalSettingsDrawer() {
  const pathname = usePathname();
  const { openUserProfile, signOut } = useClerk();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onToggle = () => setOpen((prev) => !prev);
    window.addEventListener("ai-school:toggle-settings", onToggle);
    return () => window.removeEventListener("ai-school:toggle-settings", onToggle);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95]">
      <button
        type="button"
        className="absolute inset-0 bg-transparent"
        aria-label="Close settings"
        onClick={() => setOpen(false)}
      />
      <aside className={`${rightPanelSurfaceClassName()} absolute inset-y-0 right-0 w-[92vw] max-w-[400px] border-l p-4 shadow-[var(--shadow-soft)]`}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="font-display text-xl text-[var(--text-primary)]">Settings</h3>
          <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close settings">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5">
            <p className="text-sm text-[var(--text-primary)]">Theme</p>
            <ThemeToggle />
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-medium text-[var(--text-secondary)]">Account</h4>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => openUserProfile()}>
                Manage account
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => signOut()}>
                Sign out
              </Button>
            </div>
          </div>

          {pathname !== "/" && (
            <div className="border-t border-[var(--border-default)] pt-3">
              <Button type="button" size="sm" variant="secondary" onClick={() => (window.location.href = "/")}>
                Open chat controls
              </Button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
