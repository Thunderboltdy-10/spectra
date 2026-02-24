"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export function GlobalSettingsDrawer() {
  const pathname = usePathname();
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
        className="absolute inset-0 bg-black/35 backdrop-blur-none md:backdrop-blur-sm"
        aria-label="Close settings"
        onClick={() => setOpen(false)}
      />
      <aside className="absolute inset-y-0 right-0 w-[92vw] max-w-[400px] border-l border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-primary)_92%,var(--bg-elevated))] p-4 shadow-[var(--shadow-soft)]">
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
            <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Context</p>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              {pathname === "/"
                ? "Full chat settings are available in the right panel for this conversation."
                : "Chat-specific model and mode controls stay tied to each conversation. You can keep using this page while changing quick preferences here."}
            </p>
          </section>

          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
            <div className="inline-flex items-center gap-1 text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">
              <Settings2 className="h-3.5 w-3.5" />
              Session
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
