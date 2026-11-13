"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { SpectraRunPointer } from "../ai/use-spectra-run";
import { postSpectra } from "../data/api";
import { spectraBus, type ThreadScope } from "../events";
import type { LightColour } from "../life/engine";
import { life, rectOf } from "../life/life";
import type { PrismStatus } from "../life/prism";
import { STATUS_COLOURS } from "../life/prism";
import { figureOf } from "../life/figure-dom";
import { markArrival } from "../life/use-life";
import { refreshComposerBands, registerComposerBand } from "../components/composer-safe-area";
import { useSpectraRouter } from "../hooks/use-spectra-router";
import { calendarTouchHref, isCalendarTouch } from "../calendar/domain/touch";
import { useSpectraMotion } from "../motion";
import { useSpectraPreferences } from "../settings/preference-store";
import { useFollowAi } from "../collaboration/follow-ai";
import { useTreeActions, useTreePlacement } from "../organization/tree-client";
import { setWorkSpeeds } from "../collaboration/work-speed";
import { IslandComposer, type ComposerHandle, type ComposerSend } from "./composer";
import { useIslandEngine } from "./engine";
import { forgetThread, placeThread, useArrangement } from "./arrange";
import { arrangeTabs, dropTab, isPendingTab, islandStatus, pendingRunTab, statusLight, stepTab, type IslandSide, type IslandTab } from "./island-model";
import { IslandRail, RAIL_DONE, RailGhost, useRailSeat, type RailHandlers } from "./island-rail";
import { boxOf, morphShape } from "./shape-morph";
import { NOTICE_COLOUR } from "./notice";
import { AnsweredCard, QuestionCard } from "./question-card";
import { forgetAnswered, noteAnswered, useAnsweredNotes } from "../ai/answered-inputs";
import { answerQuestion, pendingQuestions, questionAnswerLabel, type QuestionAnswer } from "./questions";
import { refreshRunTabs, useRunTabs } from "./run-tabs";
import { settleFirstVisit, useSeenRuns } from "./seen";
import { ThreadSwitcher } from "./thread-switcher";
import { ThreadView } from "./thread-view";
import { PEEK_LIFE_MS, PEEK_REST_MS, ReplyPeek, peekLine } from "./reply-peek";
import { useIslandRestsHidden } from "./phone-rest";
import { runTabCard } from "./run-tabs";
import { useFlip, useTabDrag } from "./use-tab-drag";
import { threadHref } from "../chat/home-routes";
import { firstTipMoment } from "../onboarding/first-tips";


/*
 * The island (docs/design/ISLAND.md): where the user talks to Spectra, on
 * every page. It is the field to write in, always there to type into; its
 * threads stand on its top edge as the rail of folder tabs. Hovering a tab
 * shows its thread over the island; pressing it keeps the thread open and
 * turns the field to it, so a reply is just typed.
 */

type Shape = "composer";
type ReplyTo = { runId: string; threadId: string; title: string } | "new" | null;

/** Leaving the island: it settles back quickly, so it never lingers over the page. */
const ANSWERED_NOTE_MS = 1400;
const CLOSE_DELAY = 220;
/** A hand resting still on a tab this long means to look; passing over it does not. */
const VIEW_DELAY = 560;
/** Moving from one open card's tab to the next. */
const VIEW_SWITCH_DELAY = 160;
/** A card only shown on hover goes this soon after the hand leaves its tab and the card. */
const PEEK_CLOSE_DELAY = 140;
/** After a press elsewhere on the island (new thread, stop, send), tabs under the hand stay quiet this long. */
const PRESS_QUIET_MS = 900;
/** Movement within this many pixels still counts as resting. */
const REST_SLOP = 5;
const ARRIVAL_MS = 1600;

const PLACEHOLDER_TITLE = 36;
/** How long a question stands untouched before it folds onto its thread's tab. */
const QUESTION_IDLE_MS = 90_000;
/** Up to this many thread tabs always stand on the rail; past it, they tuck away until the island is hovered. */
const TABS_ALWAYS_STANDING = 3;

/** A title for one line: cut on a word boundary, ending in one ellipsis and nothing after it. */
export function shortTitle(title: string) {
  const clean = title.replace(/\s+/g, " ").trim().replace(/(?:…|\.{3})$/, "");
  if (clean.length <= PLACEHOLDER_TITLE) return clean;
  const cut = clean.slice(0, PLACEHOLDER_TITLE + 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut.slice(0, PLACEHOLDER_TITLE)).replace(/[\s,.;:–—-]+$/, "")}…`;
}

/** A step caption as the field's line while it works: "Reading Physics progress…". */
export function workingLine(caption: string) {
  const clean = caption.replace(/\*/g, "").replace(/\s+/g, " ").trim().replace(/[\s.…:;,]+$/, "");
  return clean ? `${clean}…` : "Working…";
}

/** The island's own centre line: the middle of the stage, between the rail and the Side. */
function stageCentre() {
  const root = typeof document === "undefined" ? null : document.querySelector<HTMLElement>("[data-island-root]");
  if (!root) return typeof window === "undefined" ? 0 : window.innerWidth / 2;
  const r = root.getBoundingClientRect();
  return r.left + r.width / 2;
}

/** Half the stage's width. */
function stageHalf() {
  const root = typeof document === "undefined" ? null : document.querySelector<HTMLElement>("[data-island-root]");
  return root ? root.getBoundingClientRect().width / 2 : window.innerWidth / 2;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const within = (promise: Promise<unknown>, ms: number) => Promise.race([promise, new Promise((resolve) => window.setTimeout(resolve, ms))]);

function menuOpen() {
  return Boolean(document.querySelector("[role='menu'][data-state='open'], [role='listbox'][data-state='open']"));
}

export function Island() {
  const slot = useIslandEngine();
  const engine = slot?.engine ?? null;
  const router = useSpectraRouter();
  const { preferences } = useSpectraPreferences();
  const followingAi = useFollowAi().following;
  setWorkSpeeds({ speed: "fast", followSpeed: "fast", following: followingAi });
  const motion = useSpectraMotion();

  const live = engine?.liveExchange ?? null;
  const demand = live && (live.status === "starting" || live.status === "streaming") ? `island:${live.runId ?? live.threadId ?? "new"}:${live.status}` : null;
  const serverTabs = useRunTabs({ demand });
  // A sent message has its tab at once; the server's takes its place when it arrives.
  const tabs = useMemo(() => {
    if (!live || (live.status !== "starting" && live.status !== "streaming")) return serverTabs;
    if (live.runId && serverTabs.some((tab) => tab.runId === live.runId)) return serverTabs;
    return [...serverTabs, pendingRunTab(live)];
  }, [live, serverTabs]);
  const liveRunId = live?.runId;
  useEffect(() => {
    if (liveRunId) void refreshRunTabs(true);
  }, [liveRunId]);
  const [seen, markSeen] = useSeenRuns();
  const arrangement = useArrangement();

  const [hidden, setHidden] = useState(false);
  const phoneRest = useIslandRestsHidden();
  const restShape: Shape | null = hidden || phoneRest || preferences.ai.islandWake === "edge" ? null : "composer";
  const restRef = useRef(restShape);
  restRef.current = restShape;

  const [target, setTarget] = useState<Shape | null>(restShape);
  const [shown, setShown] = useState<Shape | null>(restShape);
  const targetRef = useRef(target);
  const shownRef = useRef(shown);
  const generation = useRef(0);

  const frameRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const questionRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const replyPeekRef = useRef<HTMLDivElement>(null);
  /** Where the thread card grows from when it opens out of the reply peek rather than its tab. */
  const growFrom = useRef<ReturnType<typeof boxOf>>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const dividerRef = useRef<HTMLSpanElement>(null);
  const dragActive = useRef(false);
  const arrivingUntil = useRef(0);
  const closeTimer = useRef(0);
  const viewTimer = useRef(0);
  const peekTimer = useRef(0);
  const quietUntil = useRef(0);
  const restAnchor = useRef<{ x: number; y: number } | null>(null);
  const pointerInside = useRef(false);
  const focusOnShow = useRef(false);

  // The island as the field sees it: its outline for light to leave from, Spectra's mark to take things in.
  const islandFigure = useCallback(() => {
    const element = composerRef.current?.element();
    return element ? figureOf(element) : null;
  }, []);
  const islandHome = useCallback(() => {
    const element = composerRef.current?.element();
    const mark = element?.querySelector("[data-agent-switch]") ?? element;
    return mark ? rectOf(mark) : null;
  }, []);

  // The hand is on the island (or the keyboard in it, or a thread just arrived): the rail stands up.
  const [reaching, setReaching] = useState(false);
  // The thread the composer writes into when the user picked it on the rail; otherwise the page's.
  const [replyTo, setReplyTo] = useState<ReplyTo>(null);

  // Sides hold still while the user is looking at the rail.
  const held = useRef<Map<string, IslandSide> | null>(null);
  // `held` is a ref; reaching for the island is what takes or releases it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { play, done } = useMemo(() => arrangeTabs(tabs, { seen, held: held.current ?? undefined, arrangement }), [tabs, seen, reaching, arrangement]);
  const allTabs = useMemo(() => [...play, ...done], [play, done]);
  const arrangedRef = useRef(allTabs);
  arrangedRef.current = allTabs;
  useEffect(() => {
    held.current = reaching ? held.current ?? new Map(arrangedRef.current.map((tab) => [tab.runId, tab.side])) : null;
  }, [reaching]);

  // A first visit treats what already finished as seen.
  useEffect(() => {
    if (!tabs.length) return;
    settleFirstVisit(tabs.filter((tab) => !["queued", "running", "awaiting_confirmation", "awaiting_resolution"].includes(tab.run.status)).map((tab) => tab.runId));
  }, [tabs]);

  const focus = replyTo === "new" ? null : replyTo ?? slot?.focus ?? null;

  // A thread the page has open is seen.
  const focusThread = slot?.focus?.threadId ?? null;
  // A thread opened elsewhere that was not on the rail: it joins the rail while open there and leaves with it.
  const brought = useRef<string | null>(null);
  useEffect(() => {
    if (!focusThread) return;
    for (const tab of allTabs) if (tab.threadId === focusThread && !tab.seen && tab.status !== "working") markSeen(tab.runId);
  }, [allTabs, focusThread, markSeen]);

  /* ------------------------------------------------------------ shapes */

  const show = useCallback((next: Shape | null) => {
    shownRef.current = next;
    setShown(next);
  }, []);

  const elementOf = useCallback((shape: Shape | null) => (shape === "composer" ? composerRef.current?.element() : null), []);
  const boxFor = useCallback((shape: Shape | null) => boxOf(elementOf(shape)), [elementOf]);

  /**
   * Changes the island's shape. Only a composer the user opened to write in
   * (`focus`) takes the keyboard: one that comes to rest because the page
   * changed, or that a hover raised, must never pull the typing out of an
   * editor.
   */
  const go = useCallback(
    async (next: Shape | null, { focus = false }: { focus?: boolean } = {}) => {
      if (next === targetRef.current) {
        // Asked for again (Ctrl J on an open composer): it takes the keyboard back.
        if (next === "composer" && focus) composerRef.current?.focus();
        return;
      }
      targetRef.current = next;
      // A thread chosen to reply in holds while the composer is there.
      if (!next) setReplyTo(null);
      setTarget(next);
      const gen = ++generation.current;
      // Let the next shape lay out at its real size before it is measured.
      await nextFrame();
      if (gen !== generation.current) return;
      if (next === "composer" && focus) focusOnShow.current = true;
      // One object changing shape: the frame stretches from what was there to what comes, and the new contents arrive in it.
      morphShape(frameRef.current, boxFor(shownRef.current), boxFor(next));
      show(next);
    },
    [boxFor, show],
  );

  // The resting shape follows the page and the settings.
  useEffect(() => {
    if (targetRef.current === "composer" && restShape !== "composer") return;
    void go(restShape);
  }, [go, restShape]);

  /** Light going out from the island: what was sent reached Spectra, or something happened the user should glance at. */
  const radiateFromIsland = useCallback(
    (colour: LightColour, count: number, reach: number) => {
      const figure = life.on && shownRef.current ? islandFigure() : null;
      if (figure) life.radiate(figure, { colour, count, reach });
    },
    [islandFigure],
  );
  const receive = useCallback(() => radiateFromIsland("spectrum", 16, 26), [radiateFromIsland]);

  // Pages keep their last lines clear of the island's resting row.
  useEffect(() => {
    const band = bandRef.current;
    if (!band) return;
    return registerComposerBand(band);
  }, []);

  /* ------------------------------------------------------------ status */

  const questionsAll = useMemo(() => pendingQuestions(engine, tabs), [engine, tabs]);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const answeredNotes = useAnsweredNotes();
  // Answered anywhere counts: the thread may have taken the answer this card was waiting for.
  const questions = useMemo(() => {
    const keys = new Set(answeredNotes.map((note) => note.key));
    return questionsAll.filter(
      (question) => !answered.has(question.key) && !keys.has(question.key) && !(question.messageId && keys.has(`message:${question.messageId}`)),
    );
  }, [answered, answeredNotes, questionsAll]);

  const status: PrismStatus | null = useMemo(() => {
    if (questions.length || live?.status === "waiting") return "needs";
    const fromTabs = islandStatus(allTabs);
    if (fromTabs === "problem") return fromTabs;
    // The tab comes from the server. Once it says the run has ended, a live view
    // that never heard the end does not keep the island working.
    const liveTab = live?.runId ? allTabs.find((tab) => tab.runId === live.runId) : undefined;
    const liveEnded = Boolean(liveTab && liveTab.status !== "working" && liveTab.status !== "needs");
    if (live && !liveEnded && (live.status === "starting" || live.status === "streaming")) return "working";
    if (live?.status === "failed") return "problem";
    return fromTabs;
  }, [allTabs, live, questions.length]);

  const statusBefore = useRef<PrismStatus | null | undefined>(undefined);
  const sentAt = useRef(0);
  useEffect(() => {
    spectraBus.setQuery("prism.status", { status });
    const before = statusBefore.current;
    statusBefore.current = status;
    // The island lets the light out, so a glance away still catches it.
    const light = statusLight(before, status, performance.now() - sentAt.current);
    if (light === "needs") radiateFromIsland(STATUS_COLOURS.needs, 12, 20);
    else if (light) radiateFromIsland("spectrum", 10, 16);
  }, [radiateFromIsland, status]);
  useEffect(() => () => spectraBus.setQuery("prism.status", { status: null }), []);

  /* ------------------------------------------------------------ notices */

  // A finished or stopped thread's toast opens its view here; the view is set up further down.
  const openRunRef = useRef<(runId: string) => void>(() => {});
  const openRun = useCallback((runId: string) => openRunRef.current(runId), []);

  const [announcement, setAnnouncement] = useState("");
  // The reply peek (ISLAND.md, "Sending"): one at a time, rising from the finished thread's tab.
  const [replyPeek, setReplyPeek] = useState<string | null>(null);
  const [replyPeekShown, setReplyPeekShown] = useState(false);
  const replyPeekRun = useRef<string | null>(null);
  replyPeekRun.current = replyPeek;
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
        const line = peekLine(tab);
        setAnnouncement(`${tab.title}: ${line?.text || "finished"}`);
        // The answer comes up out of its tab, unless the thread is already on screen or its card is open.
        const onScreenNow =
          currentView.current?.runId === tab.runId ||
          spectraBus.getQuery("side.thread")?.threadId === tab.threadId ||
          slot?.focus?.threadId === tab.threadId;
        if (line && !onScreenNow && !menuOpen() && !dialogOpen()) setReplyPeek(tab.runId);
        radiateFromIsland(STATUS_COLOURS.done, 14, 24);
      } else if (tab.state === "failed_terminal" || tab.state === "paused") {
        toast.error(`${tab.title} stopped with a problem`, { id: `run:${tab.runId}:problem`, action: { label: "Open", onClick: () => openRun(tab.runId) } });
        setAnnouncement(`${tab.title} stopped with a problem.`);
        radiateFromIsland(STATUS_COLOURS.problem, 8, 14);
      }
    }
    lastStates.current = next;
  }, [allTabs, openRun, radiateFromIsland, slot]);

  // Notifications reach the user here (SHELL.md): the island lights in their colour and the words form from it.
  useEffect(
    () =>
      spectraBus.on("island.notify", ({ id, title, detail, tone }) => {
        const say = tone === "problem" ? toast.error : tone === "needs" ? toast.warning : toast.info;
        say(title, { id: `notification:${id}`, description: detail, action: { label: "Open", onClick: () => spectraBus.emit("notifications.choose", { id }) } });
        setAnnouncement(title);
        radiateFromIsland(NOTICE_COLOUR[tone], 10, 18);
      }),
    [radiateFromIsland],
  );


  /* ------------------------------------------------------------ questions */

  // Questions put aside wait on their thread's tab, counted, until answered or brought back.
  const [later, setLater] = useState<ReadonlySet<string>>(new Set());
  // A question whose thread is already on the page is answered there: the card would only say it twice (F04).
  const threadOnPage = slot?.focus?.threadId ?? null;
  const asking = useMemo(
    () =>
      questions.filter(
        (candidate) =>
          !later.has(candidate.key) &&
          !(candidate.threadId && (candidate.threadId === threadOnPage || spectraBus.getQuery("side.thread")?.threadId === candidate.threadId)),
      ),
    [later, questions, threadOnPage],
  );
  const waitingByThread = useMemo(() => {
    const counts = new Map<string, number>();
    for (const candidate of questions)
      if (later.has(candidate.key) && candidate.threadId) counts.set(candidate.threadId, (counts.get(candidate.threadId) ?? 0) + 1);
    return counts;
  }, [later, questions]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const question = asking.length ? asking[Math.min(questionIndex, asking.length - 1)] : null;
  const putAside = useCallback((key: string) => setLater((current) => new Set(current).add(key)), []);
  const bringBack = useCallback(
    (threadId: string) => {
      const keys = questions.filter((candidate) => candidate.threadId === threadId && later.has(candidate.key)).map((candidate) => candidate.key);
      if (!keys.length) return false;
      setLater((current) => new Set([...current].filter((key) => !keys.includes(key))));
      setQuestionIndex(0);
      return true;
    },
    [later, questions],
  );
  // A question left alone for a while folds onto its tab rather than standing over the page.
  const idleTimer = useRef(0);
  const questionActivity = useCallback(() => {
    window.clearTimeout(idleTimer.current);
    const key = question?.key;
    if (!key) return;
    idleTimer.current = window.setTimeout(() => {
      putAside(key);
      setAnnouncement("The question waits on its thread's tab.");
    }, QUESTION_IDLE_MS);
  }, [putAside, question?.key]);
  useEffect(() => {
    questionActivity();
    return () => window.clearTimeout(idleTimer.current);
  }, [questionActivity]);
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
      // The question is there at once; the band crosses it as it lands.
      setQuestionShown(true);
      markArrival(card);
    })();
    return () => {
      live = false;
    };
  }, [question]);

  const [justAnswered, setJustAnswered] = useState<{ question: string; label: string } | null>(null);
  const justAnsweredTimer = useRef<number | undefined>(undefined);
  const answer = useCallback(
    async (value: QuestionAnswer) => {
      if (!engine || !question) return false;
      const label = questionAnswerLabel(question, value);
      noteAnswered({ key: question.key, runId: question.runId, question: question.prompt, label });
      setJustAnswered({ question: question.prompt, label });
      window.clearTimeout(justAnsweredTimer.current);
      justAnsweredTimer.current = window.setTimeout(() => setJustAnswered(null), ANSWERED_NOTE_MS);
      const accepted = await answerQuestion(engine, question, value, tabs);
      if (!accepted) {
        forgetAnswered(question.key);
        window.clearTimeout(justAnsweredTimer.current);
        setJustAnswered(null);
        return false;
      }
      markSeen(question.runId);
      setAnswered((current) => new Set(current).add(question.key));
      return true;
    },
    [engine, markSeen, question, tabs],
  );

  /* ------------------------------------------------------------ thread view */

  const [view, setView] = useState<{ runId: string; pinned: boolean } | null>(null);
  const currentView = useRef(view);
  currentView.current = view;
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
      if (!live || !viewRef.current) return;
      // The card grows out of its tab, or out of the reply peek it was opened from.
      morphShape(frameRef.current, growFrom.current ?? boxOf(tabRefs.current.get(view?.runId ?? "")), boxOf(viewRef.current));
      growFrom.current = null;
      setViewShown(true);
    })();
    return () => {
      live = false;
    };
    // Forms once per opening; switching tabs slides the open card instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewOpen]);

  const closeView = useCallback(() => {
    // It folds back into its tab, and the field lets go of the thread it was turned to.
    if (viewShown) morphShape(frameRef.current, boxOf(viewRef.current), boxOf(tabRefs.current.get(view?.runId ?? "")));
    setViewShown(false);
    setView(null);
    setReplyTo((current) => (current && current !== "new" && current.runId === view?.runId ? null : current));
  }, [view, viewShown]);

  const openView = useCallback(
    (runId: string, pinned: boolean) => {
      if (isPendingTab(runId)) return;
      window.clearTimeout(viewTimer.current);
      // Opened over its peek, the card grows from the peek: one surface getting bigger.
      if (replyPeekRun.current === runId && replyPeekRef.current) growFrom.current = boxOf(replyPeekRef.current);
      setView((current) => (current?.pinned && !pinned && current.runId !== runId ? current : { runId, pinned: pinned || Boolean(current?.pinned && current.runId === runId) }));
      markSeen(runId);
    },
    [markSeen],
  );
  useEffect(() => {
    if (!live?.runId || !live.threadId || !replyTo || replyTo === "new" || replyTo.runId !== `pending:${live.id}`) return;
    setReplyTo({ runId: live.runId, threadId: live.threadId, title: allTabs.find((tab) => tab.runId === live.runId)?.title ?? replyTo.title });
    openView(live.runId, true);
  }, [allTabs, live, openView, replyTo]);
  /* ------------------------------------------------------------ reply peek */

  const replyPeekTab = replyPeek ? allTabs.find((tab) => tab.runId === replyPeek) ?? null : null;
  const replyPeekLine = replyPeekTab ? peekLine(replyPeekTab) : null;
  const replyPeekLife = useRef({ timer: 0, rest: 0, left: PEEK_LIFE_MS, since: 0 });

  /** It folds back into its tab, which keeps its unread lip. */
  const foldReplyPeek = useCallback(() => {
    const runId = replyPeekRun.current;
    if (!runId) return;
    window.clearTimeout(replyPeekLife.current.timer);
    window.clearTimeout(replyPeekLife.current.rest);
    morphShape(frameRef.current, boxOf(replyPeekRef.current), boxOf(tabRefs.current.get(runId)));
    setReplyPeekShown(false);
    setReplyPeek(null);
  }, []);
  const runReplyPeekLife = useCallback(() => {
    const life = replyPeekLife.current;
    window.clearTimeout(life.timer);
    life.since = performance.now();
    life.timer = window.setTimeout(foldReplyPeek, life.left);
  }, [foldReplyPeek]);
  /** The count stops while the pointer is over the peek or the rail, and goes on from where it was. */
  const holdReplyPeekLife = useCallback(() => {
    const life = replyPeekLife.current;
    if (!replyPeekRun.current || !life.since) return;
    window.clearTimeout(life.timer);
    life.left = Math.max(1_000, life.left - (performance.now() - life.since));
    life.since = 0;
  }, []);

  // It rises out of its tab: the same origin and spring as the card. With reduced motion it only fades.
  const replyPeekOpen = Boolean(replyPeekTab && replyPeekLine);
  useEffect(() => {
    if (!replyPeekOpen) {
      setReplyPeekShown(false);
      return;
    }
    let current = true;
    const life = replyPeekLife.current;
    life.left = PEEK_LIFE_MS;
    void (async () => {
      await nextFrame();
      if (!current || !replyPeekRef.current) return;
      morphShape(frameRef.current, boxOf(tabRefs.current.get(replyPeekRun.current ?? "")), boxOf(replyPeekRef.current));
      setReplyPeekShown(true);
      if (pointerInside.current) replyPeekLife.current.since = 0;
      else runReplyPeekLife();
    })();
    return () => {
      current = false;
      window.clearTimeout(life.timer);
      window.clearTimeout(life.rest);
    };
    // A newer peek replaces the one showing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyPeekOpen, replyPeek]);
  // Never over an open thread card: the card takes its place.
  useEffect(() => {
    if (viewOpen && replyPeek) {
      setReplyPeekShown(false);
      setReplyPeek(null);
    }
  }, [replyPeek, viewOpen]);
  // Escape puts it away; it never takes the key from what has focus otherwise.
  useEffect(() => {
    if (!replyPeek) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") foldReplyPeek();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [foldReplyPeek, replyPeek]);

  const openOnArrival = useRef(false);
  useEffect(() => {
    if (!openOnArrival.current || !live?.runId || !allTabs.some((tab) => tab.runId === live.runId)) return;
    openOnArrival.current = false;
    openView(live.runId, true);
  }, [allTabs, live?.runId, openView]);

  useEffect(() => {
    openRunRef.current = (runId) => {
      setReaching(true);
      void go(targetRef.current ?? "composer").then(() => openView(runId, true));
    };
  }, [go, openView]);

  const viewOffset = useMemo(() => {
    if (!viewTab) return 0;
    const element = tabRefs.current.get(viewTab.runId);
    if (!element || typeof window === "undefined") return 0;
    const r = element.getBoundingClientRect();
    // The card stays over its tab without leaving the stage: its own half width, inside the gutter.
    const stage = stageHalf();
    const half = Math.min((viewRef.current?.offsetWidth || 680) / 2, stage - 16);
    const limit = Math.max(0, stage - half - 16);
    return Math.max(-limit, Math.min(limit, r.x + r.width / 2 - stageCentre()));
    // Measured when the card moves to another tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewTab?.runId, shown]);

  // Over its tab, never past the stage's gutter.
  const replyPeekOffset = useMemo(() => {
    if (!replyPeekTab || typeof window === "undefined") return 0;
    const element = tabRefs.current.get(replyPeekTab.runId);
    if (!element) return 0;
    const r = element.getBoundingClientRect();
    const stage = stageHalf();
    const half = Math.min(210, stage - 16);
    const limit = Math.max(0, stage - half - 16);
    return Math.max(-limit, Math.min(limit, r.x + r.width / 2 - stageCentre()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyPeekTab?.runId, shown]);

  const openThread = useCallback(
    (runId: string, threadId: string, title: string) => {
      markSeen(runId);
      if (slot?.openThread) slot.openThread(runId, threadId, title);
      // The Side opens it where the page has one; where none answers, its own page does.
      else if (!spectraBus.command("run.openConversation", { runId, threadId }))
        router.push(threadHref(threadId));
    },
    [markSeen, router, slot],
  );

  const dismiss = useCallback(
    async (runId: string) => {
      if (view?.runId === runId) closeView();
      markSeen(runId);
      const threadId = arrangedRef.current.find((tab) => tab.runId === runId)?.threadId;
      if (threadId) forgetThread(threadId);
      await postSpectra({ action: "hideRunTab", runId }).catch(() => undefined);
      await refreshRunTabs(true);
    },
    [closeView, markSeen, view?.runId],
  );

  useEffect(() => {
    const leaving = brought.current;
    if (leaving === focusThread) return;
    brought.current = focusThread && !arrangedRef.current.some((tab) => tab.threadId === focusThread) ? focusThread : null;
    const tab = leaving ? arrangedRef.current.find((candidate) => candidate.threadId === leaving) : undefined;
    // Closed where it was opened, it goes again, unless it is still working.
    if (tab && tab.status !== "working") void dismiss(tab.runId);
    // Only the thread the page opens matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusThread]);

  /* ------------------------------------------------------------ arranging */

  const place = useCallback(
    (tab: IslandTab, side: IslandSide, index: number) => {
      dragActive.current = false;
      const { order } = dropTab(play, done, tab.runId, side, index);
      placeThread(tab.threadId, tab.runId, side, order, tab.automaticSide);
      held.current?.set(tab.runId, side);
      if (side !== tab.side) setAnnouncement(side === "play" ? `${tab.title} stays in play.` : `${tab.title} put away.`);
    },
    [done, play],
  );

  const tabDrag = useTabDrag({
    play,
    done,
    tabRefs,
    dividerRef,
    onStart: () => {
      dragActive.current = true;
      window.clearTimeout(viewTimer.current);
      if (view && !view.pinned) setView(null);
    },
    onPlace: place,
    onDismiss: (tab) => {
      dragActive.current = false;
      setAnnouncement(`${tab.title} moved to history.`);
      void dismiss(tab.runId);
    },
  });
  const shownPlay = tabDrag.preview.play;
  const shownDone = tabDrag.preview.done;
  useFlip(tabRefs, `${shownPlay.map((tab) => tab.runId).join(",")}|${shownDone.map((tab) => tab.runId).join(",")}`, motion.reduced);

  const [menu, setMenu] = useState<{ tab: IslandTab; x: number; y: number } | null>(null);

  /* ------------------------------------------------------------ hover */

  const scheduleClose = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(function close() {
      if (pointerInside.current) return;
      if (currentView.current?.pinned) return;
      if (menuOpen() || dragActive.current || performance.now() < arrivingUntil.current) {
        closeTimer.current = window.setTimeout(close, CLOSE_DELAY);
        return;
      }
      const composer = composerRef.current;
      // A reply being written keeps its thread in view; otherwise leaving puts the card away, chosen or not.
      if (targetRef.current === "composer" && composer?.hasContent()) return;
      const writing = targetRef.current === "composer" && Boolean(composer?.element()?.contains(document.activeElement));
      // A keyboard moving through the island keeps it open as the hand does.
      if (!writing && document.activeElement?.closest("[data-island]") && document.activeElement.matches(":focus-visible")) return;
      setView(null);
      // The field stays up while it has the keyboard.
      if (writing) return;
      setReaching(false);
      void go(restRef.current);
    }, CLOSE_DELAY);
  }, [go]);

  // A phone has no hover to leave: a tap anywhere else puts a raised island
  // back to its lip, unless something is being written in it.
  useEffect(() => {
    if (!phoneRest || target === null) return;
    const away = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest("[data-island], [role='menu'], [role='dialog'], [role='listbox']")) return;
      if (composerRef.current?.hasContent() || currentView.current?.pinned) return;
      pointerInside.current = false;
      window.clearTimeout(closeTimer.current);
      setView(null);
      setReaching(false);
      void go(restRef.current);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [go, phoneRest, target]);

  // Whatever held the rail up let go while the hand was elsewhere: it goes back down.
  useEffect(() => {
    if (reaching && !view && !pointerInside.current) scheduleClose();
  }, [reaching, scheduleClose, view]);

  const onEnter = () => {
    pointerInside.current = true;
    holdReplyPeekLife();
    setReaching(true);
    window.clearTimeout(closeTimer.current);
  };
  const onLeave = () => {
    pointerInside.current = false;
    if (replyPeekRun.current && !replyPeekLife.current.since) runReplyPeekLife();
    window.clearTimeout(viewTimer.current);
    schedulePeekClose();
    scheduleClose();
  };

  /* ------------------------------------------------------------ arriving */

  // A thread opened elsewhere: the rail stands up and its tab lands there, crossed by the band.
  useEffect(
    () =>
      spectraBus.on("island.arrive", ({ threadId }) => {
        setHidden(false);
        arrivingUntil.current = performance.now() + ARRIVAL_MS;
        setReaching(true);
        if (!targetRef.current) void go("composer");
        void (async () => {
          await nextFrame();
          const tab = arrangedRef.current.find((candidate) => candidate.threadId === threadId);
          const element = tab ? tabRefs.current.get(tab.runId) : composerRef.current?.element();
          // The tab is there at once; the band crosses it as it lands.
          if (element) markArrival(element);
        })();
      }),
    [go],
  );

  /* ------------------------------------------------------------ sending */

  const send = useCallback(
    (message: ComposerSend) => {
      if (!engine) return;
      sentAt.current = performance.now();
      // Someone who already points at works or attaches files needs no tip about it.
      if (!message.references.length && !message.attachments.length) firstTipMoment("message");
      // Answered, a thread brought to the rail stays there.
      if (focus?.threadId === brought.current) brought.current = null;
      const home = islandHome();
      if (life.on && message.wordsRect && home) {
        const r = message.wordsRect;
        const lines = Math.min(4, message.lineCount);
        const ink: [number, number, number] = document.documentElement.classList.contains("dark") ? [243, 241, 236] : [20, 19, 24];
        const strokes = Array.from({ length: lines }, (_, index) => {
          const y = r.y + (r.height / lines) * (index + 0.5);
          const width = index === lines - 1 ? Math.min(r.width, Math.max(60, message.text.length * 7.2) % r.width || r.width) : r.width;
          return { points: [r.x + 4, y, r.x + Math.max(40, width), y], closed: false, width: 5, colour: ink, alpha: 0.22 };
        });
        const trip = life.travel({ strokes }, { absorb: home }, { colour: "spectrum" });
        void within(trip.arrived, 1600).then(receive);
      }
      // Nothing opens at send (ISLAND.md, "Sending"): the words go into the prism and the thread's tab stands on the
      // rail, working; its answer rises from the tab as a peek when it is done. "Open the thread when I send" opens
      // the card over its tab instead, once the run has one.
      quietUntil.current = performance.now() + PRESS_QUIET_MS;
      openOnArrival.current = preferences.ai.openConversationAfterSend;
      const options = {
        ...(slot?.bindsThread ? {} : { threadId: focus?.threadId ?? null }),
        ...(message.references.length ? { references: message.references } : {}),
        ...(message.agentId !== undefined ? { agentId: message.agentId } : {}),
      };
      // Words for a thread still working join its run rather than starting another.
      const working = focus ? allTabs.find((tab) => tab.threadId === focus.threadId && tab.status === "working") : undefined;
      const steering = working?.runId ?? (focus && focus === slot?.focus && engine.submitting ? engine.activeRunId : null);
      if (steering) void engine.steer(steering, message.text, message.attachments);
      else void engine.run(message.text, message.attachments, options);
    },
    [allTabs, engine, focus, islandHome, preferences.ai.openConversationAfterSend, receive, slot],
  );

  /* ------------------------------------------------------------ keyboard */

  // Ctrl J, the global shortcuts and the rest of the app open the composer here.
  const latestSend = useRef(send);
  latestSend.current = send;
  const compose = useCallback(
    (fresh = false, prefill?: { text?: string; references?: SpectraRunPointer[] }, sendNow = false) => {
      if (fresh) slot?.startNewThread?.();
      setHidden(false);
      window.setTimeout(() => {
        void go("composer", { focus: true }).then(() => {
          // Sent at once, the words go as the student's own message, from the thread now in focus.
          if (sendNow && prefill?.text) {
            // Words typed into the field on the way (a demonstration types them) go with it.
            if (composerRef.current?.hasContent()) composerRef.current.prefill("", []);
            return latestSend.current({ text: prefill.text, references: prefill.references ?? [], attachments: [], wordsRect: null, lineCount: 1 });
          }
          // Work handed over without words (picked work to ask about) comes in as references, under an empty field.
          if (prefill?.text || prefill?.references?.length) composerRef.current?.prefill(prefill.text ?? "", prefill.references);
        });
      }, 0);
    },
    [go, slot],
  );
  useEffect(
    () => spectraBus.on("island.compose", ({ fresh, text, references, send: sendNow }) => compose(fresh, { text, references }, sendNow)),
    [compose],
  );

  /* ------------------------------------------------------------ switcher */

  // Every thread, from anywhere. A page that binds a thread (chat) has its own search and answers instead.
  const [switcher, setSwitcher] = useState<{ query?: string; scope?: ThreadScope } | null>(null);
  const bindsThread = Boolean(slot?.bindsThread);
  useEffect(
    () =>
      spectraBus.on("threads.open", ({ query, scope }) => {
        if (bindsThread) return;
        setHidden(false);
        setSwitcher({ query, scope });
      }),
    [bindsThread],
  );
  const closeSwitcher = useCallback(() => setSwitcher(null), []);

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
        closeView();
        return;
      }
    };
    // A press anywhere off the island puts the open card away, whether it was
    // chosen or only shown on hover.
    const onDown = (event: PointerEvent) => {
      if (!view) return;
      const target = event.target as Element | null;
      if (target?.closest?.("[data-island], [role='menu']")) return;
      closeView();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [closeView, compose, view]);

  const onRailKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-rail-tab]"));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && event.altKey) {
      event.preventDefault();
      const runId = (document.activeElement as HTMLElement | null)?.dataset.runId;
      const tab = allTabs.find((candidate) => candidate.runId === runId);
      const step = tab ? stepTab(play, done, tab.runId, event.key === "ArrowLeft" ? -1 : 1) : null;
      if (!tab || !step) return;
      place(tab, step.side, step.index);
      // Crossing the divider moves the button to the other side; keep the focus on it.
      requestAnimationFrame(() => tabRefs.current.get(tab.runId)?.focus());
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
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
  // Opened to write in: it takes the keyboard on the commit that makes it usable (no longer inert).
  useEffect(() => {
    if (!composerVisible || !focusOnShow.current) return;
    focusOnShow.current = false;
    composerRef.current?.focus();
  }, [composerVisible]);
  // One line whatever the thread is called: a long name is shortened, never wrapped or cut mid-word.
  // A message sent from here goes on working out of sight, so the empty field says what it is doing now,
  // the same caption its thread shows; given the keyboard, it asks for the next thing.
  const workingElsewhere = allTabs.find((tab) => tab.status === "working" && tab.threadId !== focus?.threadId);
  const liveCaption = workingElsewhere && live?.runId === workingElsewhere.runId ? live.steps.at(-1)?.title : undefined;
  const placeholder = focus
    ? `Continue in ${shortTitle(focus.title)}`
    : workingElsewhere
      ? workingLine(liveCaption ?? workingElsewhere.caption)
      : "Ask Spectra anything";
  const focusedPlaceholder = !focus && workingElsewhere ? "Ask something else" : undefined;

  /* ------------------------------------------------------------ rail */

  const findShown = useCallback(() => elementOf(shownRef.current), [elementOf]);
  const seat = useRailSeat(shown, findShown);
  const raised = Boolean(seat) && (composerVisible || reaching);
  // The field open with the hand away: only threads in play that want attention stand (working, asking, a
  // problem, unread); the rest rise when the island is hovered or has the keyboard.
  // Three tabs or fewer always stand; so do all of them when the person asked for that.
  const settled = raised && !reaching && allTabs.length > TABS_ALWAYS_STANDING && !preferences.ai.islandTabsAlwaysShown;
  const railHas = composerVisible || allTabs.length > 0;
  // The tab rail stands over the band; the clearance follows it as it comes and goes.
  useEffect(() => refreshComposerBands(), [railHas, seat]);
  // The tab in hand: the thread whose card is open, else the thread the field writes into.
  const focusTab = focus ? allTabs.find((tab) => tab.threadId === focus.threadId) : undefined;
  const current = view?.runId ?? (composerVisible ? focusTab?.runId ?? null : null);
  const inHand = shownDone.slice(RAIL_DONE).find((tab) => tab.runId === current);
  // The tab in hand always stands on the rail, in the last place there is room for.
  const railDone = inHand ? [...shownDone.slice(0, RAIL_DONE - 1), inHand] : shownDone.slice(0, RAIL_DONE);

  /** Pressing a thread keeps it open over the island and turns the field to it: a reply is just typed. */
  const pressTab = (tab: IslandTab) => {
    markSeen(tab.runId);
    // A tab holding questions put aside gives them back first.
    if (bringBack(tab.threadId)) return;
    // A page that shows one thread changes to it.
    if (bindsThread) {
      openThread(tab.runId, tab.threadId, tab.title);
      composerRef.current?.focus();
      return;
    }
    if (view?.pinned && view.runId === tab.runId) {
      closeView();
      return;
    }
    openView(tab.runId, true);
    replyIn(tab);
  };

  const onScreen = (threadId: string) =>
    (bindsThread && slot?.focus?.threadId === threadId) || spectraBus.getQuery("side.thread")?.threadId === threadId;

  const replyIn = (tab: IslandTab) => {
    setReplyTo({ runId: tab.runId, threadId: tab.threadId, title: tab.title });
    void go("composer", { focus: true }).then(() => composerRef.current?.focus());
  };

  /** A card only shown on hover goes once the hand is off both its tab and the card. */
  const schedulePeekClose = () => {
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => {
      setView((current) => (current && !current.pinned ? null : current));
    }, PEEK_CLOSE_DELAY);
  };
  const keepPeek = () => window.clearTimeout(peekTimer.current);

  /** Opens a tab's card once the hand has rested on it, not when it only passes over. */
  const armView = (tab: IslandTab) => {
    window.clearTimeout(viewTimer.current);
    // A thread already on screen (this page's, or the Side's) needs no card over it; nor does a hand just back from a press.
    if (tabDrag.dragging || onScreen(tab.threadId) || performance.now() < quietUntil.current) return;
    viewTimer.current = window.setTimeout(() => openView(tab.runId, false), view ? VIEW_SWITCH_DELAY : VIEW_DELAY);
  };

  const railHandlers: RailHandlers = {
    onHover: (tab, point) => {
      keepPeek();
      restAnchor.current = point;
      armView(tab);
    },
    onMove: (tab, point) => {
      const anchor = restAnchor.current;
      if (anchor && Math.hypot(point.x - anchor.x, point.y - anchor.y) <= REST_SLOP) return;
      // Still moving: the wait starts again where the hand is now.
      restAnchor.current = point;
      if (!view || view.runId !== tab.runId) armView(tab);
    },
    onLeave: () => {
      window.clearTimeout(viewTimer.current);
      restAnchor.current = null;
      if (view && !view.pinned) schedulePeekClose();
    },
    onPress: (tab) => {
      if (tabDrag.consumeClick()) return;
      pressTab(tab);
    },
    onMenu: (tab, x, y) => {
      window.clearTimeout(viewTimer.current);
      if (!isPendingTab(tab.runId)) setMenu({ tab, x, y });
    },
    onPointerDown: tabDrag.onPointerDown,
  };

  return (
    <div
      data-island
      data-island-root
      data-island-status={status ?? undefined}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onPointerDownCapture={(event) => {
        // A press anywhere on the island but a tab (new thread, stop, the field) keeps the tabs under the hand from opening.
        if (!(event.target as Element).closest("[data-island-tab]")) {
          quietUntil.current = performance.now() + PRESS_QUIET_MS;
          window.clearTimeout(viewTimer.current);
        }
      }}
      onFocus={() => setReaching(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !pointerInside.current) scheduleClose();
      }}
      className={cn(
        // The island floats at the bottom centre: of the page between the columns, gliding as they change, or of the screen, staying put.
        "pointer-events-none fixed bottom-0 z-composer-dock flex flex-col items-center gap-2",
        preferences.ai.islandCentre === "screen"
          ? "left-0 right-0"
          : "left-[calc(var(--spectra-rail-width,0px)+var(--spectra-lead-width,0px))] right-[calc(var(--spectra-side-width,0px)+8px)]",
        "transition-[opacity,left,right] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
      )}
    >
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {/* The island's paper while it changes shape (shape-morph.ts). */}
      <div ref={frameRef} aria-hidden className="island-morph" />

      {justAnswered ? (
        <div className="pointer-events-auto">
          <AnsweredCard question={justAnswered.question} label={justAnswered.label} />
        </div>
      ) : question ? (
        <div className="pointer-events-auto">
          <QuestionCard
            ref={questionRef}
            question={question}
            index={Math.min(questionIndex, asking.length - 1)}
            count={asking.length}
            visible={questionShown}
            onStep={(delta) => setQuestionIndex((current) => (current + delta + asking.length) % asking.length)}
            onLater={() => putAside(question.key)}
            onActivity={questionActivity}
            onAnswer={answer}
            onOpenThread={question.threadId ? () => openThread(question.runId, question.threadId!, question.threadTitle) : undefined}
          />
        </div>
      ) : null}

      {replyPeekTab && replyPeekLine && !viewTab ? (
        <div className="pointer-events-auto -mb-1" style={{ transform: `translateX(${replyPeekOffset}px)` }}>
          <ReplyPeek
            ref={replyPeekRef}
            line={replyPeekLine}
            title={replyPeekTab.title}
            visible={replyPeekShown}
            onOpen={() => openView(replyPeekTab.runId, true)}
            onRest={() => {
              window.clearTimeout(replyPeekLife.current.rest);
              replyPeekLife.current.rest = window.setTimeout(() => openView(replyPeekTab.runId, false), PEEK_REST_MS);
            }}
            onLeave={() => window.clearTimeout(replyPeekLife.current.rest)}
            onUndo={() => {
              const card = runTabCard(replyPeekTab.source);
              if (card && engine) void engine.onCardAction(card, "revert");
              markSeen(replyPeekTab.runId);
              foldReplyPeek();
            }}
            onShow={(workId, regionId) => {
              if (isCalendarTouch(workId)) router.push(calendarTouchHref(regionId));
              else void spectraBus.command("work.open", { workId, ...(regionId ? { region: { id: regionId } } : {}) });
              markSeen(replyPeekTab.runId);
              foldReplyPeek();
            }}
          />
        </div>
      ) : null}

      {viewTab ? (
        <div className="pointer-events-auto -mb-3 pb-3 transition-transform duration-200 ease-[var(--ease-standard)]" style={{ transform: `translateX(${viewOffset}px)` }} onPointerEnter={keepPeek} onPointerLeave={() => view && !view.pinned && schedulePeekClose()}>
          <ThreadView
            ref={viewRef}
            tab={viewTab}
            engine={engine}
            visible={viewShown}
            offset={0}
            onOpenSide={() => {
              closeView();
              openThread(viewTab.runId, viewTab.threadId, viewTab.title);
            }}
            onOpenPage={() => {
              closeView();
              markSeen(viewTab.runId);
              router.push(threadHref(viewTab.threadId));
            }}
            onReply={() => {
              openView(viewTab.runId, true);
              replyIn(viewTab);
            }}
            onMinimise={closeView}
          />
        </div>
      ) : null}

      {switcher ? (
        <ThreadSwitcher
          initialQuery={switcher.query}
          scope={switcher.scope}
          onClose={closeSwitcher}
          onNewThread={() => {
            setSwitcher(null);
            compose(true);
          }}
          onChoose={(thread) => {
            setSwitcher(null);
            openThread(thread.lastRunId ?? thread._id, thread._id, thread.title);
          }}
        />
      ) : null}

      {/* The rail stands over the bar: what opens above the island makes room for it. */}
      <div ref={bandRef} className={cn("relative grid w-full place-items-end pb-4", raised && railHas && "mt-8")}>
        {seat && railHas ? (
          <IslandRail
            play={shownPlay}
            done={railDone}
            raised={raised}
            settled={settled}
            current={current}
            focusTitle={composerVisible && focus && !focusTab ? focus.title : null}
            dragging={tabDrag.dragging}
            tabRefs={tabRefs}
            dividerRef={dividerRef}
            bottom={16 + seat.height - 1}
            maxWidth={seat.width - 2 * seat.radius}
            handlers={railHandlers}
            waiting={waitingByThread}
            onKeyDown={onRailKey}
            threadsOpen={Boolean(switcher)}
            onThreads={() => setSwitcher((open) => (open ? null : {}))}
            onNew={() => {
              closeView();
              if (bindsThread) slot?.startNewThread?.();
              else setReplyTo("new");
              composerRef.current?.focus();
            }}
          />
        ) : null}

        {/* The composer. */}
        <div
          inert={!composerVisible}
          aria-hidden={!composerVisible}
          className={cn(
            "col-start-1 row-start-1 justify-self-center transition-opacity duration-150",
            composerVisible ? "pointer-events-auto opacity-100 delay-[110ms]" : "pointer-events-none opacity-0",
          )}
        >
          <IslandComposer
            ref={composerRef}
            draftKey={focus?.threadId ?? "new"}
            placeholder={placeholder}
            focusedPlaceholder={focusedPlaceholder}
            visible={composerVisible}
            busy={Boolean(focus && engine?.submitting)}
            working={Boolean(workingElsewhere)}
            onStop={engine ? () => void engine.stop() : undefined}
            onSend={send}
            onCancel={() => {
              if (view) closeView();
              if (restRef.current === "composer") (document.activeElement as HTMLElement | null)?.blur();
              else void go(restRef.current);
            }}
          />
        </div>
      </div>

      {/* The tab being dragged, lifted off the rail. */}
      {tabDrag.ghost ? createPortal(<RailGhost ghost={tabDrag.ghost} tab={allTabs.find((tab) => tab.runId === tabDrag.ghost?.runId)} ghostRef={tabDrag.ghostRef} />, document.body) : null}

      {/* A tab's context menu. */}
      <DropdownMenu open={Boolean(menu)} onOpenChange={(open) => !open && setMenu(null)} modal={false}>
        <DropdownMenuTrigger asChild>
          <span aria-hidden className="pointer-events-none fixed size-px" style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }} />
        </DropdownMenuTrigger>
        {menu ? (
          <DropdownMenuContent side="top" align="start">
            <DropdownMenuItem onSelect={() => openView(menu.tab.runId, true)}>
              <MenuGlyph name="conversations" />
              Show the thread
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openThread(menu.tab.runId, menu.tab.threadId, menu.tab.title)}>
              <MenuGlyph name="openSide" />
              Open the thread
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {menu.tab.side === "done" ? (
              <DropdownMenuItem onSelect={() => place(menu.tab, "play", play.length)}>
                <MenuGlyph name="pin" />
                Keep in play
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => place(menu.tab, "done", 0)}>
                <MenuGlyph name="collapse" />
                Put away
              </DropdownMenuItem>
            )}
            {menu.tab.status !== "working" && menu.tab.status !== "needs" ? (
              <>
                <DropdownMenuItem onSelect={() => void dismiss(menu.tab.runId)}>
                  <MenuGlyph name="clock" />
                  Move to history
                </DropdownMenuItem>
                {menu.tab.threadId ? <DeleteThreadItem threadId={menu.tab.threadId} onDeleted={() => void dismiss(menu.tab.runId)} /> : null}
              </>
            ) : null}
          </DropdownMenuContent>
        ) : null}
      </DropdownMenu>

      {/* Wake from the edge: a band along the bottom centre. */}
      {restShape === null && target === null ? (
        phoneRest ? (
          // On a phone: a faint lip at the bottom edge; a swipe up or a tap raises the island.
          <button
            type="button"
            aria-label="Show the island"
            className="spectra-island-lip pointer-events-auto absolute bottom-0 left-1/2 -translate-x-1/2"
            onClick={() => void go("composer", { focus: true })}
            onPointerDown={(event) => {
              const startY = event.clientY;
              const element = event.currentTarget;
              element.setPointerCapture(event.pointerId);
              const move = (next: PointerEvent) => {
                if (startY - next.clientY < 14) return;
                element.removeEventListener("pointermove", move);
                void go("composer", { focus: true });
              };
              element.addEventListener("pointermove", move);
              element.addEventListener("pointerup", () => element.removeEventListener("pointermove", move), { once: true });
            }}
          >
            <span aria-hidden />
          </button>
        ) : (
          <div aria-hidden className="pointer-events-auto absolute bottom-0 left-1/2 h-7 w-[360px] -translate-x-1/2" onPointerEnter={() => void go("composer")} />
        )
      ) : null}
    </div>
  );
}

/** Sends the thread to the Trash, with an undo. Moving it to history only takes it off the island. */
function DeleteThreadItem({ threadId, onDeleted }: { threadId: string; onDeleted: () => void }) {
  const placement = useTreePlacement("thread", threadId);
  const tree = useTreeActions();
  const nodeId = placement?.node.nodeId;
  if (!nodeId) return null;
  return (
    <DropdownMenuItem
      className="text-[var(--danger)]"
      onSelect={() => {
        void tree.trash([nodeId]).then(
          () => {
            spectraBus.emit("threads.changed", {});
            onDeleted();
            toast.success("Thread moved to Trash.", {
              action: {
                label: "Undo",
                onClick: () => void tree.restore([nodeId]).then(() => spectraBus.emit("threads.changed", {})),
              },
            });
          },
          () => toast.error("Could not delete this thread. Try again."),
        );
      }}
    >
      <span className="grid size-4 shrink-0 place-items-center">
        <Icon name="trash" size={16} />
      </span>
      Delete
    </DropdownMenuItem>
  );
}

function MenuGlyph({ name }: { name: IconName }) {
  return (
    <span className="grid size-4 shrink-0 place-items-center text-[var(--text-secondary)]">
      <Icon name={name} size={16} />
    </span>
  );
}

/** A dialog is open over the page: nothing rises over it. */
function dialogOpen() {
  return Boolean(document.querySelector('[role="dialog"]:not([data-island-thread]), [role="alertdialog"]'));
}
