"use client";

/**
 * Scene 12 — what the page has been inside all along.
 *
 * This is the one moment the whole build has been for, and the reason it can
 * work is structural rather than theatrical: the landing has been clipped by a
 * box this entire time, and that box has simply been the whole viewport. In
 * this scene the box contracts into a panel. Because the canvas is centred
 * inside the box, narrowing the box *is* the page moving into place. Nothing is
 * swapped, nothing is screenshotted, and scrolling back up reverses it exactly.
 *
 * Two components live here:
 *
 *   `RevealShell` — the product furniture that resolves around the panel. It is
 *   a sibling of the channel, never its parent, so the canvas is never
 *   remounted. It reads the same `channelFor` the clip reads, which is why the
 *   sidebar edge and the panel edge cannot disagree.
 *
 *   `RevealScene` — the last region of the canvas itself: the closing line, the
 *   two things a visitor can do next, and the last thing the prism does.
 *
 * The authoring on the canvas is deliberately finished before the box starts to
 * contract. Watching a headline being written while it shrinks would read as an
 * effect; watching a finished page be carried into a panel reads as a fact.
 */

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { SpectraLogo } from "@/components/spectra-logo";
import { targetAttrs } from "@/features/spectra/collaboration/target-attributes";
import { InteractionLayer } from "@/features/spectra/components/presence/interaction-layer";
import { SceneRegion } from "../story/scene-region";
import { Authored } from "../story/authored";
import { Body, Chip, Headline, Marker, useDuring, useSceneT } from "../story/scene-kit";
import { onStoryFrame } from "../story/story-clock";
import { useStoryPresence } from "../story/use-story-states";
import { usePrismSlot } from "../prism/prism-slot";
import { SHELL, channelFor, shellFor } from "../story/timeline";
import { RUN_STEPS, WORK } from "../story/work";
import type { Beat } from "../story/beats";

export const REVEAL_BEATS: readonly Beat[] = [
  {
    actor: "spectra",
    from: 0.03,
    to: 0.09,
    path: "reveal/marker",
    primitive: "richtext",
    act: { kind: "type", text: "Made in Spectra" },
  },
  {
    actor: "spectra",
    from: 0.09,
    to: 0.16,
    path: "reveal/line-1",
    primitive: "richtext",
    act: { kind: "type", text: "This page is" },
  },
  {
    actor: "spectra",
    from: 0.16,
    to: 0.23,
    path: "reveal/line-2",
    primitive: "richtext",
    act: { kind: "type", text: "a piece of work." },
  },
  {
    actor: "pabloAi",
    from: 0.21,
    to: 0.31,
    path: "reveal/body",
    primitive: "richtext",
    act: {
      kind: "type",
      text: "Everything you scrolled through was built by the same collaboration you were watching, on the same surfaces you would use.",
    },
  },
  {
    actor: "pablo",
    from: 0.3,
    to: 0.39,
    path: "reveal/actions",
    primitive: "canvasObject",
    label: "Actions",
    act: { kind: "drag", to: "reveal/copy" },
    note: "Putting the door in",
  },
  {
    actor: "spectra",
    from: 0.36,
    to: 0.46,
    path: "reveal/close",
    primitive: "richtext",
    act: { kind: "type", text: "Now go and make yours." },
    linger: 0.04,
  },
];

/**
 * Stage J: Spectra leaves the panel and goes back to the conversation.
 *
 * Kept apart from `REVEAL_BEATS` because it is authored on a different surface.
 * The canvas presence layer resolves targets inside the canvas, and this one
 * lives in the shell — so mixing them would ask the layer to find a node that
 * is not in its surface.
 */
const THREAD_BEATS: readonly Beat[] = [
  {
    actor: "spectra",
    from: 0.68,
    to: 0.79,
    path: "shell/thread/reply",
    primitive: "richtext",
    act: { kind: "type", text: "The landing page is ready." },
    linger: 0.2,
  },
];

/* ------------------------------------------------------------------ *
 * The shell
 * ------------------------------------------------------------------ */

/** The seven places the real sidebar goes, in the real order. */
const DESTINATIONS = [
  "Chat",
  "Home",
  "Library",
  "Calendar",
  "Agents",
  "School",
  "Analytics",
] as const;

/** The other work this workspace has open around the landing panel. */
const TABS = [
  { title: WORK.title, active: false },
  { title: "Field plots", active: false },
  { title: "Spectra landing", active: true },
] as const;

/**
 * The product, resolving around the panel.
 *
 * Every piece of furniture reads its geometry from the same `channelFor` and
 * `shellFor` the clip uses, so the sidebar stops exactly where the panel starts
 * however the window is sized. `shell` is a separate curve from `open`, so the
 * chrome arrives after the panel has found its place rather than with it.
 */
export function RevealShell() {
  const hostRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const asideRef = useRef<HTMLElement>(null);

  /* Stage J. Spectra leaves the panel and writes in the thread, so it needs a
     presence layer anchored to the thread rather than to the canvas: a caret
     resolves against the surface it is inside. */
  const threadBeats = useMemo(() => ({ reveal: THREAD_BEATS }), []);
  const threadStates = useStoryPresence(threadBeats);

  /* The run finishes with the page. Once Spectra has said so in the thread, the
     active step stops being active: the dock's own grammar for a run that has
     landed is the completion colour, so that is what it gets. */
  const t = useSceneT("reveal");
  const settled = t >= 0.8;

  useEffect(() => {
    let present = "";
    return onStoryFrame((frame) => {
      const host = hostRef.current;
      if (!host) return;
      const box = channelFor(frame, frame.viewport);
      const here = box.shell > 0.001 ? "true" : "false";
      if (present !== here) {
        present = here;
        host.dataset.present = here;
      }
      if (box.shell <= 0.001) return;

      /* One number, four pieces of furniture. Each slides in from its own
         edge, so the room assembles rather than fading up. */
      const ease = 1 - (1 - box.shell) ** 3;
      const room = shellFor(frame.viewport);
      host.style.setProperty("--shell", ease.toFixed(4));

      const sidebar = sidebarRef.current;
      if (sidebar) {
        sidebar.style.width = `${room.sidebar}px`;
        sidebar.style.opacity = room.sidebar > 0 ? "1" : "0";
        sidebar.style.transform = `translate3d(${(
          -room.sidebar *
          (1 - ease)
        ).toFixed(1)}px, 0, 0)`;
      }
      const rail = railRef.current;
      if (rail) {
        rail.style.left = `${room.sidebar}px`;
        rail.style.height = `${SHELL.rail}px`;
        rail.style.transform = `translate3d(0, ${(
          -SHELL.rail *
          (1 - ease)
        ).toFixed(1)}px, 0)`;
      }
      const dock = dockRef.current;
      if (dock) {
        dock.style.left = `${room.sidebar}px`;
        dock.style.height = `${SHELL.dock}px`;
        dock.style.transform = `translate3d(0, ${(
          SHELL.dock *
          (1 - ease)
        ).toFixed(1)}px, 0)`;
      }

      /* The conversation, to the right of the panel. It starts where the panel
         ends, which is a number the panel itself already computed. */
      const aside = asideRef.current;
      if (aside) {
        const left = room.panelRight + SHELL.gap;
        const width = Math.max(
          0,
          frame.viewport.width - left - SHELL.gap,
        );
        aside.style.left = `${left.toFixed(1)}px`;
        aside.style.width = `${width.toFixed(1)}px`;
        aside.style.top = `${SHELL.rail + SHELL.gap}px`;
        aside.style.bottom = `${SHELL.dock + SHELL.gap}px`;
        aside.style.opacity = Math.max(0, (ease - 0.3) / 0.7).toFixed(3);
        /* Whether the thread is wide enough to be worth reading at all. Under
           a real minimum the product would collapse it, so this does too. */
        const shown = width >= 300 ? "true" : "false";
        if (aside.dataset.shown !== shown) aside.dataset.shown = shown;
      }
    });
  }, []);

  return (
    <div ref={hostRef} className="landing-shell" data-present="false">
      <nav ref={sidebarRef} className="landing-shell-sidebar" aria-hidden="true">
        <div className="landing-shell-brand">
          <SpectraLogo size={20} />
          <span>Spectra</span>
        </div>
        <ul className="landing-shell-nav">
          {DESTINATIONS.map((label) => (
            <li key={label} data-current={label === "Library" ? "true" : "false"}>
              <span className="landing-shell-glyph" />
              {label}
            </li>
          ))}
        </ul>
        <div className="landing-shell-foot">
          <span className="landing-shell-avatar">P</span>
          Pablo
        </div>
      </nav>

      <header ref={railRef} className="landing-shell-rail" aria-hidden="true">
        {TABS.map((tab) => (
          <span
            key={tab.title}
            className="landing-shell-tab"
            data-active={tab.active ? "true" : "false"}
          >
            {tab.title}
          </span>
        ))}
      </header>

      {/* Stage J. The thread the whole page started in, still open, with the
          last thing Spectra has to say about the work it just finished. */}
      <section
        ref={asideRef}
        className="landing-shell-aside"
        data-shown="false"
        aria-hidden="true"
        data-spectra-surface="spectra-landing-thread"
      >
        <InteractionLayer states={threadStates} anchor="static" />
        <div className="landing-shell-aside-head">
          <span>{WORK.title}</span>
          <span className="landing-shell-aside-meta">{WORK.subject}</span>
        </div>
        <div className="landing-shell-thread">
          <article className="landing-shell-message" data-actor="pablo">
            <span className="landing-shell-who">Pablo</span>
            <p>Turn these notes into a revision document for Friday.</p>
          </article>
          <article className="landing-shell-message" data-actor="spectra">
            <span className="landing-shell-who">Spectra</span>
            <p>
              Done, cited and scheduled. Three study blocks are in your week
              before Friday.
            </p>
          </article>
          <article className="landing-shell-message" data-actor="spectra">
            <span className="landing-shell-who">Spectra</span>
            <Authored
              beats={THREAD_BEATS}
              scene="reveal"
              path="shell/thread/reply"
              as="p"
            />
          </article>
        </div>
        <div className="landing-shell-composer">Ask anything</div>
      </section>

      <footer ref={dockRef} className="landing-shell-dock" aria-hidden="true">
        <span className="landing-shell-dock-label">Live Dock</span>
        <div className="landing-shell-dock-tabs">
          <span data-state={settled ? "done" : "working"}>
            {settled ? "Spectra landing, published" : RUN_STEPS.finishing}
          </span>
          <span data-state="done">{RUN_STEPS.scheduling}</span>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The last region of the canvas
 * ------------------------------------------------------------------ */

const REVEAL_POSE = [0.16, -0.5, 0.02] as const;

export function RevealScene() {
  const prismRef = useRef<HTMLDivElement>(null);
  const t = useSceneT("reveal");
  const holding = useDuring("reveal", 0, 0.3);
  const acted = t >= 0.3;

  /* The glass comes forward for the last time, in the hand rather than behind
     the work, and then goes quiet with the page. */
  usePrismSlot(prismRef, {
    fill: 0.9,
    lambda: 2.2,
    pose: REVEAL_POSE,
    poseWeight: 0.6,
    owned: holding,
    front: true,
    priority: 3,
  });

  return (
    <SceneRegion scene="reveal">
      <div className="flex h-full flex-col items-start justify-center gap-7 pb-10">
        <Marker beats={REVEAL_BEATS} scene="reveal" path="reveal/marker" />
        <Headline
          beats={REVEAL_BEATS}
          scene="reveal"
          size="section"
          accentLast
          paths={["reveal/line-1", "reveal/line-2"]}
        />
        <Body beats={REVEAL_BEATS} scene="reveal" path="reveal/body" />

        {/* The prism's last position on the canvas: beside the closing line,
            small, resolved. It has done its work. */}
        <div
          ref={prismRef}
          className="pointer-events-none absolute right-[10px] top-[96px] h-[280px] w-[280px]"
          {...targetAttrs("reveal/prism", undefined, "canvasObject")}
        />

        <div
          className="landing-doors"
          data-present={acted ? "true" : "false"}
          {...targetAttrs("reveal/actions", undefined, "surface")}
        >
          <Link
            href="/sign-up"
            className="landing-btn"
            data-tone="primary"
            {...targetAttrs("reveal/actions/start", undefined, "button")}
          >
            Get started
          </Link>
          <Link
            href="/sign-in"
            className="landing-btn"
            {...targetAttrs("reveal/actions/signin", undefined, "button")}
          >
            Sign in
          </Link>
          <Chip tone="mint" dot>
            Free for schools to try
          </Chip>
        </div>

        <div className="pt-4">
          <Body beats={REVEAL_BEATS} scene="reveal" path="reveal/close" />
        </div>
      </div>
    </SceneRegion>
  );
}
