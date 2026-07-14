"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderKanban, LibraryBig, MessageSquareText, Settings2 } from "lucide-react";
import { SpectraLogo } from "@/components/spectra-logo";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: ReactNode;
  fullBleed?: boolean;
  noScroll?: boolean;
  contentClassName?: string;
};

const destinations = [
  { href: "/chat", label: "Spectra", icon: MessageSquareText },
  { href: "/workspace", label: "Workspaces", icon: FolderKanban },
  { href: "/artifacts", label: "Artifacts", icon: LibraryBig },
] as const;

function ShellNavigation() {
  const pathname = usePathname();

  return (
    <>
      <aside
        aria-label="Primary navigation"
        className="fixed inset-y-0 left-0 z-40 hidden w-[76px] flex-col border-r md:flex"
        style={{
          borderColor: "var(--border-default)",
          background:
            "linear-gradient(180deg, color-mix(in oklab, var(--bg-elevated) 94%, var(--brand-primary) 6%) 0%, var(--bg-elevated) 48%, color-mix(in oklab, var(--bg-elevated) 96%, var(--brand-accent) 4%) 100%)",
        }}
      >
        <Link
          href="/chat"
          aria-label="Open Spectra"
          className="mx-auto mt-4 grid size-11 place-items-center rounded-2xl outline-none transition-transform hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
        >
          <SpectraLogo size={34} />
        </Link>

        <nav className="mt-8 flex flex-1 flex-col items-center gap-2 px-2">
          {destinations.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative grid size-12 place-items-center rounded-2xl outline-none transition-[background,color,transform] duration-200",
                  active
                    ? "text-[var(--brand-primary)]"
                    : "text-[var(--text-tertiary)] hover:-translate-y-px hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]",
                )}
                style={active ? { background: "color-mix(in oklab, var(--brand-primary) 11%, var(--bg-elevated))" } : undefined}
              >
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute -left-2 h-6 w-[3px] rounded-r-full bg-[var(--brand-primary)]"
                  />
                ) : null}
                <Icon size={20} strokeWidth={active ? 2 : 1.7} />
                <span className="pointer-events-none absolute left-[58px] z-50 hidden whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-semibold shadow-lg group-hover:block group-focus-visible:block" style={{ borderColor: "var(--border-default)", background: "var(--bg-elevated)", color: "var(--text-primary)" }}>
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          aria-label="Settings"
          onClick={() => window.dispatchEvent(new Event("ai-school:toggle-settings"))}
          className="mx-auto mb-4 grid size-11 place-items-center rounded-2xl text-[var(--text-tertiary)] outline-none transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
        >
          <Settings2 size={19} strokeWidth={1.7} />
        </button>
      </aside>

      <nav
        aria-label="Primary navigation"
        className="fixed inset-x-3 bottom-3 z-50 flex h-16 items-center justify-around rounded-[22px] border px-2 shadow-[0_18px_60px_-22px_rgba(11,18,36,.55)] backdrop-blur-xl md:hidden"
        style={{ borderColor: "var(--border-default)", background: "color-mix(in oklab, var(--bg-elevated) 88%, transparent)" }}
      >
        {destinations.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-[72px] flex-col items-center gap-1 rounded-xl px-3 py-2 text-[10px] font-semibold",
                active ? "text-[var(--brand-primary)]" : "text-[var(--text-tertiary)]",
              )}
            >
              <Icon size={19} strokeWidth={active ? 2.1 : 1.7} />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export function AppShell({ children, fullBleed = false, noScroll = false, contentClassName }: AppShellProps) {
  return (
    <div className="min-h-dvh bg-[var(--bg-primary)] text-[var(--text-primary)] md:pl-[76px]">
      <ShellNavigation />
      <main
        className={cn(
          "relative min-h-dvh pb-24 md:pb-0",
          noScroll && "h-dvh min-h-0 overflow-hidden",
          !fullBleed && "mx-auto w-full max-w-[1540px] px-5 py-6 sm:px-8 lg:px-10",
          contentClassName,
        )}
      >
        {children}
      </main>
    </div>
  );
}
