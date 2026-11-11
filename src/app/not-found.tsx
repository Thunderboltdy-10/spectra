import Link from "next/link";
import { Icon } from "@/components/icons";
import { PublicFrame } from "@/components/public-frame";
import { Button } from "@/components/ui/button";

/** A wrong or old address: say so, and offer the two ways back. */
export default function NotFound() {
  return (
    <PublicFrame centered>
      <section className="flex flex-col items-center px-2 py-10 text-center">
        <span aria-hidden className="grid size-10 place-items-center text-[var(--text-tertiary)]" data-icon-host>
          <Icon name="search" size={24} />
        </span>
        <h1 className="mt-2 font-display text-title font-semibold">This page isn&rsquo;t here</h1>
        <p className="mt-1 max-w-sm text-caption leading-5 text-[var(--text-secondary)]">
          The link may be old, or the page may have moved. Your artifacts are still where you left them.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button asChild variant="primary">
            <Link href="/workspace">Go to your workspace</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/">Spectra home</Link>
          </Button>
        </div>
      </section>
    </PublicFrame>
  );
}
