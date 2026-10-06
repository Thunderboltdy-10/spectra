"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { outlineFigure, prismFigure, rowsFigure, type Figure } from "../figure";
import { figureOf } from "../figure-dom";
import { life, rectOf, type GlowHandle } from "../life";
import { drawPrism, PrismBody, PRISM_PALETTES, type PrismMode } from "../prism";
import { verdictAt } from "../use-life";
import { spectraBus } from "../../events";

/*
 * The life lab (/dev/life): every choreography of LIFE.md on the real field,
 * against a stand-in island and three cards. It is where a moment is tuned
 * before a page uses it, so each button plays exactly what the page will.
 */

const PRISM_SIZE = 34;
const CANVAS = 64;
const BARS = "b, [data-meta], [data-lines] div";
const YELLOW: [number, number, number] = [246, 190, 64];
const GREEN: [number, number, number] = [64, 196, 142];
const RED: [number, number, number] = [240, 84, 104];

type CardId = "a" | "b" | "c";
const CARDS: Record<CardId, { title: string; meta: string; lines: number[]; place: string }> = {
  a: { title: "Photosynthesis notes", meta: "Document, edited 2m ago", lines: [90, 70, 82], place: "left-[8%] top-[22%] h-[150px] w-[240px]" },
  b: { title: "Photosynthesis deck", meta: "Deck, 12 slides", lines: [88, 64, 76, 52], place: "left-[34%] top-[22%] h-[190px] w-[300px]" },
  c: { title: "Light reactions quiz", meta: "Quiz, 10 questions", lines: [80, 60, 72], place: "left-[64%] top-[22%] h-[150px] w-[240px]" },
};

function isDark() {
  return document.documentElement.classList.contains("dark");
}

export function LifeLab() {
  const prismRef = useRef<HTMLCanvasElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const questionRef = useRef<HTMLDivElement>(null);
  const cardRefs = { a: useRef<HTMLDivElement>(null), b: useRef<HTMLDivElement>(null), c: useRef<HTMLDivElement>(null) };
  const bodyRef = useRef<PrismBody | null>(null);
  const wakeRef = useRef<() => void>(() => {});
  const glowRef = useRef<GlowHandle | null>(null);
  const pointerRef = useRef<[number, number]>([0, 0]);
  const [shown, setShown] = useState({ prism: true, composer: false, question: false, a: true, b: true, c: false });
  const shownRef = useRef(shown);
  const show = (patch: Partial<typeof shown>) => {
    shownRef.current = { ...shownRef.current, ...patch };
    setShown(shownRef.current);
  };
  const [busy, setBusy] = useState("");

  // The island prism, stepped only while it moves.
  useEffect(() => {
    const canvas = prismRef.current;
    if (!canvas) return;
    const body = new PrismBody();
    bodyRef.current = body;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = CANVAS * ratio;
    canvas.height = CANVAS * ratio;
    let frame = 0;
    let last = 0;
    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const palette = PRISM_PALETTES[isDark() ? "dark" : "light"];
      drawPrism(ctx, body.pose(), { x: canvas.width / 2, y: canvas.height / 2, size: PRISM_SIZE * ratio, palette, pixelRatio: ratio, detail: "live" });
    };
    const tick = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      body.step(dt);
      draw();
      frame = body.isLively() ? requestAnimationFrame(tick) : 0;
      if (!frame) last = 0;
    };
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    wakeRef.current = wake;
    draw();
    wake();
    const track = (event: PointerEvent) => {
      pointerRef.current = [event.clientX, event.clientY];
    };
    window.addEventListener("pointerdown", track, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", track);
      glowRef.current?.stop();
      spectraBus.setQuery("prism.status", { status: null });
    };
  }, []);

  const body = () => bodyRef.current!;
  const setMode = (mode: PrismMode) => {
    body().setMode(mode);
    spectraBus.setQuery("prism.status", { status: mode === "rest" ? null : mode === "thinking" ? "working" : mode });
    wakeRef.current();
  };
  const prismCentre = (): [number, number] => {
    const r = rectOf(prismRef.current!);
    return [r.x + r.width / 2, r.y + r.height / 2];
  };
  const prismRect = () => {
    const [x, y] = prismCentre();
    return { x: x - PRISM_SIZE / 2, y: y - PRISM_SIZE / 2, width: PRISM_SIZE, height: PRISM_SIZE };
  };
  const prismFig = (): Figure => {
    const [x, y] = prismCentre();
    return prismFigure(body().pose(), { x, y, size: PRISM_SIZE, palette: PRISM_PALETTES[isDark() ? "dark" : "light"] });
  };
  const apex = (): [number, number] => {
    const [x, y] = prismCentre();
    return [x, y - PRISM_SIZE * 0.42];
  };
  const card = (id: CardId) => cardRefs[id].current!;
  const ink = (): [number, number, number] => (isDark() ? [243, 241, 236] : [20, 19, 24]);

  /** The prism takes something in: it parts, breathes out and comes back together, turning. */
  async function prismReceives() {
    const breath = life.breathe(prismFig(), 7);
    show({ prism: false });
    life.radiate(prismFig(), { colour: "spectrum", count: 16, reach: 26 });
    await breath.formed;
    show({ prism: true });
    body().spin(1);
    wakeRef.current();
  }

  const actions: Record<string, { label: string; group: string; run: () => Promise<void> | void }> = {
    open: {
      label: "Open composer",
      group: "Island",
      run: async () => {
        if (shownRef.current.composer) return;
        const morph = life.morph(prismFig(), figureOf(composerRef.current!));
        show({ prism: false });
        await morph.formed;
        show({ composer: true });
      },
    },
    close: {
      label: "Close composer",
      group: "Island",
      run: async () => {
        if (!shownRef.current.composer) return;
        const morph = life.morph(figureOf(composerRef.current!), prismFig());
        show({ composer: false });
        await morph.formed;
        show({ prism: true });
        body().spin(0.5);
        wakeRef.current();
      },
    },
    send: {
      label: "Send message",
      group: "Island",
      run: async () => {
        if (!shownRef.current.composer) return;
        const text = textRef.current!;
        const r = text.getBoundingClientRect();
        const words = { strokes: [{ points: [r.x + 3, r.y + r.height / 2, r.x + Math.min(r.width, 330), r.y + r.height / 2], closed: false, width: 5, colour: ink(), alpha: 0.22 }] };
        text.style.color = "transparent";
        const trip = life.travel(words, { absorb: prismRect() }, { colour: "spectrum" });
        await actions.close.run();
        await trip.arrived;
        text.style.color = "";
        setMode("working");
        await prismReceives();
      },
    },
    ask: {
      label: "Asks a question",
      group: "Spectra",
      run: async () => {
        setMode("needs");
        const breath = life.breathe(prismFig(), 5);
        show({ prism: false });
        const trip = life.travel(apex(), figureOf(questionRef.current!, { bars: "b, span" }), { colour: YELLOW });
        void breath.formed.then(() => show({ prism: true }));
        await trip.formed;
        show({ question: true });
      },
    },
    answer: {
      label: "Answer it",
      group: "Spectra",
      run: async () => {
        if (!shownRef.current.question) return;
        const trip = life.travel(figureOf(questionRef.current!, { bars: "b, span" }), { absorb: prismRect() }, { colour: "spectrum" });
        show({ question: false });
        await trip.arrived;
        body().markSeen();
        setMode("working");
        await prismReceives();
      },
    },
    create: {
      label: "Creates an artifact",
      group: "Spectra",
      run: async () => {
        show({ c: false });
        const breath = life.breathe(prismFig(), 5);
        show({ prism: false });
        void breath.formed.then(() => show({ prism: true }));
        const trip = life.travel(apex(), figureOf(card("c"), { bars: BARS }), { colour: "spectrum" });
        await trip.formed;
        show({ c: true });
        setMode("done");
        life.radiate(prismFig(), { colour: GREEN, count: 14, reach: 24 });
      },
    },
    done: {
      label: "Done",
      group: "Spectra",
      run: () => {
        setMode("done");
        life.radiate(prismFig(), { colour: GREEN, count: 14, reach: 24 });
      },
    },
    problem: {
      label: "Problem",
      group: "Spectra",
      run: () => {
        setMode("problem");
        life.radiate(prismFig(), { colour: RED, count: 8, reach: 14 });
      },
    },
    rest: {
      label: "Rest",
      group: "Spectra",
      run: () => {
        body().markSeen();
        setMode("rest");
      },
    },
    ghost: {
      label: "Load B",
      group: "Things",
      run: async () => {
        const ghost = life.ghost(figureOf(card("b"), { bars: BARS }));
        show({ b: false });
        await new Promise((resolve) => window.setTimeout(resolve, 2400));
        ghost.release();
        show({ b: true });
      },
    },
    delete: {
      label: "Delete A",
      group: "Things",
      run: async () => {
        if (!shownRef.current.a) return;
        const gone = life.unform(figureOf(card("a"), { bars: BARS }), { from: pointerRef.current });
        show({ a: false });
        await gone;
      },
    },
    restore: {
      label: "New A",
      group: "Things",
      run: async () => {
        if (shownRef.current.a) return;
        const r = card("a").getBoundingClientRect();
        const made = life.form(figureOf(card("a"), { bars: BARS }), { from: [r.x + 20, r.y + 20], colour: ink() });
        await made.formed;
        show({ a: true });
      },
    },
    move: {
      label: "Add A to B",
      group: "Things",
      run: async () => {
        await life.send(rectOf(card("a")), rectOf(card("b")), { colour: "spectrum", absorb: true });
        const r = rectOf(card("b"));
        life.pulse(r.x + r.width / 2, r.y + r.height / 2, 0.8, "spectrum");
      },
    },
    make: {
      label: "Make C by hand",
      group: "Things",
      run: async () => {
        // beginCreation(): dots gather where the user asked into a small work's outline, breathing, until it exists.
        show({ c: false });
        const [x, y] = pointerRef.current;
        const seedRect = { x: x - 64, y: y - 44, width: 128, height: 88 };
        const outline = outlineFigure(seedRect, { radius: 12 });
        const seed = life.ghost({ strokes: [...outline.strokes, ...rowsFigure(seedRect, [0.62, 0.86, 0.48]).strokes] }, { from: [x, y] });
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        // land(): what it becomes grows out of them.
        await life.morph(seed, figureOf(card("c"), { bars: BARS })).formed;
        show({ c: true });
      },
    },
    launch: {
      label: "Open C from B",
      group: "Things",
      run: async () => {
        // A card, a rail item or a pinned work: what opens (a surface, a page's header) grows out of it.
        if (!shownRef.current.c) return;
        show({ c: false });
        await life.morph(figureOf(card("b"), { bars: BARS }), figureOf(card("c"), { bars: BARS })).formed;
        show({ c: true });
      },
    },
    right: {
      label: "Right on A",
      group: "Verdicts",
      run: () => verdictAt(card("a"), "right"),
    },
    wrong: {
      label: "Wrong on A",
      group: "Verdicts",
      run: () => verdictAt(card("a"), "wrong"),
    },
    reviewed: {
      label: "Open answer on A",
      group: "Verdicts",
      run: () => verdictAt(card("a"), "open"),
    },
    glow: {
      label: "Glow B",
      group: "Things",
      run: () => {
        if (glowRef.current) {
          glowRef.current.stop();
          glowRef.current = null;
          return;
        }
        glowRef.current = life.glow(rectOf(card("b")), "spectrum");
      },
    },
  };

  const play = (name: string) => {
    setBusy(name);
    void Promise.resolve(actions[name].run()).finally(() => setBusy((current) => (current === name ? "" : current)));
  };

  const groups = [...new Set(Object.values(actions).map((action) => action.group))];
  const fade = (on: boolean) => (on ? "opacity-100" : "pointer-events-none opacity-0");

  return (
    <main className="relative h-dvh overflow-hidden text-[var(--text-primary)]">
      <div className="fixed inset-x-3 top-3 z-toast flex flex-wrap items-center gap-1.5 text-caption">
        {groups.map((group) => (
          <Group key={group} label={group}>
            {Object.entries(actions)
              .filter(([, action]) => action.group === group)
              .map(([name, action]) => (
                <button
                  key={name}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    play(name);
                  }}
                  className={`rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-1 transition hover:border-[var(--border-strong)] ${busy === name ? "text-[var(--brand-primary)]" : ""}`}
                >
                  {action.label}
                </button>
              ))}
          </Group>
        ))}
      </div>

      {(Object.keys(CARDS) as CardId[]).map((id) => (
        <div
          key={id}
          ref={cardRefs[id]}
          className={`absolute box-border rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3.5 transition-opacity duration-150 ${CARDS[id].place} ${fade(shown[id])}`}
        >
          <b className="font-semibold">{CARDS[id].title}</b>
          <div data-meta className="text-caption text-[var(--text-secondary)]">
            {CARDS[id].meta}
          </div>
          <div data-lines>
            {CARDS[id].lines.map((width, index) => (
              <div key={index} className="my-2 h-1.5 rounded-full bg-[var(--text-primary)] opacity-[0.09]" style={{ width: `${width}%` }} />
            ))}
          </div>
        </div>
      ))}

      <div className="fixed inset-x-0 bottom-0 z-chrome h-[120px]" onPointerEnter={() => play("open")} />
      <div className="fixed bottom-5 left-1/2 z-panel -translate-x-1/2">
        <canvas
          ref={prismRef}
          aria-label="Spectra"
          className={`block size-16 cursor-pointer transition-opacity duration-150 ${shown.prism ? "opacity-100" : "opacity-0"}`}
          onPointerEnter={() => {
            body().hover(true);
            wakeRef.current();
          }}
          onPointerLeave={() => {
            body().hover(false);
            wakeRef.current();
          }}
          onPointerDown={() => {
            body().press();
            wakeRef.current();
          }}
          onPointerUp={() => {
            body().release();
            wakeRef.current();
          }}
        />
      </div>
      <div
        ref={composerRef}
        className={`fixed bottom-[22px] left-1/2 z-composer-dock box-border flex h-[58px] w-[560px] -translate-x-1/2 items-center gap-2.5 rounded-surface border border-[var(--border-default)] bg-[var(--bg-elevated)] pl-[18px] pr-2.5 transition-opacity duration-150 ${fade(shown.composer)}`}
        onPointerLeave={(event) => {
          if ((event.relatedTarget as Element | null)?.closest?.("[data-lab-island]")) return;
          window.setTimeout(() => {
            if (!composerRef.current?.matches(":hover")) play("close");
          }, 500);
        }}
        data-lab-island
      >
        <input ref={textRef} defaultValue="Make a quiz on the light reactions for Year 10" className="min-w-0 flex-1 bg-transparent outline-none" aria-label="Message" />
        <span className="size-[34px] rounded-xl bg-[var(--text-primary)] opacity-90" />
      </div>
      <div
        ref={questionRef}
        className={`fixed bottom-24 left-1/2 z-composer-dock box-border h-28 w-[400px] -translate-x-1/2 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3.5 transition-opacity duration-150 ${fade(shown.question)}`}
      >
        <b className="font-semibold">Which year group is this for?</b>
        <div className="mt-2.5 flex gap-1.5 text-caption">
          {["Year 10", "Year 11", "Other"].map((option) => (
            <span key={option} className="rounded-chip border border-[var(--border-default)] px-2 py-0.5">
              {option}
            </span>
          ))}
        </div>
      </div>
    </main>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="ml-2 font-medium text-[var(--text-tertiary)] first:ml-0">{label}</span>
      {children}
    </>
  );
}
