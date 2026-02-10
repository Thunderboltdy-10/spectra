"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Bot, Compass, GraduationCap, LayoutDashboard, Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

type Role = "student" | "teacher" | "admin";

const baseLinks = [
  { href: "/", label: "Chat", icon: GraduationCap },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/models", label: "Models", icon: Compass },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [role, setRole] = useState<Role>("student");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/bootstrap");
        if (!response.ok) return;
        const data = (await response.json()) as { actor?: { role?: Role } };
        if (data.actor?.role) {
          setRole(data.actor.role);
        }
      } catch {
        // Non-blocking.
      }
    })();
  }, []);

  const links = useMemo(() => {
    if (role === "admin") {
      return [...baseLinks, { href: "/admin", label: "Admin", icon: LayoutDashboard }];
    }
    return baseLinks;
  }, [role]);

  return (
    <div className="flex min-h-screen bg-app text-ink-100">
      <aside className="hidden w-[320px] shrink-0 border-r border-[var(--border-default)] bg-[var(--gradient-surface)] p-3 md:flex md:flex-col">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--gradient-brand)] text-white shadow-[var(--shadow-soft)]">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg leading-none">AI School</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">studio</p>
          </div>
        </div>

        <div className="mb-3 flex items-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1">
          {links.map((link) => {
            const Icon = link.icon;
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                title={link.label}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-lg transition",
                  active
                    ? "bg-[var(--bg-primary)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
                )}
              >
                <Icon className="h-4 w-4" />
              </Link>
            );
          })}
        </div>

        <div className="mt-auto flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2">
          <p className="text-xs text-[var(--text-secondary)]">Theme</p>
          <ThemeToggle />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-6 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
