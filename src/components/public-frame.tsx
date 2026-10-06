import Link from "next/link";
import type { ReactNode } from "react";
import { SpectraMark } from "@/components/spectra-mark";
import { cn } from "@/lib/utils";

const WIDTHS = {
  narrow: "max-w-xl",
  reading: "max-w-3xl",
  wide: "max-w-4xl",
} as const;

/**
 * Pages outside the app (sign-in, asking for access, legal, not found): the
 * mark that leads home, then the page, on the same field and tokens as the
 * app so the first screen someone sees already looks like Spectra.
 */
export function PublicFrame({
  children,
  width = "narrow",
  centered = false,
  className,
}: {
  children: ReactNode;
  width?: keyof typeof WIDTHS;
  /** Centre the page in the window, for short pages such as sign-in. */
  centered?: boolean;
  className?: string;
}) {
  return (
    <main
      className={cn(
        "spectra-wave-y relative isolate min-h-dvh bg-[var(--bg-primary)] px-4 py-8 text-[var(--text-primary)] sm:px-6",
        centered && "grid place-items-center",
      )}
    >
      <div className={cn("mx-auto w-full min-w-0", WIDTHS[width], className)}>
        <Link
          href="/"
          aria-label="Spectra home"
          className="mb-8 inline-flex items-center gap-2.5 rounded-control outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
        >
          <SpectraMark size={28} />
          <span className="font-display text-subhead font-semibold">Spectra</span>
        </Link>
        {children}
      </div>
    </main>
  );
}

/** A legal page: a title, a short lead, sections, and the related pages. */
export function LegalPage({
  title,
  lead,
  related,
  children,
}: {
  title: string;
  lead: string;
  related: Array<{ href: string; label: string }>;
  children: ReactNode;
}) {
  return (
    <PublicFrame width="reading">
      <article className="pb-16">
        <h1 className="font-display text-display font-semibold leading-tight tracking-[-0.03em]">{title}</h1>
        <p className="mt-3 text-ui leading-6 text-[var(--text-secondary)]">{lead}</p>
        <div className="mt-8 space-y-7">{children}</div>
        <p className="mt-10 border-t border-[var(--border-subtle)] pt-5 text-caption text-[var(--text-secondary)]">
          Related:{" "}
          {related.map((item, index) => (
            <span key={item.href}>
              {index > 0 ? (index === related.length - 1 ? " and " : ", ") : null}
              <Link className="text-[var(--text-primary)] underline underline-offset-2" href={item.href}>
                {item.label}
              </Link>
            </span>
          ))}
          .
        </p>
      </article>
    </PublicFrame>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-subhead font-semibold">{title}</h2>
      <div className="space-y-3 text-ui leading-6 text-[var(--text-secondary)]">{children}</div>
    </section>
  );
}
