"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SpectraMark } from "@/components/spectra-mark";
import { spectraBus } from "@/features/spectra/events";
import { ShowcaseProvider } from "@/features/spectra/showcase/showcase-provider";
import { LandingIsland, useLandingEngine } from "../kit/landing-island";
import { SidePanel } from "../kit/side-panel";
import { ThreadPane, type ShownThread } from "../kit/thread-pane";
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
 * The page is paper. Light lands on it where something happens, in the
 * colours of what is happening, and moves down the page with the story.
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
        <a
          href="#talk"
          className="landing-button"
          data-size="compact"
          data-tone="primary"
        >
          Talk to us
        </a>
      </nav>
    </header>
  );
}

function Story({ world }: { world: StoryWorld }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // A work opened anywhere on the page (a card, a citation, a run's result) opens beside it, as in Spectra.
  useEffect(
    () => spectraBus.handle("work.open", ({ workId }) => setOpenId(workId)),
    [],
  );
  const closeWork = useCallback(() => setOpenId(null), []);
  const works = useMemo(() => [...world.works.values()], [world]);
  const open = openId ? (world.works.get(openId) ?? null) : null;
  const engine = useLandingEngine(setOpenId);

  // The island waits until the hero has shown the page; then it stays, docked where it lives in Spectra.
  const [islandShown, setIslandShown] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setIslandShown(true), 900);
    return () => window.clearTimeout(timer);
  }, []);
  // Over the hero the island sits under Henry's window (see the stylesheet).
  const [overHero, setOverHero] = useState(true);
  useEffect(() => {
    const read = () => setOverHero(window.scrollY < window.innerHeight * 0.55);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);

  // A question someone asks (not a scene's own run) opens its thread beside the page, as Spectra's side does:
  // the page narrows to make room, so it covers nothing. As soon as the reader moves on to the next scene it
  // folds away again (the island keeps it as a tab), so no scene is ever shown narrowed.
  const [thread, setThread] = useState<ShownThread | null>(null);
  const openedAt = useRef(0);
  const show = useCallback((next: ShownThread) => {
    openedAt.current = window.scrollY;
    setThread(next);
  }, []);
  useEffect(
    () =>
      world.on((event) => {
        if (event.type === "run_started" && !event.quiet)
          show({
            runId: event.runId,
            threadId: event.threadId,
            title: event.reply.title,
          });
      }),
    [show, world],
  );
  const closeThread = useCallback(() => setThread(null), []);
  useEffect(() => {
    if (!thread) return;
    const read = () => {
      if (
        Math.abs(window.scrollY - openedAt.current) >
        window.innerHeight * 0.4
      )
        setThread(null);
    };
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, [thread]);
  const side = Boolean(open || thread);

  // The page makes room for the side instead of lying under it.
  useEffect(() => {
    const root = document.documentElement;
    if (thread && !open)
      root.style.setProperty("--spectra-side-width", "min(440px, 34vw)");
    else if (!open) root.style.removeProperty("--spectra-side-width");
  }, [open, thread]);

  return (
    <div className="sp-root" data-side={side ? "open" : undefined}>
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
      <div
        className="sp-island"
        data-shown={islandShown || undefined}
        data-over-hero={overHero || undefined}
      >
        <LandingIsland engine={engine} onOpenThread={show} />
      </div>
      {thread && !open ? (
        <aside className="landing-side sp-thread-side">
          <ThreadPane
            thread={thread}
            engine={engine}
            onOpenWork={setOpenId}
            onClose={closeThread}
          />
        </aside>
      ) : null}
      <SidePanel work={open} works={works} onClose={closeWork} />
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
