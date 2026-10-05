"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "@/components/icons";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { postSpectra } from "../data/api";
import { spectraBus } from "../events";
import type { Figure, Point } from "../life/figure";
import { figureOf } from "../life/figure-dom";
import { life, type Formed } from "../life/life";
import type { PrismMode, PrismStatus } from "../life/prism";
import { STATUS_COLOURS } from "../life/prism";
import { unformElement } from "../life/use-life";
import { registerComposerBand } from "../components/composer-safe-area";
import { useSpectraMotion } from "../motion";
import { useSpectraPreferences } from "../settings/preference-store";
import { IslandComposer, type ComposerHandle, type ComposerSend } from "./composer";
import { useIslandEngine } from "./engine";
import { arrangeTabs, islandStatus, tabTitle, type IslandSide, type IslandTab } from "./island-model";
import { useIslandPrism } from "./island-prism";
import { QuestionCard } from "./question-card";
import { answerQuestion, pendingQuestions, type QuestionAnswer } from "./questions";
import { refreshRunTabs, useRunTabs } from "./run-tabs";
import { settleFirstVisit, useSeenRuns } from "./seen";
import { ThreadView } from "./thread-view";

/*
 * The island (docs/design/ISLAND.md): where the user talks to Spectra, on
 * every page. At rest it is the prism; the pointer reaching for it turns the
 * prism into the pill of threads around the +; the + opens the composer.
 * Every change of shape is the field's matter rearranging: the shape the
 * user leaves parts into dots that travel and fuse into the next one.
 */

type Shape = "prism" | "pill" | "composer";

const OPEN_DELAY = 110;
const CLOSE_DELAY = 450;
const VIEW_DELAY = 250;
const NOTICE_MS = 4800;
const MORPH_TIMEOUT = 1400;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const within = (promise: Promise<unknown>, ms: number) => Promise.race([promise, new Promise((resolve) => window.setTimeout(resolve, ms))]);

const MODE_FOR_STATUS: Record<PrismStatus, PrismMode> = {
  working: "working",
  needs: "needs",
  warning: "needs",
  done: "done",
  problem: "problem",
  info: "rest",
  offline: "rest",
};

function isEditable(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element?.closest) return false;
  if (element.closest("[data-island]")) return false;
  return Boolean(element.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}

function menuOpen() {
  return Boolean(document.querySelector("[role='menu'][data-state='open'], [role='listbox'][data-state='open']"));
}

export function Island() {
  const slot = useIslandEngine();
  const engine = slot?.engine ?? null;
  const { preferences } = useSpectraPreferences();
  const motion = useSpectraMotion();
  const prism = useIslandPrism({ still: motion.reduced });
  const prismRef = useRef(prism);
  prismRef.current = prism;

  const live = engine?.liveExchange ?? null;
  const demand = live && (live.status === "starting" || live.status === "streaming") ? `island:${live.runId ?? live.threadId ?? "new"}:${live.status}` : null;
  const tabs = useRunTabs({ demand });
  const [seen, markSeen] = useSeenRuns();

  const [hidden, setHidden] = useState(false);
  const restShape: Shape | null = hidden ? null : slot?.restAsComposer ? "composer" : preferences.ai.islandWake === "edge" ? null : "prism";
  const restRef = useRef(restShape);
  restRef.current = restShape;

  const [target, setTarget] = useState<Shape | null>(restShape);
  const [shown, setShown] = useState<Shape | null>(restShape);
  const targetRef = useRef(target);
  const shownRef = useRef(shown);
  const generation = useRef(0);
  const inflight = useRef<Formed | null>(null);
  const [breathing, setBreathing] = useState(false);
  const [faded, setFaded] = useState(false);

  const pillRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const questionRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const openTimer = useRef(0);
  const closeTimer = useRef(0);
  const viewTimer = useRef(0);
  const pointerInside = useRef(false);

  // Sides hold still while the user is looking at the pill.
  const held = useRef<Map<string, IslandSide> | null>(null);
  // `held` is a ref; a change of shape is what takes or releases it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { play, done } = useMemo(() => arrangeTabs(tabs, { seen, held: held.current ?? undefined }), [tabs, seen, target]);
  const allTabs = useMemo(() => [...play, ...done], [play, done]);
  const arrangedRef = useRef(allTabs);
  arrangedRef.current = allTabs;

  // A first visit treats what already finished as seen.
  useEffect(() => {
    if (!tabs.length) return;
    settleFirstVisit(tabs.filter((tab) => !["queued", "running", "awaiting_confirmation", "awaiting_resolution"].includes(tab.run.status)).map((tab) => tab.runId));
  }, [tabs]);

  // A thread the page has open is seen.
  const focusThread = slot?.focus?.threadId ?? null;
  useEffect(() => {
    if (!focusThread) return;
    for (const tab of allTabs) if (tab.threadId === focusThread && !tab.seen && tab.status !== "working") markSeen(tab.runId);
  }, [allTabs, focusThread, markSeen]);

  /* ------------------------------------------------------------ shapes */

  const show = useCallback((next: Shape | null) => {
    shownRef.current = next;
    setShown(next);
  }, []);

  const figureFor = useCallback((shape: Shape | null): Figure | null => {
    if (shape === "prism") return prismRef.current.figure();
    if (shape === "pill") return pillRef.current ? figureOf(pillRef.current, { bars: "[data-tab-title], [data-plus]" }) : null;
    if (shape === "composer") {
      const element = composerRef.current?.element();
      return element ? figureOf(element, { bars: "[data-agent-switch], [data-composer-thread]" }) : null;
    }
    return null;
  }, []);

  const go = useCallback(
    async (next: Shape | null) => {
      if (next === targetRef.current) return;
      const from = targetRef.current;
      targetRef.current = next;
      if (next === "pill" && !held.current) held.current = new Map(arrangedRef.current.map((tab) => [tab.runId, tab.side]));
      if (next === restRef.current) held.current = null;
      setTarget(next);
      const gen = ++generation.current;
      // Let the next shape lay out at its real size before it is measured.
      await nextFrame();
      if (gen !== generation.current) return;
      const source = inflight.current ?? figureFor(shownRef.current);
      const destination = figureFor(next);
      if (!life.on || (!source && !destination)) {
        show(next);
        if (next === "composer") composerRef.current?.focus();
        return;
      }
      show(null);
      let settled: Promise<unknown>;
      if (source && destination) {
        const morph = life.morph(source, destination);
        inflight.current = morph;
        settled = morph.formed;
      } else if (destination) {
        const rise: Point = [window.innerWidth / 2, window.innerHeight - 6];
        const formed = life.form(destination, { from: rise });
        inflight.current = formed;
        settled = formed.formed;
      } else {
        inflight.current = null;
        settled = life.unform(source!);
      }
      if (next === "composer") composerRef.current?.focus();
      await within(settled, MORPH_TIMEOUT);
      if (gen !== generation.current) return;
      inflight.current = null;
      show(next);
      if (next === "prism" && from !== "prism") prismRef.current.spin(0.5);
    },
    [figureFor, show],
  );

  // The resting shape follows the page and the settings.
  useEffect(() => {
    if (targetRef.current === "pill" || (targetRef.current === "composer" && restShape !== "composer")) return;
    void go(restShape);
  }, [go, restShape]);

  /** The prism takes something in: it parts, breathes out and comes back together, turning. */
  const receive = useCallback(async () => {
    const p = prismRef.current;
    if (!life.on || shownRef.current !== "prism") {
      p.spin(1);
      return;
    }
    const breath = life.breathe(p.figure(), 7);
    setBreathing(true);
    life.radiate(p.figure(), { colour: "spectrum", count: 16, reach: 26 });
    await within(breath.formed, 1200);
    setBreathing(false);
    p.spin(1);
  }, []);

  // Pages keep their last lines clear of the island's resting row.
  useEffect(() => {
    const band = bandRef.current;
    if (!band) return;
    return registerComposerBand(band);
  }, []);

  /* ------------------------------------------------------------ status */

  const questionsAll = useMemo(() => pendingQuestions(engine, tabs), [engine, tabs]);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const questions = useMemo(() => questionsAll.filter((question) => !answered.has(question.key)), [answered, questionsAll]);

  const status: PrismStatus | null = useMemo(() => {
    if (questions.length || live?.status === "waiting") return "needs";
    const fromTabs = islandStatus(allTabs);
    if (fromTabs === "problem") return fromTabs;
    if (live && (live.status === "starting" || live.status === "streaming")) return "working";
    if (live?.status === "failed") return "problem";
    return fromTabs;
  }, [allTabs, live, questions.length]);

  useEffect(() => {
    const p = prismRef.current;
    p.setMode(status ? MODE_FOR_STATUS[status] : "rest");
    p.setStatus(status);
    spectraBus.setQuery("prism.status", { status });
  }, [status]);
  useEffect(() => () => spectraBus.setQuery("prism.status", { status: null }), []);

  const workingCount = allTabs.filter((tab) => tab.status === "working").length;

  /* ------------------------------------------------------------ notices */

  const [notice, setNotice] = useState<{ runId: string; text: string; tone: "done" | "problem" } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const lastStates = useRef(new Map<string, string>());
  useEffect(() => {
    const previous = lastStates.current;
    const next = new Map<string, string>();
    for (const tab of allTabs) {
      next.set(tab.runId, tab.state);
      const before = previous.get(tab.runId);
      if (!before || before === tab.state || tab.seen) continue;
      const wasMoving = ["working", "waiting", "completing", "reconnecting", "needs_input"].includes(before);
      if (!wasMoving) continue;
      if (tab.state === "completed" || tab.state === "completed_limited") {
        setNotice({ runId: tab.runId, text: `${tab.title} is ready`, tone: "done" });
        setAnnouncement(`${tab.title} is ready.`);
        if (life.on) life.radiate(prismRef.current.figure(), { colour: STATUS_COLOURS.done, count: 14, reach: 24 });
      } else if (tab.state === "failed_terminal" || tab.state === "paused") {
        setNotice({ runId: tab.runId, text: `${tab.title} stopped with a problem`, tone: "problem" });
        setAnnouncement(`${tab.title} stopped with a problem.`);
        if (life.on) life.radiate(prismRef.current.figure(), { colour: STATUS_COLOURS.problem, count: 8, reach: 14 });
      }
    }
    lastStates.current = next;
  }, [allTabs]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /* ------------------------------------------------------------ questions */

  const [questionIndex, setQuestionIndex] = useState(0);
  const question = questions.length ? questions[Math.min(questionIndex, questions.length - 1)] : null;
  const [questionShown, setQuestionShown] = useState(false);
  const formedQuestions = useRef(new Set<string>());

  useEffect(() => {
    if (!question) {
      setQuestionShown(false);
      return;
    }
    if (formedQuestions.current.has(question.key)) {
      setQuestionShown(true);
      return;
    }
    formedQuestions.current.add(question.key);
    setAnnouncement(question.kind === "approval" ? "Spectra needs your OK." : "Spectra has a question.");
    // A question wakes a hidden island.
    if (!restRef.current && !targetRef.current) setHidden(false);
    let live = true;
    void (async () => {
      setQuestionShown(false);
      await nextFrame();
      const card = questionRef.current;
      if (!live || !card) return;
      if (!life.on) {
        setQuestionShown(true);
        return;
      }
      const p = prismRef.current;
      const fromPrism = shownRef.current === "prism";
      if (fromPrism) {
        const breath = life.breathe(p.figure(), 5);
        setBreathing(true);
        void within(breath.formed, 1200).then(() => setBreathing(false));
      }
      const start: Point = fromPrism ? p.apex() : [window.innerWidth / 2, window.innerHeight - 40];
      const trip = life.travel(start, figureOf(card, { bars: "[data-question-text]" }), { colour: STATUS_COLOURS.needs });
      await within(trip.formed, 1800);
      if (live) setQuestionShown(true);
    })();
    return () => {
      live = false;
    };
  }, [question]);

  const answer = useCallback(
    async (value: QuestionAnswer) => {
      if (!engine || !question) return false;
      const accepted = await answerQuestion(engine, question, value, tabs);
      if (!accepted) return false;
      markSeen(question.runId);
      setAnswered((current) => new Set(current).add(question.key));
      const card = questionRef.current;
      if (life.on && card) {
        const trip = life.travel(figureOf(card, { bars: "[data-question-text]" }), { absorb: prismRef.current.rect() }, { colour: "spectrum" });
        setQuestionShown(false);
        await within(trip.arrived, 1600);
        void receive();
      } else {
        setQuestionShown(false);
      }
      return true;
    },
    [engine, markSeen, question, receive, tabs],
  );

  /* ------------------------------------------------------------ thread view */

  const [view, setView] = useState<{ runId: string; pinned: boolean } | null>(null);
  const [viewShown, setViewShown] = useState(false);
  const viewTab = view ? allTabs.find((tab) => tab.runId === view.runId) ?? null : null;
  const viewOpen = Boolean(viewTab);

  useEffect(() => {
    if (!viewOpen) {
      setViewShown(false);
      return;
    }
    if (viewShown) return;
    let live = true;
    void (async () => {
      await nextFrame();
      const card = viewRef.current;
      const tab = view ? tabRefs.current.get(view.runId) : null;
      if (!live || !card) return;
      if (!life.on) {
        setViewShown(true);
        return;
      }
      const r = tab?.getBoundingClientRect();
      const from: Point = r ? [r.x + r.width / 2, r.y] : [window.innerWidth / 2, window.innerHeight - 60];
      const formed = life.form(figureOf(card, { bars: "[data-thread-title], [data-thread-caption]" }), { from });
      await within(formed.formed, 1000);
      if (live) setViewShown(true);
    })();
    return () => {
      live = false;
    };
    // Forms once per opening; switching tabs slides the open card instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewOpen]);

  const closeView = useCallback(async () => {
    const card = viewRef.current;
    if (card && life.on && viewShown) {
      setViewShown(false);
      void unformElement(card, { bars: "[data-thread-title], [data-thread-caption]" });
    }
    setView(null);
  }, [viewShown]);

  const openView = useCallback(
    (runId: string, pinned: boolean) => {
      window.clearTimeout(viewTimer.current);
      setView((current) => (current?.pinned && !pinned && current.runId !== runId ? current : { runId, pinned: pinned || Boolean(current?.pinned && current.runId === runId) }));
      markSeen(runId);
    },
    [markSeen],
  );

  const viewOffset = useMemo(() => {
    if (!viewTab) return 0;
    const element = tabRefs.current.get(viewTab.runId);
    if (!element || typeof window === "undefined") return 0;
    const r = element.getBoundingClientRect();
    const half = Math.min(300, (window.innerWidth - 32) / 2);
    const limit = Math.max(0, window.innerWidth / 2 - half - 16);
    return Math.max(-limit, Math.min(limit, r.x + r.width / 2 - window.innerWidth / 2));
    // Measured when the card moves to another tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewTab?.runId, shown]);

  const openThread = useCallback(
    (runId: string, threadId: string, title: string) => {
      markSeen(runId);
      if (slot?.openThread) slot.openThread(runId, threadId, title);
      else void spectraBus.command("run.openConversation", { runId, threadId });
    },
    [markSeen, slot],
  );

  const dismiss = useCallback(
    async (runId: string) => {
      const element = tabRefs.current.get(runId);
      if (element) void unformElement(element, { bars: "[data-tab-title]" });
      if (view?.runId === runId) void closeView();
      markSeen(runId);
      await postSpectra({ action: "hideRunTab", runId }).catch(() => undefined);
      await refreshRunTabs(true);
    },
    [closeView, markSeen, view?.runId],
  );

  /* ------------------------------------------------------------ hover */

  const scheduleClose = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(function close() {
      if (pointerInside.current) return;
      if (menuOpen()) {
        closeTimer.current = window.setTimeout(close, CLOSE_DELAY);
        return;
      }
      if (view?.pinned) return;
      const composer = composerRef.current;
      const composing = targetRef.current === "composer" && (composer?.hasContent() || composer?.element()?.contains(document.activeElement));
      if (composing) return;
      setView(null);
      void go(restRef.current);
    }, CLOSE_DELAY);
  }, [go, view?.pinned]);

  const onEnter = () => {
    pointerInside.current = true;
    setFaded(false);
    window.clearTimeout(closeTimer.current);
    if (targetRef.current === restRef.current && restRef.current !== "composer") {
      window.clearTimeout(openTimer.current);
      openTimer.current = window.setTimeout(() => {
        if (pointerInside.current) void go("pill");
      }, OPEN_DELAY);
    }
  };
  const onLeave = () => {
    pointerInside.current = false;
    window.clearTimeout(openTimer.current);
    window.clearTimeout(viewTimer.current);
    scheduleClose();
  };

  /* ------------------------------------------------------------ sending */

  const send = useCallback(
    (message: ComposerSend) => {
      if (!engine) return;
      const p = prismRef.current;
      if (life.on && message.wordsRect) {
        const r = message.wordsRect;
        const lines = Math.min(4, message.lineCount);
        const ink: [number, number, number] = document.documentElement.classList.contains("dark") ? [243, 241, 236] : [20, 19, 24];
        const strokes = Array.from({ length: lines }, (_, index) => {
          const y = r.y + (r.height / lines) * (index + 0.5);
          const width = index === lines - 1 ? Math.min(r.width, Math.max(60, message.text.length * 7.2) % r.width || r.width) : r.width;
          return { points: [r.x + 4, y, r.x + Math.max(40, width), y], closed: false, width: 5, colour: ink, alpha: 0.22 };
        });
        const trip = life.travel({ strokes }, { absorb: p.rect() }, { colour: "spectrum" });
        void within(trip.arrived, 1600).then(() => void receive());
      } else {
        p.spin(1);
      }
      if (restRef.current !== "composer") void go(pointerInside.current ? "pill" : restRef.current);
      const focus = slot?.focus ?? null;
      const options = {
        ...(slot?.bindsThread ? {} : { threadId: focus?.threadId ?? null }),
        ...(message.references.length ? { references: message.references } : {}),
        ...(message.agentId !== undefined ? { agentId: message.agentId } : {}),
      };
      if (focus && engine.submitting && engine.activeRunId) void engine.steer(engine.activeRunId, message.text, message.attachments);
      else void engine.run(message.text, message.attachments, options);
    },
    [engine, go, receive, slot],
  );

  /* ------------------------------------------------------------ keyboard */

  // Ctrl J, the global shortcuts and the rest of the app open the composer here.
  const compose = useCallback(
    (fresh = false) => {
      if (fresh) slot?.startNewThread?.();
      setHidden(false);
      window.setTimeout(() => void go("composer"), 0);
    },
    [go, slot],
  );
  useEffect(() => spectraBus.on("island.compose", ({ fresh }) => compose(fresh)), [compose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "j") {
        event.preventDefault();
        compose();
        return;
      }
      if (mod && event.key === ".") {
        event.preventDefault();
        setHidden((current) => !current);
        return;
      }
      if (event.key === "Escape" && view) {
        void closeView();
        return;
      }
      // Typing in an editor fades the island to a faint prism.
      if (!mod && event.key.length === 1 && isEditable(event.target) && targetRef.current === "prism") setFaded(true);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.clientY > window.innerHeight - 140 && Math.abs(event.clientX - window.innerWidth / 2) < 220) setFaded(false);
    };
    const onDown = (event: PointerEvent) => {
      if (!view?.pinned) return;
      const target = event.target as Element | null;
      if (target?.closest?.("[data-island], [role='menu']")) return;
      void closeView();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [closeView, compose, view]);

  const onPillKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(pillRef.current?.querySelectorAll<HTMLButtonElement>("[data-island-tab], [data-plus]") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const next = buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)))];
      next?.focus();
    } else if (event.key === "Delete") {
      const runId = (document.activeElement as HTMLElement | null)?.dataset.runId;
      const tab = allTabs.find((candidate) => candidate.runId === runId);
      if (tab && tab.side === "done") void dismiss(tab.runId);
    }
  };

  /* ------------------------------------------------------------ render */

  const composerVisible = shown === "composer";
  const pillVisible = shown === "pill";
  const prismVisible = shown === "prism" && !breathing;
  const focus = slot?.focus ?? null;
  const placeholder = focus ? `Reply to ${focus.title}` : "Ask Spectra anything";

  const tabButton = (tab: IslandTab) => (
    <button
      key={tab.runId}
      ref={(node) => {
        if (node) tabRefs.current.set(tab.runId, node);
        else tabRefs.current.delete(tab.runId);
      }}
      type="button"
      data-island-tab
      data-run-id={tab.runId}
      aria-label={`${tab.title}: ${tab.caption}`}
      aria-pressed={view?.runId === tab.runId}
      onPointerEnter={() => {
        window.clearTimeout(viewTimer.current);
        viewTimer.current = window.setTimeout(() => openView(tab.runId, false), view ? 60 : VIEW_DELAY);
      }}
      onClick={() => openView(tab.runId, true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          openView(tab.runId, true);
        }
      }}
      className={cn(
        "inline-flex h-8 max-w-[180px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-caption outline-none",
        "transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]",
        view?.runId === tab.runId ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
      )}
    >
      <TabCue tab={tab} />
      <span data-tab-title className="min-w-0 truncate">
        {tabTitle(tab.title)}
      </span>
    </button>
  );

  return (
    <div
      data-island
      data-island-root
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      className={cn(
        // The island floats at the bottom centre of the stage: right of the rail.
        "pointer-events-none fixed bottom-0 left-[var(--spectra-rail-width,0px)] right-0 z-composer-dock flex flex-col items-center gap-2 transition-opacity duration-300",
        faded && "opacity-30 [&_*]:!pointer-events-none",
      )}
    >
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {question ? (
        <div className="pointer-events-auto">
          <QuestionCard
            ref={questionRef}
            question={question}
            index={Math.min(questionIndex, questions.length - 1)}
            count={questions.length}
            visible={questionShown}
            onStep={(delta) => setQuestionIndex((current) => (current + delta + questions.length) % questions.length)}
            onAnswer={answer}
            onOpenThread={question.threadId ? () => openThread(question.runId, question.threadId!, question.threadTitle) : undefined}
          />
        </div>
      ) : null}

      {viewTab ? (
        <div className="pointer-events-auto">
          <ThreadView
            ref={viewRef}
            tab={viewTab}
            engine={engine}
            visible={viewShown}
            offset={viewOffset}
            onOpenSide={() => openThread(viewTab.runId, viewTab.threadId, viewTab.title)}
            onDismiss={() => void dismiss(viewTab.runId)}
          />
        </div>
      ) : null}

      {notice && !question ? (
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            void go("pill").then(() => openView(notice.runId, true));
          }}
          className="pointer-events-auto island-content-in inline-flex h-8 max-w-[min(420px,calc(100vw-32px))] items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-caption text-[var(--text-primary)] shadow-[var(--shadow-card)]"
        >
          <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", notice.tone === "done" ? "bg-[var(--success)]" : "bg-[var(--danger)]")} />
          <span className="min-w-0 truncate">{notice.text}</span>
        </button>
      ) : null}

      <div ref={bandRef} className="grid w-full place-items-end pb-4">
        {/* The pill: threads in play, the +, threads done. */}
        <div
          ref={pillRef}
          role="toolbar"
          aria-label="Spectra threads"
          inert={!pillVisible}
          aria-hidden={!pillVisible}
          onKeyDown={onPillKey}
          className={cn(
            "col-start-1 row-start-1 grid h-11 grid-cols-[1fr_auto_1fr] items-center gap-1 justify-self-center rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] px-1.5 shadow-[var(--shadow-card)]",
            "transition-opacity duration-150",
            pillVisible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <div className="flex max-w-[min(40vw,560px)] items-center justify-end gap-0.5 overflow-x-auto [scrollbar-width:none]">{play.map(tabButton)}</div>
          <Tooltip label="New conversation" shortcut="Ctrl J">
            <button
              type="button"
              data-plus
              aria-label="New conversation"
              onClick={() => void go("composer")}
              className="grid size-8 place-items-center rounded-full bg-[var(--text-primary)] [color:var(--bg-primary)] outline-none transition-transform duration-[var(--motion-fast)] hover:scale-105 focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-2"
            >
              <Icon name="add" size={16} />
            </button>
          </Tooltip>
          <div className="flex max-w-[min(40vw,560px)] items-center justify-start gap-0.5 overflow-x-auto [mask-image:linear-gradient(to_right,black_85%,transparent)] [scrollbar-width:none]">
            {done.map(tabButton)}
          </div>
        </div>

        {/* The composer. */}
        <div
          inert={!composerVisible}
          aria-hidden={!composerVisible}
          className={cn(
            "col-start-1 row-start-1 justify-self-center transition-opacity duration-150",
            composerVisible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <IslandComposer
            ref={composerRef}
            draftKey={focus?.threadId ?? "new"}
            placeholder={placeholder}
            thread={focus}
            onLetGo={slot?.startNewThread}
            visible={composerVisible}
            busy={Boolean(focus && engine?.submitting)}
            onStop={engine ? () => void engine.stop() : undefined}
            onSend={send}
            onCancel={() => {
              if (restRef.current === "composer") (document.activeElement as HTMLElement | null)?.blur();
              else void go(pointerInside.current ? "pill" : restRef.current);
            }}
          />
        </div>

        {/* The prism. */}
        <div className="pointer-events-auto relative col-start-1 row-start-1 justify-self-center">
          <canvas
            ref={prism.canvasRef}
            role="button"
            tabIndex={target === "prism" ? 0 : -1}
            aria-label={status === "needs" ? "Spectra needs you" : status === "working" ? "Spectra is working" : "Spectra"}
            onPointerEnter={() => {
              prism.body().hover(true);
              prism.wake();
            }}
            onPointerLeave={() => {
              prism.body().hover(false);
              prism.wake();
            }}
            onPointerDown={() => {
              prism.body().press();
              prism.wake();
            }}
            onPointerUp={() => {
              prism.body().release();
              prism.wake();
            }}
            onClick={() => void go("composer")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void go("composer");
              }
            }}
            className={cn(
              "block size-14 cursor-pointer rounded-full outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]",
              prismVisible ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          />
          {prismVisible && workingCount > 1 ? (
            <span aria-hidden className="absolute -right-1 bottom-2 rounded-full bg-[var(--bg-elevated)] px-1 text-micro tabular-nums text-[var(--text-secondary)]">
              {workingCount}
            </span>
          ) : null}
        </div>
      </div>

      {/* Wake from the edge: a band along the bottom centre. */}
      {restShape === null && target === null ? (
        <div aria-hidden className="pointer-events-auto fixed bottom-0 left-1/2 h-7 w-[360px] -translate-x-1/2" onPointerEnter={() => void go("pill")} />
      ) : null}
    </div>
  );
}

function TabCue({ tab }: { tab: IslandTab }) {
  if (tab.status === "working") return <span aria-hidden className="island-working-light size-3 shrink-0 rounded-full" />;
  if (tab.status === "needs") return <span aria-hidden className="island-needs-glint size-2 shrink-0 rounded-full" />;
  if (tab.status === "problem") return <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--danger)]" />;
  if (tab.state === "cancelled") return <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--text-tertiary)]" />;
  return <Icon name="done" size={14} className={tab.seen ? "text-[var(--text-tertiary)]" : "text-[var(--success)]"} />;
}
