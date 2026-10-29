"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { SpectraMark } from "@/components/spectra-mark";
import { ShowcaseProvider } from "@/features/spectra/showcase/showcase-provider";
import { LaterScene, later, useWarm } from "../kit/later";
import { WorldContext } from "../kit/world-context";
import { StoryWorld } from "../world/world";
import { LightField } from "./light/light-field";
import { useStill } from "./window";
import { Ending } from "./scenes/ending";
import { Hero } from "./scenes/hero";

/*
 * The Spectra page: a week of Henry's, a DP1 student, and of Ms Gonzalez, his
 * History teacher, on Spectra itself. Everything inside the scenes is the
 * app's own components (Home, the week, the editors, the island, the presence
 * layer) reading a story world held in memory for this visit, so what you see
 * is what they see. Nothing reaches the network except the request at the end.
 *
 * The page is paper, and it never holds the scroll. Each scene opens once as
 * it comes into view, then plays its small story round and round while it is
 * there. Light lands where something happens, in the colours of what is
 * happening, and rests behind whatever the scene is about.
 */

/* Everything below the hero, in the order the page tells it; each comes as the reader nears it. */
const SCENES = [
  later(() => import("./scenes/classes").then((module) => ({ default: module.Classes })), 1100),
  later(() => import("./scenes/ask").then((module) => ({ default: module.Ask })), 1200),
  later(() => import("./scenes/artifacts").then((module) => ({ default: module.Artifacts })), 1200),
  later(() => import("./scenes/together").then((module) => ({ default: module.Together })), 1100),
  later(() => import("./scenes/week").then((module) => ({ default: module.Week })), 1100),
  later(() => import("./scenes/day").then((module) => ({ default: module.Day })), 900),
  later(() => import("./scenes/bridge").then((module) => ({ default: module.Bridge })), 1100),
  later(() => import("./scenes/agents").then((module) => ({ default: module.Agents })), 1100),
];

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
          Bring Spectra to your school
        </a>
      </nav>
    </header>
  );
}

export function SpectraPage() {
  const [world] = useState(() => new StoryWorld());
  const showcase = useMemo(() => world.showcase(), [world]);
  const mainRef = useRef<HTMLElement>(null);
  useWarm(SCENES);
  // Nothing in the page's pictures of the app scrolls on its own; a wheel anywhere scrolls the page.
  useStill(mainRef);
  return (
    <ShowcaseProvider world={showcase}>
      <WorldContext.Provider value={world}>
        <div className="sp-root">
          <LightField />
          <Header />
          <main ref={mainRef} className="sp-main">
            <Hero />
            {SCENES.map((scene, index) => (
              <LaterScene key={index} scene={scene} />
            ))}
            <Ending />
          </main>
        </div>
      </WorldContext.Provider>
    </ShowcaseProvider>
  );
}
