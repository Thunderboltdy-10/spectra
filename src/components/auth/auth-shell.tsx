import Link from "next/link";
import type { ReactNode } from "react";
import { SpectraMark } from "@/components/spectra-mark";
import { AuthHome, type AuthHomeKind } from "./auth-home";

/**
 * The pages before Spectra: a Home on the left, whose depends on the page,
 * in the light the landing page draws around its windows, and the form on
 * the right. Below a laptop's width the form has the page to itself.
 */
export function AuthShell({ home, children }: { home: AuthHomeKind; children: ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-scene">
        <span className="auth-scene-light" aria-hidden />
        <AuthHome kind={home} />
      </div>
      <div className="auth-side">
        <div className="auth-form">
          <Link
            href="/"
            aria-label="Spectra home"
            className="inline-flex w-fit items-center gap-2.5 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          >
            <SpectraMark size={26} />
            <span className="font-display text-subhead font-semibold text-[var(--text-primary)]">Spectra</span>
          </Link>
          {children}
        </div>
      </div>
    </main>
  );
}
