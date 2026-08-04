"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SpectraLogo } from "@/components/spectra-logo";
import { LandingNarrative } from "./sections/narrative";
import { CapabilitiesSection } from "./sections/capabilities";
import { AgentsSection } from "./sections/agents";
import { ProofSection } from "./sections/proof";
import { ContactSection } from "./sections/contact";
import { PricingSection } from "./pricing-section";

/**
 * Landing composition root (Phase 15). The page is one continuous narrative:
 * hero prism → scene track (fragments → transformation → live work →
 * convergence) → calm editorial proof → pilot conversation.
 *
 * All copy is honest: no fake provider carousels, no invented model counts,
 * no generic feature-card grid as the main story.
 */

const NAV_LINKS = [
  { href: "#scenes", label: "How it works" },
  { href: "#capabilities", label: "Capabilities" },
  { href: "#agents", label: "Specialists" },
  { href: "#proof", label: "For schools" },
  { href: "#pricing", label: "Pricing" },
] as const;

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-[70] transition-all duration-300 ${
        scrolled
          ? "border-b border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-primary)_86%,transparent)] backdrop-blur-xl"
          : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-[64px] max-w-7xl items-center justify-between px-6">
        <Link
          href="/"
          className="flex items-center gap-0"
          aria-label="Spectra home"
        >
          <SpectraLogo size={24} />
          <span className="ml-2 text-[17px] font-bold tracking-tight text-[var(--text-primary)]">
            Spectra
          </span>
        </Link>
        <nav
          className="hidden items-center gap-7 lg:flex"
          aria-label="Landing sections"
        >
          {NAV_LINKS.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              className="text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2.5">
          <Link
            href="/sign-in"
            className="rounded-lg px-4 py-2 text-[13px] font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-lg bg-[var(--brand-primary)] px-4 py-2 text-[13px] font-bold text-white shadow-[0_4px_14px_color-mix(in_oklab,var(--brand-primary)_24%,transparent)] transition-all hover:-translate-y-px hover:shadow-[0_8px_20px_color-mix(in_oklab,var(--brand-primary)_30%,transparent)]"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}

export function LandingClient() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const delay = parseInt(el.dataset.delay || "0", 10);
          window.setTimeout(() => el.classList.add("is-visible"), delay);
          observer.unobserve(el);
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <Navbar />
      <main>
        <LandingNarrative />
        <div id="capabilities">
          <CapabilitiesSection />
        </div>
        <div id="agents">
          <AgentsSection />
        </div>
        <div id="proof">
          <ProofSection />
        </div>

        {/* Pricing */}
        <section
          id="pricing"
          className="py-28"
          style={{ background: "var(--bg-secondary)" }}
        >
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-14 text-center" data-reveal>
              <h2 className="text-[clamp(1.9rem,4vw,2.75rem)] font-bold leading-[1.1] tracking-[-0.015em]">
                Simple,{" "}
                <span className="text-[var(--brand-primary)]">transparent</span>{" "}
                pricing
              </h2>
              <p className="mx-auto mt-4 max-w-md text-[15px] text-[var(--text-secondary)]">
                Schools set their own per-student budget. More budget means more
                AI capability for every student. No hidden fees.
              </p>
            </div>
            <div data-reveal>
              <PricingSection />
            </div>
          </div>
        </section>

        <ContactSection />

        {/* closing CTA */}
        <section
          className="relative overflow-hidden py-28"
          style={{ background: "var(--bg-primary)" }}
        >
          <div
            className="relative z-10 mx-auto max-w-2xl px-6 text-center"
            data-reveal
          >
            <h2 className="text-[clamp(1.9rem,4.5vw,3rem)] font-bold leading-[1.08] tracking-[-0.015em]">
              Give your students AI
              <br />
              <span className="text-[var(--brand-primary)]">
                that does the work with them.
              </span>
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-[16px] leading-relaxed text-[var(--text-secondary)]">
              Connected work. Cited sources. Real-time collaboration with people
              and AI, side by side.
            </p>
            <div className="mt-9 flex flex-col justify-center gap-3.5 sm:flex-row">
              <Link
                href="/sign-up"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-8 py-4 text-[15px] font-bold text-white shadow-[0_10px_28px_color-mix(in_oklab,var(--brand-primary)_26%,transparent)] transition-all hover:-translate-y-0.5"
              >
                Get started
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#contact"
                className="inline-flex items-center justify-center rounded-xl border border-[var(--border-default)] px-8 py-4 text-[15px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-secondary)]"
              >
                Talk to us
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer
        className="border-t border-[var(--border-default)] py-12"
        style={{ background: "var(--bg-primary)" }}
      >
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 md:flex-row">
          <div className="flex items-center">
            <SpectraLogo size={24} />
            <span className="ml-2 text-[16px] font-bold tracking-tight">
              Spectra
            </span>
          </div>
          <nav
            className="flex gap-7 text-micro font-bold uppercase tracking-widest text-[var(--text-tertiary)]"
            aria-label="Legal"
          >
            {["Privacy", "Terms", "Cookies"].map((label) => (
              <Link
                key={label}
                href={`/${label.toLowerCase()}`}
                className="transition-colors hover:text-[var(--text-primary)]"
              >
                {label}
              </Link>
            ))}
            <a
              href="#contact"
              className="transition-colors hover:text-[var(--text-primary)]"
            >
              Contact
            </a>
          </nav>
          <p className="text-micro text-[var(--text-tertiary)]">
            © {new Date().getFullYear()} Spectra
          </p>
        </div>
      </footer>
    </div>
  );
}
