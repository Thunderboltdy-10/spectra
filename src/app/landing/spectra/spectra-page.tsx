"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SpectraMark } from "@/components/spectra-mark";
import { spectraBus } from "@/features/spectra/events";
import { ShowcaseProvider } from "@/features/spectra/showcase/showcase-provider";
import { LandingIsland, putIslandAway } from "../kit/landing-island";
import { SidePanel } from "../kit/side-panel";
import { WorldContext } from "../kit/world-context";
import { StoryWorld } from "../world/world";
import { LightField } from "./light/light-field";
import { Bridge } from "./scenes/bridge";
import { Ending } from "./scenes/ending";
import { Hero } from "./scenes/hero";
import { Make } from "./scenes/make";
import { Morning } from "./scenes/morning";
import { School } from "./scenes/school";
import { Together } from "./scenes/together";

/*
 * The Spectra page: one week of Henry's, a DP1 student, on Spectra itself.
 * Everything inside the scenes is the app's own components (Home, the brief,
 * the island, the editors, the presence layer) reading a story world held in
 * memory for this visit, so what you see is what a student sees, and what you
 * press answers the way Spectra does. Nothing reaches the network except the
 * walkthrough request at the end.
 *
 * The page is paper. Light lands on it as grain where something happens, in
 * the colours of what is happening, and moves down the page with the story.
 */

function Header() {
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
        <a href="#talk" className="landing-button" data-size="compact" data-tone="primary">
          Talk to us
        </a>
      </nav>
    </header>
  );
}

function Story({ world }: { world: StoryWorld }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // A work opened anywhere on the page (a card, a citation, a run's result) opens beside it, as in Spectra.
  useEffect(() => spectraBus.handle("work.open", ({ workId }) => setOpenId(workId)), []);
  const close = useCallback(() => setOpenId(null), []);
  const works = useMemo(() => [...world.works.values()], [world]);
  const open = openId ? (world.works.get(openId) ?? null) : null;

  // The island waits until the hero has shown the page; then it stays, docked where it lives in Spectra.
  const [islandShown, setIslandShown] = useState(false);
  const islandRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setIslandShown(true), 900);
    return () => window.clearTimeout(timer);
  }, []);
  // Over the hero the island sits under Henry's window (see the stylesheet).
  const [overHero, setOverHero] = useState(true);
  // An answer open over one scene is put away (to its tab on the rail) once the reader has moved on from it.
  const openedAt = useRef<number | null>(null);
  useEffect(
    () =>
      world.on((event) => {
        if (event.type === "run_started") openedAt.current = window.scrollY;
        // A scene's run shows its result in the scene itself; its card goes to the rail once it has said so.
        if (event.type === "run_finished" && window.scrollY > window.innerHeight * 0.55) window.setTimeout(putIslandAway, 1400);
      }),
    [world],
  );
  useEffect(() => {
    const read = () => {
      setOverHero(window.scrollY < window.innerHeight * 0.55);
      if (openedAt.current !== null && Math.abs(window.scrollY - openedAt.current) > window.innerHeight * 0.4) {
        openedAt.current = null;
        putIslandAway();
      }
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);

  return (
    <div className="sp-root" data-side={open ? "open" : undefined}>
      <LightField />
      <Header />
      <main className="sp-main">
        <Hero />
        <Make />
        <Morning />
        <Together />
        <Bridge />
        <School />
        <Ending />
      </main>
      <div ref={islandRef} className="sp-island" data-shown={islandShown || undefined} data-over-hero={overHero || undefined}>
        <LandingIsland onOpenWork={setOpenId} />
      </div>
      <SidePanel work={open} works={works} onClose={close} />
    </div>
  );
}

export function SpectraPage() {
  const [world] = useState(() => new StoryWorld());
  const showcase = useMemo(() => world.showcase(), [world]);
  return (
    <ShowcaseProvider world={showcase}>
      <WorldContext.Provider value={world}>
        <Story world={world} />
      </WorldContext.Provider>
    </ShowcaseProvider>
  );
}
