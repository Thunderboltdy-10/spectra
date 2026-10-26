"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SpectraMark } from "@/components/spectra-mark";
import { Backdrop } from "./backdrop";
import { Beam } from "./beam";
import { Chamber } from "./scenes/chamber";
import { Files } from "./scenes/files";
import { Finale } from "./scenes/finale";
import { Hero } from "./scenes/hero";
import { Morning } from "./scenes/morning";
import { Notebook } from "./scenes/notebook";
import { School } from "./scenes/school";
import { Together } from "./scenes/together";

/*
 * The Spectra page. One student's school life, shown on Spectra's own
 * surfaces, one moment at a time: the evening it all comes together, her
 * notes turned into revision, the morning letter, her exercise book, her
 * Word file, her group, and the day her school switched it on. A thread of
 * light from the prism runs through every scene and ends back in it.
 *
 * Every scene is a drawing made from the app's parts and a script written in
 * advance. Nothing here reads or writes anyone's data; the contact page is
 * the only place a visitor sends anything.
 */

export function Header() {
  const [away, setAway] = useState(false);
  useEffect(() => {
    const read = () => setAway(window.scrollY > 24);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);
  return (
    <header className="sp-header" data-away={away || undefined}>
      <Link href="/" className="sp-header-brand" aria-label="Spectra home">
        <SpectraMark size={22} />
        <span>Spectra</span>
      </Link>
      <nav className="sp-header-actions" aria-label="Account">
        <Link href="/sign-in" className="sp-header-link">
          Sign in
        </Link>
        <Link href="/contact" className="landing-button" data-size="compact" data-tone="primary">
          Talk to us
        </Link>
      </nav>
    </header>
  );
}

export function SpectraPage() {
  const mainRef = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // The beam is measured once the hero's arrival has settled.
    const timer = window.setTimeout(() => setReady(true), 400);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="sp-page">
      <Backdrop />
      <Header />
      <main ref={mainRef} className="sp-main">
        <Beam rootRef={mainRef} ready={ready} />
        <Hero />
        <Chamber />
        <Morning />
        <Notebook />
        <Files />
        <Together />
        <School />
        <Finale />
      </main>
    </div>
  );
}
