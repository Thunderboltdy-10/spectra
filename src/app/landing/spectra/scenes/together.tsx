"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import { SpectraMark } from "@/components/spectra-mark";
import { presenceColor, type InteractionState } from "@/features/spectra/collaboration/interaction-model";
import type { CollaborationPresence } from "@/features/spectra/collaboration/types";
import { CollaborationPresenceIndicator } from "@/features/spectra/components/collaboration-presence";
import { InlineStudio } from "../../kit/inline-studio";
import { perform } from "../../kit/perform";
import { Surface, usePresence, type Move } from "../../kit/presence";
import { Written } from "../../kit/written";
import { CAST, type CastId } from "../../world/story";
import { WORKS } from "../../world/works";
import { dimAll, flash, shine, travel } from "../light/light";
import { useLoop, type Beat } from "../loop";

/*
 * Henry's revision slides in the real presentation studio, with the people
 * who work on them beside it. Everyone meets on the slide of the four stages.
 * His AI checks the yields and adds what the Krebs cycle is missing, with the
 * hand it has in the app: it takes the text box, finds its place and types.
 * Mr Okafor comes in from his class and leaves a note, and the AI does what it
 * asks. Maya marks the stage she is taking for their group's deck. Everyone is
 * drawn by Spectra's own presence layer and shown at the top of the studio, as
 * the product shows them. The heading says who is working now.
 */

const WHO = ["AI", "teacher", "friend"] as const;

type Person = { id: CastId; role: string; can: string; ai?: boolean };
const PEOPLE: Person[] = [
  { id: "henryAi", role: "Henry's AI", can: "Can edit", ai: true },
  { id: "henry", role: "Owner", can: "Owner" },
  { id: "okafor", role: "Biology SL teacher", can: "Can comment" },
  { id: "maya", role: "Friend, Biology SL", can: "Can edit" },
];

type Slide = Deck["slides"][number] & { objects: Array<{ id: string; content?: unknown; text?: unknown }> };

/** The deck with one text box saying something else, as the AI leaves it. */
function withText(deck: Deck, object: string, from: string, to: string): Deck {
  const swap = (value: unknown): unknown =>
    typeof value === "string" ? (value === from ? to : value) : Array.isArray(value) ? value.map(swap) : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, swap(entry)]))
      : value;
  return {
    ...deck,
    slides: deck.slides.map((slide) => ({
      ...slide,
      objects: (slide as Slide).objects.map((entry) => (entry.id === object ? (swap(entry) as typeof entry) : entry)),
    })),
  };
}

const NO_REGIONS: never[] = [];

const nameOf = (id: CastId) => (CAST[id].kind === "ai" ? "Spectra" : CAST[id].name);

type Deck = { slides: Array<{ id: string; objects: Array<{ id: string }> }> };
const SLIDES = (WORKS.deck.content as Deck).slides;
const STAGES = SLIDES.findIndex((slide) => slide.id === "s3");
/**
 * The deck opened on the four stages, where everyone works. Changing slides
 * rebuilds every text box on the slide, which is too heavy to do while the
 * page scrolls, so the scene never does.
 */
const OPENED = {
  ...WORKS.deck,
  _id: `${WORKS.deck._id}-together`,
  content: { ...(WORKS.deck.content as object), slides: [...SLIDES.slice(STAGES), ...SLIDES.slice(0, STAGES)] },
} as typeof WORKS.deck;
const DECK = OPENED.content as Deck;
/** What the AI adds, and what Mr Okafor asks it for. */
const KREBS = { from: "2 ATP, 6 NADH", to: "2 ATP, 6 NADH, 2 FADH2" };
const TOTAL = { from: "Four stages", to: "Four stages, 30 to 32 ATP" };
const CHECKED = withText(DECK, "s3-yield-2", KREBS.from, KREBS.to);
const ASKED = withText(CHECKED, "s3-title", TOTAL.from, TOTAL.to);

/** A slide object, as the presence layer addresses it: by the slide's place in the deck and the object's on the slide. */
const on = (slide: string, object: string): Move => {
  const at = DECK.slides.findIndex((entry) => entry.id === slide);
  const index = DECK.slides[at]?.objects.findIndex((entry) => entry.id === object) ?? -1;
  return { path: `/slides/${at}/objects/${index}`, primitive: "canvasObject", act: { kind: "focus" } };
};

export function Together() {
  const sceneRef = useRef<HTMLElement>(null);
  const deskRef = useRef<HTMLDivElement>(null);
  const studioRef = useRef<HTMLDivElement>(null);
  const presence = usePresence("together");
  const { move, put, leave } = presence;
  const [deck, setDeck] = useState(OPENED);
  const show = useCallback((content: unknown) => setDeck((was) => ({ ...was, content, updatedAt: was.updatedAt + 1 })), []);
  const [header, setHeader] = useState<Element | null>(null);
  /** Who is in the deck, as the studio's own header shows them. */
  const here = useMemo<CollaborationPresence[]>(
    () =>
      presence.states.map((state: InteractionState) => ({
        clientId: state.actor.clientId,
        accountId: state.actor.accountId,
        name: state.actor.name,
        actorKind: state.actor.kind,
        interactionState: state,
      })),
    [presence.states],
  );
  const [who, setWho] = useState(0);
  const [doing, setDoing] = useState<Partial<Record<CastId, string>>>({});

  const say = (id: CastId, what: string | null) =>
    setDoing((was) => {
      const next = { ...was };
      if (what) next[id] = what;
      else delete next[id];
      return next;
    });

  /** Points a collaborator at a slide object, with what they are saying there. */
  const point = useCallback(
    (id: CastId, slide: string, object: string, note?: string) => {
      move(id, { ...on(slide, object), note });
      const { path } = on(slide, object);
      // The slide on the stage, not its thumbnail in the list.
      const found = [...(studioRef.current?.querySelectorAll(`[data-spectra-target="${path}"]`) ?? [])];
      return found.at(-1) ?? studioRef.current;
    },
    [move],
  );

  const lightAt = (element: Element | null | undefined, hues: [number, number]) =>
    element && flash({ el: element, rx: 260, ry: 140, strength: 0.6, hues, hold: 420 });

  useEffect(() => {
    const desk = deskRef.current;
    if (!desk) return;
    shine("together-halo", { el: desk, halo: { radius: 18 }, rx: 120, ry: 90, strength: 0.7, hues: [0, 1.4], flow: 0.6, ease: 1400 });
    return () => dimAll("together");
  }, []);

  /** Writes a note a few letters at a time, as someone types it. */
  const typeNote = async (id: CastId, slide: string, object: string, note: string, { wait }: Beat) => {
    for (let length = 1; length < note.length; length += 2 + Math.round(Math.random())) {
      point(id, slide, object, note.slice(0, length));
      await wait(24);
    }
    point(id, slide, object, note);
  };

  useLoop(sceneRef, {
    open: async ({ wait }) => {
      const title = sceneRef.current?.querySelector(".sp-heading");
      const desk = deskRef.current;
      if (title && desk) {
        const box = title.getBoundingClientRect();
        travel("together-title", [box.left + box.width * 0.5, box.top + window.scrollY + box.height * 0.6], desk, {
          at: [0.4, 0.3],
          rx: 420,
          ry: 220,
          strength: 0.45,
          hues: [0, 1.6],
          flow: 0.5,
          ease: 500,
          ms: 1500,
        });
        window.setTimeout(() => dimAll("together-title", 1400), 1800);
      }
      await wait(300);
    },
    round: async (beat) => {
      const { wait, signal } = beat;
      for (let tries = 0; !studioRef.current?.querySelector('button[aria-label="Next slide"]') && tries < 50 && !signal.aborted; tries += 1) await wait(120);
      if (signal.aborted) return;
      // The studio's own place for the people in it, at the start of its header actions.
      setHeader(studioRef.current?.querySelector(".spectra-artifact-header-actions > span:first-child") ?? null);

      // Henry's AI checks the yields, and adds what the Krebs cycle makes.
      setWho(0);
      const hand = {
        surface: "together",
        show: (state: InteractionState | null) => put("henryAi", state),
        apply: show,
        wait,
        signal,
      };
      say("henryAi", "Checking the yields against your notes");
      lightAt(point("henryAi", "s3", "s3-yield-0", "2 ATP, matches"), [0.2, 1]);
      await wait(650);
      say("henryAi", "Adding the FADH2 the Krebs cycle makes");
      lightAt(point("henryAi", "s3", "s3-card-2"), [3.2, 4]);
      await perform(OPENED, DECK, CHECKED, CAST.henryAi, "together-krebs", hand);
      await wait(500);
      leave("henryAi");
      say("henryAi", null);
      if (signal.aborted) return;

      // Mr Okafor comes in from his class and leaves a note.
      setWho(1);
      say("okafor", "Reading the slide");
      lightAt(point("okafor", "s3", "s3-title", "Reading"), [2.6, 3.4]);
      await wait(350);
      say("okafor", "Writing to you");
      await typeNote("okafor", "s3", "s3-title", "Good. Add the total: 30 to 32 ATP per glucose.", beat);
      await wait(700);
      leave("okafor");
      say("okafor", null);
      if (signal.aborted) return;

      // The AI does what he asked, on the title.
      setWho(0);
      say("henryAi", "Adding the total to the title");
      await perform(OPENED, CHECKED, ASKED, CAST.henryAi, "together-total", hand);
      await wait(600);
      leave("henryAi");
      say("henryAi", null);
      if (signal.aborted) return;

      // Maya marks the stage she is taking for their group's deck.
      setWho(2);
      say("maya", "Looking at the four stages");
      lightAt(point("maya", "s3", "s3-card-0", "Looking at the stages"), [4.4, 5.2]);
      await wait(300);
      say("maya", "Adding it to the group deck");
      await typeNote("maya", "s3", "s3-card-0", "Taking this one for our group deck!", beat);
      await wait(900);
      leave("maya");
      say("maya", null);
      await wait(400);
      // The deck as it was, for the next round.
      show(DECK);
      await wait(200);
    },
  });

  return (
    <section ref={sceneRef} className="sp-scene sp-together" aria-labelledby="sp-together-title">
      <div className="sp-scene-copy" data-centred>
        <Written id="sp-together-title" className="sp-heading" text={"Work on it\nwith your {}."} flip={{ words: WHO, index: who }} />
        <p className="sp-lede">
          Spectra works on your slides the way a collaborator does, in front of you and with its own cursor. Your teacher and your
          friends can be in the same deck, and you see who is doing what.
        </p>
      </div>

      <div ref={deskRef} className="sp-together-desk">
        <Surface id="together" states={presence.states} className="sp-together-doc">
          <div ref={studioRef} className="sp-together-studio">
            <InlineStudio work={deck} instanceKey="landing-together-deck" className="sp-studio" />
          </div>
          {header ? createPortal(<CollaborationPresenceIndicator presence={here} currentClientId={CAST.henry.clientId} regions={NO_REGIONS} />, header) : null}
        </Surface>

        <aside className="sp-people" aria-label="People in this deck">
          <p className="sp-people-title">
            <Icon name="people" size={15} />
            In this deck
          </p>
          <ul>
            {PEOPLE.map((person) => {
              const now = doing[person.id];
              return (
                <li
                  key={person.id}
                  className="sp-person"
                  data-ai={person.ai || undefined}
                  data-active={Boolean(now) || undefined}
                  style={{ ["--person" as string]: presenceColor(CAST[person.id]) }}
                >
                  <span className="sp-person-mark" aria-hidden>
                    {person.ai ? <SpectraMark size={18} /> : <Icon name="pointer" size={14} />}
                  </span>
                  <span className="sp-person-text">
                    <strong>{person.ai ? "Spectra" : nameOf(person.id)}</strong>
                    <span key={now ?? person.role} className="sp-person-now">
                      {now ?? person.role}
                    </span>
                  </span>
                  <span className="sp-person-can">{person.can}</span>
                </li>
              );
            })}
          </ul>
          <p className="sp-people-note">Anyone you share with, and your AI, work live in the same deck.</p>
        </aside>
      </div>
    </section>
  );
}
