"use client";

import { useEffect, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { Settings2, X } from "lucide-react";
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
        className="absolute inset-0 bg-black/35"
        aria-label="Close settings"
        onClick={() => setOpen(false)}
      />
      <aside className={`${rightPanelSurfaceClassName()} absolute inset-y-0 right-0 w-[92vw] max-w-[400px] border-l p-4 shadow-[var(--shadow-soft)]`}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Settings</p>
            <h3 className="font-display text-2xl text-[var(--text-primary)]">Quick Preferences</h3>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close settings">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-3">
          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
            <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Appearance</p>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-sm text-[var(--text-primary)]">Theme</p>
              <ThemeToggle />
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
            <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Account</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => openUserProfile()}>
                Manage account
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => signOut()}>
                Sign out
              </Button>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
            <div className="inline-flex items-center gap-1 text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">
              <Settings2 className="h-3.5 w-3.5" />
              Session
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {pathname === "/" ? null : (
                <Button type="button" size="sm" variant="secondary" onClick={() => (window.location.href = "/")}>
                  Open chat controls
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => window.dispatchEvent(new Event("ai-school:open-cookie-settings"))}
              >
                Cookie settings
              </Button>
            </div>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Open this drawer from any page with the settings button or command palette.
            </p>
          </section>
        </div>
      </aside>
    </div>
  );
}
