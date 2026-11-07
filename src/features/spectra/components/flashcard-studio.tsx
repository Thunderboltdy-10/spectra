"use client";

import { useLatest, useStudioContextItems } from "./studio-context-menu";
import { useMissingAssets } from "./use-missing-assets";
import { currentTimeMs, shuffleInPlace, uniqueToken } from "@/lib/unique-token";
import {
  AlertCircle,
  Archive,
  BookOpen,
  FileDown,
  FolderPlus,
  Gauge,
  Import,
  Keyboard,
  Languages,
  Lightbulb,
  Sigma,
  Loader2,
  Maximize2,
  PanelLeft,
  PenLine,
  Play,
  Plus,
  Printer,
  RefreshCw,
  Search,
  X,
  Copy,
  ArrowUp,
  ArrowDown,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { LifeForm, LifeVerdict } from "@/components/ui/life-moments";
import { recentCause, verdictAt } from "../life/use-life";
import {
  abortArtifactImportUpload,
  beginArtifactImportOriginal,
  completeArtifactImport,
  getArtifactAssets,
  getSpectraFlashcardStudy,
  reviewSpectraFlashcard,
  revokeArtifactAsset,
  setSpectraFlashcardNote,
  uploadArtifactAsset,
  uploadArtifactImportOriginal,
  type SpectraArtifactAsset,
  type SpectraFlashcardRating,
  type SpectraFlashcardStudyState,
  type SpectraFlashcardStudyUpdate,
} from "../data/api";
import { parseDelimited } from "../sheets/model";
import type { WorkCapability } from "../work/registry";
import { OFFICE_ARCHIVE_LIMITS, readBoundedArchive } from "../../../../shared/parser-limits";
import { spectraBus } from "../events";
import { CARD_NOUNS, itemForRegion, itemInPassage, plainOfMarkup, type WorkRegion } from "../anchors/locate";
import { regionElement, useOpenAnchor, type AnchorLanding } from "../anchors/use-open-anchor";
import { deckCards } from "./artifact-studio";
import { plainTextFromStored } from "../rich-content";
import { SpectraStoredText } from "./spectra-rich-content";
import {
  arrayOfRecords,
  clozeAnswer,
  clozeParts,
  clozePrompt,
  deckStudyKey,
  id,
  record,
  type DeckCard,
  type DeckStudyItem,
} from "./artifact-content-model";
import {
  artifactBlobSha256,
  downloadDocumentBlob,
  downloadDocumentText,
} from "./artifact-studio-file-utils";
import { useStudioContract } from "./artifact-studio-shell";
import { StudioItemRail } from "./studio-item-rail";
import { CardThumbnail } from "./flashcards/card-thumbnail";
import { QuickCardEntry } from "./flashcards/quick-card-entry";
import { TypedAnswerDiff, foldForComparison } from "./flashcards/typed-answer-diff";
import { useOnceHint } from "./flashcards/use-once-hint";
import { carriedStudy, carryStudy, dropCarriedStudy } from "./flashcards/study-carry";
import { CardSheet } from "./flashcards/card-sheet";
import { cardFingerprint } from "./flashcards/card-equality";
import {
  ArtifactWorkbar,
  WorkbarItemSelector,
  contentHistoryBindings,
  type CommandBinding,
} from "./artifact-workbar";
import { projectBindingsFromIr } from "../capabilities";

/** The two ways of reading a deck without authoring it, in bar order. */
const readingViews = [
  { id: "browse", label: "Read the deck", icon: BookOpen },
  { id: "progress", label: "Your progress", icon: Gauge, requires: "submit" },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  icon: LucideIcon;
  requires?: WorkCapability;
}>;

/** Starting shapes for a new card, on the bar's Cards tab. */
const deckTemplates = [
  { kind: "concept", label: "Concept card", icon: Lightbulb },
  { kind: "language", label: "Vocabulary card", icon: Languages },
  { kind: "formula", label: "Formula card", icon: Sigma },
] as const;

/**
 * Four confidence values, four appearances. The audited build painted "not
 * rated yet" and "medium" the same amber, so the rail claimed every card had
 * been judged. Colour is never the only carrier: each dot names its state.
 */
const cardConfidence = {
  strong: { tone: "bg-[var(--success)]", label: "You find this one easy" },
  medium: {
    tone: "bg-[var(--warning)]",
    label: "You are still working on this one",
  },
  weak: { tone: "bg-[var(--danger)]", label: "This one is giving you trouble" },
  unknown: {
    tone: "border border-[var(--text-tertiary)]",
    label: "Not rated yet",
  },
} as const;

export function FlashcardStudio({
  artifactId,
  mode,
  content,
  onChange,
  aiChangedPaths = [],
  onActiveRegionChange,
  onOpenFull,
}: {
  artifactId: string;
  mode: "split" | "tab";
  /** Gives the work the whole window, when it is beside a page. */
  onOpenFull?: () => void;
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
  /**
   * Superseded by the studio contract, which resolves the same value from
   * `work/registry` permissions. Kept so the shell's call site keeps type
   * checking; read `contract.can("edit")` instead of this.
   */
  readOnly?: boolean;
  onActiveRegionChange?: (regionId: string) => void;
}) {
  const [cards, setCards] = useState(() => deckCards(content));
  const [activeCardId, setActiveCardId] = useState(cards[0]?.id ?? "");
  const [activeSection, setActiveSection] = useState(
    cards[0]?.section ?? "Section 1",
  );
  const [deckSearch, setDeckSearch] = useState("");
  const [draggedCardId, setDraggedCardId] = useState<string>();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /**
   * Capability truth comes from the shell contract, which derives it from
   * `work/registry` permissions — never from the pane's width and never from a
   * local guess. `canEdit` gates every mutating affordance in this file, so a
   * read-only viewer is not offered a control the registry denies them (an
   * inert affordance is a defect) while an owner in a 560px split panel keeps
   * all of them (CANON D1/D4).
   */
  const contract = useStudioContract();
  const canEdit = contract.can("edit");
  const canStudy = contract.can("attempt");
  /**
   * `submit` is the deck's recording step. Entering a session and turning cards
   * over is `attempt`; committing a graded review to the server, which moves the
   * card's schedule and this person's progress, is `submit`. Without it the
   * session still runs as practice and says so, rather than grading into nothing
   * and showing intervals that were never scheduled.
   */
  const canRecordStudy = contract.can("submit");
  /**
   * The registry declares four modes for a deck, and none of them is a peer tab.
   * `build` is authoring, which is where an owner always starts (D1); `study` is
   * an activity with its own session and exit, so it is the bar's primary verb;
   * `browse` and `progress` are ways of reading the same deck, so they are
   * toggles in the bar that turn themselves off again (D2/D3). The registry is
   * still the authority on which of them exist for this viewer: a reader with no
   * `edit` never gets `build`, so they open in `browse` rather than in an
   * authoring surface they cannot use.
   */
  const deckViewModes = contract.modes.filter((entry) => entry.id !== "study");
  const hasView = (id: string) =>
    deckViewModes.some((entry) => entry.id === id);
  const [studioView, setStudioView] = useState(
    () => deckViewModes[0]?.id ?? "browse",
  );
  // A viewer who loses `edit` mid-session must not be left on a surface the
  // registry no longer grants them.
  const activeView = hasView(studioView)
    ? studioView
    : (deckViewModes[0]?.id ?? "browse");
  const [previewRevealed, setPreviewRevealed] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(mode === "split");
  // A session opened full from the side panel picks up on the same card.
  const [carried] = useState(() => carriedStudy(artifactId));
  useEffect(() => dropCarriedStudy(artifactId), [artifactId]);
  const [studyOpen, setStudyOpen] = useState(Boolean(carried));
  const [studyRevealed, setStudyRevealed] = useState(carried?.revealed ?? false);
  const [studyIndex, setStudyIndex] = useState(carried?.index ?? 0);
  const [studyQueue, setStudyQueue] = useState<DeckStudyItem[]>(carried?.queue ?? []);
  const [studyComplete, setStudyComplete] = useState(carried?.complete ?? false);
  const [studyCardStartedAt, setStudyCardStartedAt] = useState(() => (carried ? currentTimeMs() : 0));
  const [studyClock, setStudyClock] = useState(0);
  const [studyReviewBusy, setStudyReviewBusy] = useState(false);
  const [studyError, setStudyError] = useState<string>();
  const [studyTypedAnswer, setStudyTypedAnswer] = useState(carried?.typedAnswer ?? "");
  const [studyTypedCorrect, setStudyTypedCorrect] = useState<boolean | undefined>(carried?.typedCorrect);
  /** The learner's own choice to type answers, over the deck's default. */
  const [studyTypingChoice, setStudyTypingChoice] = useState<boolean | undefined>(carried?.typingChoice);
  const [studyNoteDraft, setStudyNoteDraft] = useState("");
  const [studyNoteSaving, setStudyNoteSaving] = useState(false);
  const [studyShortcutsOpen, setStudyShortcutsOpen] = useState(false);
  const studyNoteRef = useRef<HTMLTextAreaElement>(null);
  const [studyRatings, setStudyRatings] = useState<
    Record<SpectraFlashcardRating, number>
  >(carried?.ratings ?? { again: 0, hard: 0, good: 0, easy: 0 });
  const [studyStates, setStudyStates] = useState<
    Map<string, SpectraFlashcardStudyState>
  >(() => new Map());
  const [studyUpdate, setStudyUpdate] = useState<SpectraFlashcardStudyUpdate>();
  const [studyUpdateDismissed, setStudyUpdateDismissed] = useState(false);
  const [studyStateLoading, setStudyStateLoading] = useState(true);
  const [deckImportReport, setDeckImportReport] = useState<string>();
  const [deckImportError, setDeckImportError] = useState<string>();
  const [deckActionError, setDeckActionError] = useState<string>();
  const [deckAssets, setDeckAssets] = useState<SpectraArtifactAsset[]>([]);
  const [deckMediaBusy, setDeckMediaBusy] = useState(false);
  const [deckMediaError, setDeckMediaError] = useState<string>();

  useEffect(() => {
    const reveal = (detail: { workId: string; path?: string }) => {
      if (detail.workId !== artifactId || !detail.path) return;
      const match = detail.path.match(/^\/cards\/(\d+)(?:\/|$)/);
      if (!match) return;
      const index = Number(match[1]);
      const card = cards[index];
      if (card) setActiveCardId(card.id);
      if (
        /\/(?:variant|difficulty|confidence|section|language|media|explanation|acceptedAlternatives|learningObjective|sourceRefs|bidirectional)(?:\/|$)/.test(
          detail.path,
        )
      )
        setAdvancedOpen(true);
    };
    return spectraBus.handle("work.reveal", reveal);
  }, [artifactId, cards]);
  // Opened at a card (a search hit, a citation): show it, then land on it.
  const cardsView = deckViewModes.find((entry) => entry.id !== "progress")?.id ?? "browse";
  const landOnCard = useCallback(
    (region: WorkRegion): AnchorLanding | null => {
      const named = itemForRegion(cards, region, CARD_NOUNS);
      if (!named) return null;
      const card =
        itemInPassage(cards, cards.indexOf(named), (entry) =>
          [entry.front, entry.back, entry.hint, entry.explanation].map(plainOfMarkup).join(" "),
        region.excerpt) ?? named;
      return {
        select: () => {
          setActiveCardId(card.id);
          if (card.section) setActiveSection(card.section);
          if (activeView === "progress") setStudioView(cardsView);
        },
        find: (root) => regionElement(root, card.id),
      };
    },
    [activeView, cards, cardsView],
  );
  useOpenAnchor(artifactId, landOnCard);
  const [maskDraft, setMaskDraft] = useState<{
    x: number;
    y: number;
    currentX: number;
    currentY: number;
  }>();
  const [cardEditBaseline, setCardEditBaseline] = useState<
    DeckCard | undefined
  >(undefined);
  const [baselineCardId, setBaselineCardId] = useState<string | undefined>(
    undefined,
  );
  const deckMediaInputRef = useRef<HTMLInputElement>(null);
  const studioRef = useRef<HTMLDivElement>(null);
  const focusCardIdRef = useRef<string>(undefined);
  const sections = useMemo(
    () => Array.from(new Set(cards.map((card) => card.section || "Section 1"))),
    [cards],
  );
  const activeCard = cards.find((card) => card.id === activeCardId) ?? cards[0];
  const activeCardIndex = Math.max(
    0,
    cards.findIndex((card) => card.id === activeCard?.id),
  );
  /**
   * Adding a card is the deck editor's hot path: 28 cards is 28 trips between a
   * button and a field. A new card takes the caret into its own front side, and
   * Ctrl or Cmd with Enter from either side creates the next one, so a whole
   * sitting can be typed without reaching for the pointer. The rich text editor
   * owns its own DOM, so the caret is placed through the face's `data-card-face`
   * hook rather than by threading a ref through the shared primitive.
   */
  useEffect(() => {
    if (!focusCardIdRef.current || focusCardIdRef.current !== activeCard?.id)
      return;
    focusCardIdRef.current = undefined;
    studioRef.current
      ?.querySelector<HTMLElement>(
        '[data-card-face="front"] [contenteditable="true"], [data-card-face="front"] textarea',
      )
      ?.focus();
  }, [activeCard?.id]);
  useEffect(() => {
    setPreviewRevealed(false);
  }, [activeCardId, activeView]);
  const advancedAiPath = aiChangedPaths.find((path) =>
    /^\/cards\/\d+\/(?:variant|difficulty|confidence|section|language|media|explanation|acceptedAlternatives|learningObjective|sourceRefs|bidirectional)(?:\/|$)/.test(
      path,
    ),
  );
  const deckSettings = record(record(content).settings);
  const studyTyping = studyTypingChoice ?? deckSettings.revealMode === "type";
  const activeDeckMedia = activeCard?.media
    ? deckAssets.find((asset) => asset.assetId === activeCard.media?.assetId)
    : undefined;
  useEffect(() => {
    if (activeCard && baselineCardId !== activeCard.id) {
      setBaselineCardId(activeCard.id);
      setCardEditBaseline(structuredClone(activeCard));
    }
  }, [activeCard, baselineCardId]);
  const activeCardDirty = Boolean(
    activeCard &&
    cardEditBaseline &&
    cardFingerprint(activeCard) !== cardFingerprint(cardEditBaseline),
  );
  const duplicateKeys = new Set(
    Array.from(
      cards.reduce((counts, card) => {
        // Blank cards are unfinished, not duplicates of one another.
        if (!card.front.trim() && !card.back.trim()) return counts;
        const key = `${card.front.trim().toLocaleLowerCase()}|${card.back.trim().toLocaleLowerCase()}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return counts;
      }, new Map<string, number>()),
    )
      .filter(([, count]) => count > 1)
      .map(([key]) => key),
  );
  const filteredCards = cards.filter((card) => {
    const query = deckSearch.trim().toLocaleLowerCase();
    if (
      query &&
      !`${card.front} ${card.back} ${card.hint ?? ""} ${card.explanation ?? ""} ${card.section ?? ""} ${(card.tags ?? []).join(" ")}`
        .toLocaleLowerCase()
        .includes(query)
    )
      return false;
    return true;
  });
  const studyCards = cards.filter(
    (card) =>
      card.front.trim() &&
      card.back.trim() &&
      (card.variant !== "cloze" || clozeParts(card.front).length > 0) &&
      (card.variant !== "image_occlusion" ||
        (Boolean(card.media) && (card.occlusions?.length ?? 0) > 0)),
  );
  const studyItems = studyCards.flatMap((card): DeckStudyItem[] => [
    { cardId: card.id, direction: "forward" },
    ...(card.bidirectional === true && card.variant === "basic"
      ? [{ cardId: card.id, direction: "reverse" as const }]
      : []),
  ]);
  const dueStudyCount = studyItems.filter((item) => {
    const state = studyStates.get(deckStudyKey(item.cardId, item.direction));
    return !state || state.nextDueAt <= studyClock;
  }).length;
  const personalMastery = studyItems.length
    ? Math.round(
        (studyItems.reduce((total, item) => {
          const state = studyStates.get(
            deckStudyKey(item.cardId, item.direction),
          );
          if (!state) return total;
          return (
            total +
            Math.min(
              1,
              state.stabilityDays >= 21 ? 1 : state.stabilityDays / 21,
            )
          );
        }, 0) /
          studyItems.length) *
          100,
      )
    : 0;
  // What the deck's edits did to this person's progress, in their terms. Cards
  // whose answer changed are due again; progress for cards that left the deck is
  // kept in case they come back (§11B).
  const deckUpdateNotice = (() => {
    if (studyUpdateDismissed || studyStateLoading || !studyUpdate) return "";
    const changed = studyUpdate.changedCardIds.length;
    const retained = studyUpdate.retainedCardIds.length;
    if (!changed && !retained) return "";
    const parts: string[] = [];
    if (changed)
      parts.push(
        `${changed} card${changed === 1 ? "" : "s"} you studied changed answer, so ${changed === 1 ? "it is" : "they are"} due again`,
      );
    if (retained)
      parts.push(
        `${retained} card${retained === 1 ? "" : "s"} left the deck, and your progress is kept in case ${retained === 1 ? "it returns" : "they return"}`,
      );
    return `${parts.join(". ")}.`;
  })();
  /**
   * Progress mode reads only personal study state. A card's own difficulty
   * label is the author's opinion; these bands are the learner's own record.
   */
  const deckProgressRows = studyItems
    .map((item) => {
      const state = studyStates.get(deckStudyKey(item.cardId, item.direction));
      const card = studyCards.find((entry) => entry.id === item.cardId);
      const now = studyClock || currentTimeMs();
      const band = !state
        ? "new"
        : state.changedSinceStudied
          ? "changed"
          : state.lapses > 1 || state.ease < 2.1
            ? "shaky"
            : state.stabilityDays >= 21
              ? "known"
              : "learning";
      const dueIn = (state?.nextDueAt ?? now) - now;
      return {
        cardId: item.cardId,
        direction: item.direction,
        band,
        prompt:
          (item.direction === "reverse" ? card?.back : card?.front)?.trim() ||
          "Untitled card",
        dueLabel:
          band === "changed"
            ? "Answer changed"
            : !state
              ? "Not studied"
              : dueIn <= 0
                ? "Due now"
                : dueIn < 3_600_000
                  ? `${Math.max(1, Math.round(dueIn / 60_000))} min`
                  : dueIn < 86_400_000
                    ? `${Math.round(dueIn / 3_600_000)} hr`
                    : `${Math.round(dueIn / 86_400_000)} d`,
        sortKey: state?.nextDueAt ?? 0,
      };
    })
    .sort((left, right) => left.sortKey - right.sortKey);
  const deckProgressBands = (
    [
      ["new", "Not studied"],
      ["learning", "Learning"],
      ["shaky", "Shaky"],
      ["known", "Known"],
      ["changed", "Answer changed"],
    ] as const
  ).map(([key, label]) => ({
    key,
    label,
    count: deckProgressRows.filter((entry) => entry.band === key).length,
  }));
  const activeStudyItem = studyQueue[studyIndex];
  const activeStudyCard = activeStudyItem
    ? studyCards.find((card) => card.id === activeStudyItem.cardId)
    : undefined;
  const deckImportRef = useRef<HTMLInputElement>(null);

  // The note follows the card, not the session, so moving between cards shows
  // the note that belongs to the one on screen.
  const activeStudyNote = activeStudyItem
    ? (studyStates.get(
        deckStudyKey(activeStudyItem.cardId, activeStudyItem.direction),
      )?.note ?? "")
    : "";
  useEffect(() => {
    setStudyNoteDraft(activeStudyNote);
  }, [activeStudyNote]);

  useEffect(() => {
    const nextCards = deckCards(content);
    setCards(nextCards);
    setActiveCardId((current) =>
      nextCards.some((card) => card.id === current)
        ? current
        : (nextCards[0]?.id ?? ""),
    );
  }, [content]);

  useEffect(() => {
    let active = true;
    setStudyStateLoading(true);
    void getSpectraFlashcardStudy(artifactId)
      .then((result) => {
        if (!active) return;
        setStudyStates(
          new Map(
            result.states.map((state) => [
              deckStudyKey(state.cardId, state.direction),
              state,
            ]),
          ),
        );
        setStudyUpdate(result.update);
        setStudyError(undefined);
      })
      .catch((error) => {
        if (!active) return;
        setStudyError(
          error instanceof Error
            ? error.message
            : "Private study progress could not be loaded.",
        );
      })
      .finally(() => {
        if (active) setStudyStateLoading(false);
      });
    return () => {
      active = false;
    };
  }, [artifactId]);

  const beginStudySession = () => {
    const now = currentTimeMs();
    const due = studyItems.filter((item) => {
      const state = studyStates.get(deckStudyKey(item.cardId, item.direction));
      return !state || state.nextDueAt <= now;
    });
    const dueKeys = new Set(
      due.map((item) => deckStudyKey(item.cardId, item.direction)),
    );
    const future = studyItems
      .filter((item) => !dueKeys.has(deckStudyKey(item.cardId, item.direction)))
      .sort(
        (left, right) =>
          (studyStates.get(deckStudyKey(left.cardId, left.direction))
            ?.nextDueAt ?? Number.MAX_SAFE_INTEGER) -
          (studyStates.get(deckStudyKey(right.cardId, right.direction))
            ?.nextDueAt ?? Number.MAX_SAFE_INTEGER),
      );
    const candidates = due.length ? due : future;
    const shuffle = deckSettings.shuffle !== false;
    const queue = [...candidates];
    if (shuffle) shuffleInPlace(queue);
    setStudyQueue(queue);
    setStudyIndex(0);
    setStudyRevealed(false);
    setStudyTypedAnswer("");
    setStudyTypedCorrect(undefined);
    setStudyComplete(false);
    setStudyRatings({ again: 0, hard: 0, good: 0, easy: 0 });
    setStudyCardStartedAt(now);
    setStudyClock(now);
    setStudyError(undefined);
    setStudyOpen(true);
  };
  // Study stays inside Spectra: in the side panel first, and full only through
  // the work's own Open full, never the browser's fullscreen.
  const closeStudySession = () => setStudyOpen(false);
  const [spaceHintSeen, markSpaceHintSeen] = useOnceHint("spectra.study-space-hint");
  // Escape stays on the dialog's own key handler; the hook moves focus into
  // the session, keeps Tab inside it and returns focus when it closes.
  const studyDialogRef = useRef<HTMLDivElement>(null);
  // The session sits in the deck, not over the app, so it takes focus without
  // trapping it: Tab still reaches the rail and the tabs beside it.
  const studyShown = studyOpen && studyQueue.length > 0;
  useEffect(() => {
    if (!studyShown) return;
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    studyDialogRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [studyShown]);
  const beginStudySessionRef = useRef(beginStudySession);
  useEffect(() => {
    beginStudySessionRef.current = beginStudySession;
  });

  useEffect(() => {
    function beginFromInspector({ workId }: { workId: string }) {
      if (workId === artifactId) beginStudySessionRef.current();
    }
    return spectraBus.handle("deck.study", beginFromInspector);
  }, [artifactId]);

  useEffect(() => {
    let active = true;
    void getArtifactAssets(artifactId)
      .then((result) => {
        if (active) setDeckAssets(result.assets);
      })
      .catch((error) => {
        if (!active) return;
        setDeckMediaError(
          error instanceof Error
            ? error.message
            : "Card media could not be loaded.",
        );
      });
    return () => {
      active = false;
    };
  }, [artifactId]);

  // The deck as it is now. An upload or import finishes after an await, when
  // the render that started it holds stale cards; building on those would
  // silently drop every card edit made meanwhile, collaborators' included.
  const latestDeckRef = useRef({ content, cards });
  latestDeckRef.current = { content, cards };
  useMissingAssets(
    cards.flatMap((card) => (card.media?.assetId ? [card.media.assetId] : [])),
    new Set(deckAssets.map((asset) => asset.assetId)),
    () => getArtifactAssets(artifactId).then((result) => setDeckAssets(result.assets)),
  );

  function commit(nextCards: DeckCard[]) {
    const latestContent = latestDeckRef.current.content;
    latestDeckRef.current = { content: latestContent, cards: nextCards };
    setCards(nextCards);
    onChange({
      ...record(latestContent),
      cards: nextCards,
      settings: record(latestContent).settings ?? {
        shuffle: true,
        revealMode: "click",
      },
    });
  }

  function updateCard(cardId: string, patch: Partial<DeckCard>) {
    commit(
      latestDeckRef.current.cards.map((card) =>
        card.id === cardId ? { ...card, ...patch } : card,
      ),
    );
  }

  function deckMediaUrl(card: DeckCard) {
    return card.media
      ? deckAssets.find((asset) => asset.assetId === card.media?.assetId)
          ?.downloadUrl
      : undefined;
  }

  async function uploadDeckMedia(file: File) {
    if (!activeCard) return;
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.type,
      )
    ) {
      setDeckMediaError("Choose a PNG, JPEG, WebP, or GIF image.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setDeckMediaError("Card images must be 25 MB or smaller.");
      return;
    }
    setDeckMediaBusy(true);
    setDeckMediaError(undefined);
    try {
      const uploaded = await uploadArtifactAsset({
        artifactId,
        path: `flashcards/${activeCard.id}/${Date.now().toString(36)}-${file.name}`,
        name: file.name,
        mediaType: file.type,
        sha256: await artifactBlobSha256(file),
        blob: file,
      });
      updateCard(activeCard.id, {
        ...(activeCard.variant === "image_occlusion"
          ? { bidirectional: false }
          : {}),
        media: {
          assetId: uploaded.assetId,
          name: file.name,
          mediaType: file.type,
          altText: "",
          placement: activeCard.media?.placement ?? "front",
        },
        ...(activeCard.variant === "image_occlusion" ? { occlusions: [] } : {}),
      });
      const refreshed = await getArtifactAssets(artifactId);
      setDeckAssets(refreshed.assets);
    } catch (error) {
      setDeckMediaError(
        error instanceof Error
          ? error.message
          : "The card image could not be added.",
      );
    } finally {
      setDeckMediaBusy(false);
      if (deckMediaInputRef.current) deckMediaInputRef.current.value = "";
    }
  }

  // Removing an image or a card never releases its asset: undo and History
  // restore bring it back, and every retained version still references it.
  // Assets are released with the artifact.
  function removeDeckMedia() {
    if (!activeCard?.media || deckMediaBusy) return;
    setDeckMediaError(undefined);
    updateCard(activeCard.id, {
      media: undefined,
      occlusions: [],
      ...(activeCard.variant === "image_occlusion"
        ? { variant: "basic" as const }
        : {}),
    });
  }

  function maskPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)),
      ),
      y: Math.max(
        0,
        Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height)),
      ),
    };
  }

  function beginMask(event: ReactPointerEvent<HTMLDivElement>) {
    if (!activeCard?.media || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = maskPoint(event);
    setMaskDraft({ ...point, currentX: point.x, currentY: point.y });
  }

  function moveMask(event: ReactPointerEvent<HTMLDivElement>) {
    if (!maskDraft) return;
    const point = maskPoint(event);
    setMaskDraft((current) =>
      current ? { ...current, currentX: point.x, currentY: point.y } : current,
    );
  }

  function finishMask(event: ReactPointerEvent<HTMLDivElement>) {
    if (!activeCard || !maskDraft) return;
    const point = maskPoint(event);
    const x = Math.min(maskDraft.x, point.x);
    const y = Math.min(maskDraft.y, point.y);
    const width = Math.abs(point.x - maskDraft.x);
    const height = Math.abs(point.y - maskDraft.y);
    setMaskDraft(undefined);
    if (width < 0.025 || height < 0.025) return;
    updateCard(activeCard.id, {
      occlusions: [
        ...(activeCard.occlusions ?? []),
        { id: id("mask"), x, y, width, height, label: "" },
      ],
    });
  }

  const cardVerbs = useLatest({ addCard, nudgeCard, commit, cards, activeSection });
  useStudioContextItems(({ target }) => {
    const cardId = target.closest("[data-studio-item]")?.getAttribute("data-studio-item");
    if (!cardId || !canEdit) return null;
    return [[
      { key: "card-new", label: "New card", icon: Plus, onSelect: () => cardVerbs.current.addCard() },
      {
        key: "card-copy",
        label: "Duplicate card",
        icon: Copy,
        onSelect: () => {
          const { cards: current, commit: save } = cardVerbs.current;
          const at = current.findIndex((card) => card.id === cardId);
          if (at < 0) return;
          const copy = { ...structuredClone(current[at]!), id: id("card") };
          const next = [...current];
          next.splice(at + 1, 0, copy);
          save(next);
          setActiveCardId(copy.id);
        },
      },
      { key: "card-up", label: "Move up", icon: ArrowUp, onSelect: () => cardVerbs.current.nudgeCard(cardId, -1) },
      { key: "card-down", label: "Move down", icon: ArrowDown, onSelect: () => cardVerbs.current.nudgeCard(cardId, 1) },
      {
        key: "card-delete",
        label: "Delete card",
        icon: Trash2,
        danger: true,
        onSelect: () => {
          const { cards: current, commit: save, activeSection: section } = cardVerbs.current;
          const next = current.filter((card) => card.id !== cardId);
          const replacement = next.length ? next : [{ id: id("card"), front: "", back: "", hint: "", section, confidence: 0 }];
          save(replacement as typeof current);
          setActiveCardId((active) => (active === cardId ? replacement[0]!.id : active));
        },
      },
    ]];
  });
  function addCard(section = activeSection) {
    const card = {
      id: id("card"),
      variant: "basic" as const,
      front: "",
      back: "",
      hint: "",
      explanation: "",
      section,
      confidence: "unknown" as const,
      difficulty: "medium" as const,
    };
    commit([...cards, card]);
    setActiveCardId(card.id);
    setActiveSection(section);
    focusCardIdRef.current = card.id;
  }

  /** A card written in the quick entry joins the open card's section and
   *  leaves the open card open. */
  function appendCard(front: string, back: string) {
    commit([
      ...cards,
      {
        id: id("card"),
        variant: "basic" as const,
        front,
        back,
        hint: "",
        explanation: "",
        section: activeSection,
        confidence: "unknown" as const,
        difficulty: "medium" as const,
      },
    ]);
  }

  function reorderCard(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const dragged = cards.find((card) => card.id === draggedId);
    const target = cards.find((card) => card.id === targetId);
    if (!dragged || !target) return;
    const next = cards.filter((card) => card.id !== draggedId);
    const targetIndex = next.findIndex((card) => card.id === targetId);
    next.splice(targetIndex, 0, { ...dragged, section: target.section });
    commit(next);
    setActiveSection(target.section ?? "Section 1");
    setDraggedCardId(undefined);
  }

  /**
   * Order is content, so it has to be reachable without a pointer: dragging is
   * the only reorder affordance a mouse user needs and the only one a keyboard
   * user cannot use at all. Alt+Arrow moves the focused card one place and keeps
   * focus on the row, so a run of moves is one held modifier.
   */
  function nudgeCard(cardId: string, direction: -1 | 1) {
    const index = cards.findIndex((card) => card.id === cardId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= cards.length) return;
    const next = [...cards];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    // Crossing a section boundary adopts the neighbour's section, which is the
    // same rule dragging follows.
    next.splice(target, 0, {
      ...moved,
      section: cards[target]?.section ?? moved.section,
    });
    commit(next);
    setActiveCardId(cardId);
  }

  async function importCards(file: File) {
    setDeckImportError(undefined);
    setDeckImportReport(undefined);
    let importJobId: string | undefined;
    const uploadedPackageAssetIds: string[] = [];
    try {
      if (file.size > 30 * 1024 * 1024)
        throw new Error(
          "This deck exceeds the 30 MB technical safety ceiling.",
        );
      const extension = file.name.split(".").pop()?.toLocaleLowerCase() ?? "";
      const beginning = await beginArtifactImportOriginal({
        artifactId,
        typeKey: "flashcard_deck",
        format: extension || "unknown",
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: file.size,
        sha256: await artifactBlobSha256(file),
      });
      importJobId = beginning.jobId;
      await uploadArtifactImportOriginal(importJobId, file);
      if (extension === "apkg") {
        const [{ default: initSqlJs }, { strFromU8 }] =
          await Promise.all([import("sql.js"), import("fflate")]);
        const archive = (await readBoundedArchive(
          new Uint8Array(await file.arrayBuffer()),
          {
            ...OFFICE_ARCHIVE_LIMITS,
            maxEntries: 256,
            maxExpandedBytes: 120 * 1024 * 1024,
            maxWorkBytes: 150 * 1024 * 1024,
          },
        )).entries;
        const databaseBytes =
          archive["collection.anki21"] ??
          archive["collection.anki2"] ??
          archive["collection.anki21b"];
        if (!databaseBytes)
          throw new Error(
            "The Anki package does not contain a supported collection database.",
          );
        const SQL = await initSqlJs({
          locateFile: () => "/vendor/sql-wasm.wasm",
        });
        const database = new SQL.Database(databaseBytes);
        try {
          const collectionRows = database.exec(
            "SELECT decks, models FROM col LIMIT 1",
          );
          const collectionValues = collectionRows[0]?.values[0];
          const decks =
            typeof collectionValues?.[0] === "string"
              ? (JSON.parse(collectionValues[0]) as Record<
                  string,
                  { name?: string }
                >)
              : {};
          const models =
            typeof collectionValues?.[1] === "string"
              ? (JSON.parse(collectionValues[1]) as Record<
                  string,
                  {
                    type?: number;
                    flds?: Array<{ name?: string; ord?: number }>;
                  }
                >)
              : {};
          const query = database.exec(
            "SELECT n.id, n.mid, n.flds, n.tags, MIN(c.did) AS did FROM notes n LEFT JOIN cards c ON c.nid = n.id GROUP BY n.id, n.mid, n.flds, n.tags ORDER BY n.id LIMIT 500",
          );
          const values = query[0]?.values ?? [];
          const htmlToStudyText = (source: string) => {
            const document = new DOMParser().parseFromString(
              source
                .replace(/\[sound:([^\]]+)\]/gi, " [Audio: $1] ")
                .replace(
                  /<img\b([^>]*?)\bsrc=(?:"([^"]+)"|'([^']+)'|([^\s>]+))([^>]*)>/gi,
                  (_match, _before, double, single, bare) =>
                    ` [Image: ${double || single || bare || "embedded"}] `,
                )
                .replace(/<br\s*\/?>/gi, "\n"),
              "text/html",
            );
            return (document.body.textContent ?? "")
              .replace(/\u00a0/g, " ")
              .replace(/[ \t]+\n/g, "\n")
              .replace(/\n{3,}/g, "\n\n")
              .replace(/[ \t]{2,}/g, " ")
              .trim();
          };
          const imported = values.flatMap((row, index): DeckCard[] => {
            const modelId = String(row[1] ?? "");
            const rawFields =
              typeof row[2] === "string" ? row[2].split("\u001f") : [];
            const model = models[modelId] ?? {};
            const fields = [...(model.flds ?? [])].sort(
              (left, right) => (left.ord ?? 0) - (right.ord ?? 0),
            );
            const names = fields.map((field) =>
              (field.name ?? "").toLocaleLowerCase(),
            );
            const findField = (candidates: RegExp, fallback: number) => {
              const found = names.findIndex((name) => candidates.test(name));
              return found >= 0 ? found : fallback;
            };
            const cloze = model.type === 1;
            const frontIndex = cloze
              ? findField(/^(?:text|cloze|sentence|content)$/, 0)
              : findField(/^(?:front|question|prompt|term|word)$/, 0);
            const backIndex = cloze
              ? findField(/^(?:extra|back|explanation|notes?)$/, 1)
              : findField(/^(?:back|answer|response|definition|meaning)$/, 1);
            const front = htmlToStudyText(rawFields[frontIndex] ?? "");
            const secondary = htmlToStudyText(rawFields[backIndex] ?? "");
            const back = cloze
              ? [clozeAnswer(front), secondary]
                  .filter(Boolean)
                  .filter((value, valueIndex, all) =>
                    valueIndex === 0 ? true : value !== all[0],
                  )
                  .join("\n\n")
              : secondary;
            if (!front || !back) return [];
            const deckId = String(row[4] ?? "");
            const section =
              decks[deckId]?.name?.replaceAll("::", " / ") || "Imported";
            return [
              {
                id: id(`anki-${index + 1}`),
                variant: cloze ? "cloze" : "basic",
                front,
                back,
                hint: "",
                explanation: "",
                acceptedAlternatives: [],
                section,
                tags:
                  typeof row[3] === "string"
                    ? row[3].trim().split(/\s+/).filter(Boolean).slice(0, 8)
                    : [],
                confidence: "unknown",
                difficulty: "medium",
                bidirectional: false,
              },
            ];
          });
          const existingKeys = new Set(
            cards.map(
              (card) =>
                `${card.front.trim().toLocaleLowerCase()}|${card.back.trim().toLocaleLowerCase()}`,
            ),
          );
          const importedKeys = new Set<string>();
          const unique = imported.filter((card) => {
            const key = `${card.front.trim().toLocaleLowerCase()}|${card.back.trim().toLocaleLowerCase()}`;
            if (existingKeys.has(key) || importedKeys.has(key)) return false;
            importedKeys.add(key);
            return true;
          });
          if (!unique.length)
            throw new Error(
              "No new Anki notes contained a usable front and back pair.",
            );
          let packagedMediaCount = 0;
          if (archive.media) {
            try {
              const mediaMap = JSON.parse(strFromU8(archive.media)) as Record<
                string,
                string
              >;
              packagedMediaCount = Object.keys(mediaMap).length;
            } catch {
              packagedMediaCount = 0;
            }
          }
          await completeArtifactImport({
            jobId: importJobId,
            typeKey: "flashcard_deck",
            status: "imported",
            fidelityReport: [
              {
                scope: "note fields, cloze syntax, tags, and deck sections",
                level: "adapted",
                message: `${unique.length} Anki notes were converted into editable Spectra cards.`,
              },
              {
                scope: "scheduler and review history",
                level: "adapted",
                message:
                  "Anki scheduling was intentionally kept separate; the imported deck starts with private Spectra scheduling.",
              },
              ...(packagedMediaCount
                ? [
                    {
                      scope: "Anki media and templates",
                      level: "unsupported" as const,
                      message: `${packagedMediaCount} packaged media files remain in the retained original. Media references are labelled in card text, but custom HTML/CSS templates and executable add-on behavior were not imported.`,
                    },
                  ]
                : []),
            ],
            unsupportedFeatures: [
              "custom Anki HTML/CSS templates",
              "add-on behavior",
              ...(packagedMediaCount
                ? ["packaged audio and image binaries"]
                : []),
            ],
            importedContent: { cards: unique },
          });
          commit([...latestDeckRef.current.cards, ...unique]);
          setActiveCardId(unique[0]!.id);
          setActiveSection(unique[0]!.section ?? "Imported");
          setDeckImportReport(
            `${unique.length} Anki cards imported with their original package retained for recovery.`,
          );
          return;
        } finally {
          database.close();
        }
      }
      if (
        extension === "zip" ||
        extension === "spectra-deck" ||
        file.name.toLocaleLowerCase().endsWith(".spectra-deck.zip")
      ) {
        const { strFromU8 } = await import("fflate");
        const archive = (await readBoundedArchive(
          new Uint8Array(await file.arrayBuffer()),
          {
            ...OFFICE_ARCHIVE_LIMITS,
            maxEntries: 256,
            maxExpandedBytes: 120 * 1024 * 1024,
            maxWorkBytes: 150 * 1024 * 1024,
          },
        )).entries;
        const entries = Object.entries(archive);
        const uncompressedBytes = entries.reduce(
          (total, [, bytes]) => total + bytes.length,
          0,
        );
        if (entries.length > 256 || uncompressedBytes > 120 * 1024 * 1024)
          throw new Error(
            "The deck package expands beyond the safe file or size ceiling and was quarantined.",
          );
        const manifestBytes = archive["manifest.json"];
        if (!manifestBytes)
          throw new Error(
            "This ZIP is not a Spectra flashcard package because manifest.json is missing.",
          );
        const manifest = JSON.parse(strFromU8(manifestBytes)) as Record<
          string,
          unknown
        >;
        if (
          manifest.format !== "spectra-flashcard-deck" ||
          manifest.version !== 1
        )
          throw new Error(
            "This deck package uses an unsupported format or version.",
          );
        const manifestContent = record(manifest.content);
        const rawCards = arrayOfRecords(manifestContent.cards);
        if (!rawCards.length || rawCards.length > 500)
          throw new Error(
            "The package must contain between 1 and 500 flashcards.",
          );
        const mediaTypes: Record<string, string> = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          webp: "image/webp",
          gif: "image/gif",
        };
        const importedCards: DeckCard[] = [];
        for (const [index, rawCard] of rawCards.entries()) {
          const normalized = deckCards({ cards: [rawCard] })[0]!;
          if (!normalized.front.trim() || !normalized.back.trim())
            throw new Error(
              `Card ${index + 1} is missing its front or back content.`,
            );
          const nextCardId = id(`card-${index + 1}`);
          const rawMedia = record(rawCard.media);
          const packagePath =
            typeof rawMedia.packagePath === "string"
              ? rawMedia.packagePath.replaceAll("\\", "/")
              : "";
          let media: DeckCard["media"];
          if (packagePath) {
            if (
              !/^media\/[a-z0-9._/-]+$/i.test(packagePath) ||
              packagePath.includes("..")
            )
              throw new Error(
                `Card ${index + 1} contains an unsafe media path.`,
              );
            const bytes = archive[packagePath];
            const extension = packagePath.split(".").pop()?.toLocaleLowerCase();
            const mediaType = extension ? mediaTypes[extension] : undefined;
            if (!bytes || !mediaType || bytes.length > 25 * 1024 * 1024)
              throw new Error(
                `Card ${index + 1} has missing, unsupported, or oversized media.`,
              );
            const name =
              typeof rawMedia.name === "string"
                ? rawMedia.name
                : packagePath.split("/").pop() || `card-${index + 1}`;
            const blob = new Blob([bytes as BlobPart], { type: mediaType });
            const uploaded = await uploadArtifactAsset({
              artifactId,
              path: `flashcards/${nextCardId}/${Date.now().toString(36)}-${name}`,
              name,
              mediaType,
              sha256: await artifactBlobSha256(blob),
              blob,
            });
            uploadedPackageAssetIds.push(uploaded.assetId);
            media = {
              assetId: uploaded.assetId,
              name,
              mediaType,
              altText:
                typeof rawMedia.altText === "string" ? rawMedia.altText : "",
            };
          }
          if (normalized.variant === "image_occlusion" && !media)
            throw new Error(
              `Image-occlusion card ${index + 1} is missing its packaged image.`,
            );
          importedCards.push({
            ...normalized,
            id: nextCardId,
            media,
            occlusions: (normalized.occlusions ?? []).map((mask) => ({
              ...mask,
              id: id("mask"),
            })),
            review: undefined,
          });
        }
        await completeArtifactImport({
          jobId: importJobId,
          typeKey: "flashcard_deck",
          status: "imported",
          fidelityReport: [
            {
              scope:
                "cards, sections, cloze syntax, reverse scheduling, image media, and occlusion geometry",
              level: "exact",
              message: `${importedCards.length} cards and ${uploadedPackageAssetIds.length} media files were restored as editable Spectra content.`,
            },
            {
              scope: "private study history",
              level: "adapted",
              message:
                "Private scheduling and answer history were intentionally not imported with shared deck content.",
            },
          ],
          unsupportedFeatures: [],
          importedContent: {
            cards: importedCards.map(({ review: _review, ...card }) => card),
            settings: manifestContent.settings,
          },
        });
        commit([...latestDeckRef.current.cards, ...importedCards]);
        setActiveCardId(importedCards[0]!.id);
        setActiveSection(importedCards[0]!.section ?? "Imported");
        void getArtifactAssets(artifactId)
          .then((result) => setDeckAssets(result.assets))
          .catch(() => undefined);
        setDeckImportReport(
          `${importedCards.length} cards restored with full deck-content fidelity.`,
        );
        return;
      }
      const text = await file.text();
      if (/\0/.test(text))
        throw new Error(
          "Binary or packaged deck data requires the staged package importer and was quarantined.",
        );
      const structuredText = extension === "csv" || extension === "tsv";
      const rows = structuredText
        ? parseDelimited(text, extension === "tsv" ? "\t" : ",")
        : text
            .replace(/\r\n/g, "\n")
            .split(/\n{2,}/)
            .map((block) => {
              const lines = block
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean);
              const labelled = Object.fromEntries(
                lines
                  .map((line) => {
                    const match = line.match(
                      /^(front|question|q|back|answer|a|hint|section|tags?|type|variant|explanation|alternatives?|difficulty|language|objective|sources?|bidirectional)\s*:\s*(.*)$/i,
                    );
                    return match
                      ? [match[1]!.toLocaleLowerCase(), match[2]!.trim()]
                      : undefined;
                  })
                  .filter((entry): entry is [string, string] => Boolean(entry)),
              );
              if (Object.keys(labelled).length) {
                return [
                  labelled.front || labelled.question || labelled.q || "",
                  labelled.back || labelled.answer || labelled.a || "",
                  labelled.hint || "",
                  labelled.section || "Imported",
                  labelled.tags || labelled.tag || "",
                  labelled.type || labelled.variant || "",
                  labelled.explanation || "",
                  labelled.alternatives || labelled.alternative || "",
                  labelled.difficulty || "",
                  labelled.objective || "",
                  labelled.language || "",
                  labelled.sources || labelled.source || "",
                  labelled.bidirectional || "",
                ];
              }
              const explicitPair = block.split(/\s+(?:::|=>|→)\s+/);
              if (explicitPair.length >= 2)
                return [
                  explicitPair[0]!.trim(),
                  explicitPair.slice(1).join(" ").trim(),
                ];
              if (lines.length >= 2)
                return [lines[0]!, lines.slice(1).join("\n")];
              return [];
            })
            .filter((row) => row.some(Boolean));
      const first = rows[0]?.map((value) => value.toLocaleLowerCase()) ?? [];
      const hasHeader =
        structuredText &&
        first.some((value) =>
          ["front", "question", "back", "answer", "hint", "section"].includes(
            value,
          ),
        );
      const header = hasHeader
        ? rows.shift()!.map((value) => value.toLocaleLowerCase())
        : [];
      const column = (names: string[], fallback: number) =>
        names.map((name) => header.indexOf(name)).find((value) => value >= 0) ??
        fallback;
      const frontIndex = column(["front", "question", "prompt"], 0);
      const backIndex = column(["back", "answer", "response"], 1);
      const hintIndex = column(["hint", "note"], 2);
      const sectionIndex = column(["section", "deck", "category"], 3);
      const tagsIndex = column(["tags", "tag"], -1);
      const typeIndex = column(["type", "variant"], structuredText ? -1 : 5);
      const explanationIndex = column(["explanation"], structuredText ? -1 : 6);
      const alternativesIndex = column(
        ["alternatives", "accepted alternatives"],
        structuredText ? -1 : 7,
      );
      const difficultyIndex = column(["difficulty"], structuredText ? -1 : 8);
      const objectiveIndex = column(
        ["learning objective", "objective"],
        structuredText ? -1 : 9,
      );
      const languageIndex = column(["language"], structuredText ? -1 : 10);
      const sourcesIndex = column(
        ["sources", "source"],
        structuredText ? -1 : 11,
      );
      const bidirectionalIndex = column(
        ["bidirectional", "reverse"],
        structuredText ? -1 : 12,
      );
      const imported = rows
        .filter((row) => row[frontIndex]?.trim() && row[backIndex]?.trim())
        .map((row, index): DeckCard => {
          const requestedType =
            typeIndex >= 0
              ? (row[typeIndex] ?? "").trim().toLocaleLowerCase()
              : "";
          const cloze =
            requestedType === "cloze" ||
            /\{\{c\d+::[\s\S]*?\}\}/i.test(row[frontIndex]!);
          const difficulty =
            difficultyIndex >= 0
              ? (row[difficultyIndex] ?? "").trim().toLocaleLowerCase()
              : "";
          return {
            id: id(`card-${index + 1}`),
            variant: cloze ? "cloze" : "basic",
            front: row[frontIndex]!,
            back: row[backIndex]!,
            hint: row[hintIndex] ?? "",
            explanation:
              explanationIndex >= 0 ? (row[explanationIndex] ?? "") : "",
            acceptedAlternatives:
              alternativesIndex >= 0
                ? (row[alternativesIndex] ?? "")
                    .split(/[;|]/)
                    .map((value) => value.trim())
                    .filter(Boolean)
                : [],
            section: row[sectionIndex] || "Imported",
            tags:
              tagsIndex >= 0
                ? (row[tagsIndex] ?? "")
                    .split(/[;|]/)
                    .map((tag) => tag.trim())
                    .filter(Boolean)
                    .slice(0, 8)
                : [],
            confidence: "unknown",
            difficulty:
              difficulty === "easy" || difficulty === "hard"
                ? difficulty
                : "medium",
            learningObjective:
              objectiveIndex >= 0 ? (row[objectiveIndex] ?? "") : "",
            language: languageIndex >= 0 ? (row[languageIndex] ?? "") : "",
            sourceRefs:
              sourcesIndex >= 0
                ? (row[sourcesIndex] ?? "")
                    .split(/[;|]/)
                    .map((value) => value.trim())
                    .filter(Boolean)
                : [],
            bidirectional:
              !cloze &&
              bidirectionalIndex >= 0 &&
              /^(?:true|yes|1|reverse)$/i.test(
                (row[bidirectionalIndex] ?? "").trim(),
              ),
          };
        });
      const known = new Set(
        cards.map(
          (card) =>
            `${card.front.trim().toLocaleLowerCase()}|${card.back.trim().toLocaleLowerCase()}`,
        ),
      );
      const importedKeys = new Set<string>();
      const unique = imported.filter((card) => {
        const key = `${card.front.trim().toLocaleLowerCase()}|${card.back.trim().toLocaleLowerCase()}`;
        if (known.has(key) || importedKeys.has(key)) return false;
        importedKeys.add(key);
        return true;
      });
      if (!unique.length)
        throw new Error(
          imported.length
            ? "Every valid row duplicates an existing card. Nothing was changed."
            : "No rows contained both a front and back value.",
        );
      commit([...latestDeckRef.current.cards, ...unique]);
      setActiveCardId(unique[0]!.id);
      setActiveSection(unique[0]!.section ?? "Imported");
      await completeArtifactImport({
        jobId: importJobId!,
        typeKey: "flashcard_deck",
        status: "imported",
        fidelityReport: [
          {
            scope:
              "card type, front, back, hint, explanation, section, tags, difficulty, objectives, language, sources, alternatives, and reverse study",
            level: "exact",
            message: `${unique.length} cards were converted to editable Spectra cards and the original file was retained.`,
          },
          ...(rows.length - unique.length > 0
            ? [
                {
                  scope: "invalid or duplicate records",
                  level: "adapted" as const,
                  message: `${rows.length - unique.length} rows were left unchanged because they were incomplete or duplicated existing content.`,
                },
              ]
            : []),
        ],
        unsupportedFeatures: structuredText
          ? [
              "external scheduling state",
              "image-occlusion media requires a Spectra package",
            ]
          : ["unsupported Markdown styling", "external scheduling state"],
        importedContent: { cards: unique },
      });
      setDeckImportReport(
        `${unique.length} cards imported as editable content · ${rows.length - unique.length} invalid or duplicate rows left unchanged.`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The deck import was quarantined.";
      await Promise.all(
        uploadedPackageAssetIds.map((assetId) =>
          revokeArtifactAsset(assetId).catch(() => undefined),
        ),
      );
      if (importJobId) {
        await completeArtifactImport({
          jobId: importJobId,
          typeKey: "flashcard_deck",
          status: "quarantined",
          fidelityReport: [
            { scope: "deck import", level: "unsupported", message },
          ],
          unsupportedFeatures: [],
          quarantineReason: message,
        }).catch(async () => {
          await abortArtifactImportUpload(importJobId!, message).catch(
            () => undefined,
          );
        });
      }
      setDeckImportError(message);
    } finally {
      if (deckImportRef.current) deckImportRef.current.value = "";
    }
  }

  function applyDeckTemplate(kind: "language" | "concept" | "formula") {
    const section =
      kind === "language"
        ? "Vocabulary"
        : kind === "formula"
          ? "Formulae"
          : "Concepts";
    const template: DeckCard = {
      id: id("card"),
      variant: kind === "concept" ? "cloze" : "basic",
      front:
        kind === "language"
          ? "Term or phrase"
          : kind === "formula"
            ? "When should this formula be used?"
            : "Complete the core idea: {{c1::key concept::concept}}",
      back:
        kind === "language"
          ? "Meaning, usage, and example"
          : kind === "formula"
            ? "Formula, variables, units, and constraints"
            : "Explain the relationship in your own words.",
      hint: "Add one useful retrieval cue",
      explanation: "Add context that appears after the answer.",
      section,
      tags: [],
      confidence: "unknown",
      difficulty: "medium",
    };
    commit([...cards, template]);
    setActiveCardId(template.id);
    setActiveSection(section);
  }

  function exportDeck(format: "csv" | "tsv") {
    const delimiter = format === "csv" ? "," : "\t";
    const escape = (value: string) => {
      const normalized = value.replaceAll("\0", "");
      return normalized.includes(delimiter) || /["\r\n]/.test(normalized)
        ? `"${normalized.replaceAll('"', '""')}"`
        : normalized;
    };
    const rows = [
      [
        "Type",
        "Front",
        "Back",
        "Hint",
        "Explanation",
        "Accepted alternatives",
        "Section",
        "Tags",
        "Difficulty",
        "Learning objective",
        "Language",
        "Sources",
        "Bidirectional",
        "Media name",
        "Hidden regions",
      ],
      ...cards.map((card) => [
        card.variant ?? "basic",
        card.front,
        card.back,
        card.hint ?? "",
        card.explanation ?? "",
        (card.acceptedAlternatives ?? []).join(";"),
        card.section ?? "",
        (card.tags ?? []).join(";"),
        card.difficulty ?? "medium",
        card.learningObjective ?? "",
        card.language ?? "",
        (card.sourceRefs ?? []).join(";"),
        card.bidirectional ? "true" : "false",
        card.media?.name ?? "",
        (card.occlusions ?? []).length.toString(),
      ]),
    ];
    downloadDocumentText(
      `spectra-flashcards.${format}`,
      format === "csv"
        ? "text/csv;charset=utf-8"
        : "text/tab-separated-values;charset=utf-8",
      `\uFEFF${rows.map((row) => row.map(escape).join(delimiter)).join("\r\n")}`,
    );
  }

  async function exportDeckPackage() {
    setDeckActionError(undefined);
    try {
      const { strToU8, zipSync } = await import("fflate");
      const archive: Record<string, Uint8Array> = {};
      const packagedCards = await Promise.all(
        cards.map(async (card) => {
          const shareableCard = { ...card };
          delete shareableCard.review;
          if (!card.media) return shareableCard;
          const asset = deckAssets.find(
            (candidate) => candidate.assetId === card.media?.assetId,
          );
          if (!asset?.downloadUrl)
            throw new Error(
              `The image for “${card.front || card.media.name}” is unavailable. Restore or replace it before exporting.`,
            );
          const response = await fetch(asset.downloadUrl, {
            cache: "no-store",
          });
          if (!response.ok)
            throw new Error(`Could not read ${card.media.name} for export.`);
          const extension =
            card.media.mediaType === "image/png"
              ? "png"
              : card.media.mediaType === "image/webp"
                ? "webp"
                : card.media.mediaType === "image/gif"
                  ? "gif"
                  : "jpg";
          const path = `media/${card.id}.${extension}`;
          archive[path] = new Uint8Array(await response.arrayBuffer());
          return {
            ...shareableCard,
            media: { ...card.media, assetId: "", packagePath: path },
          };
        }),
      );
      archive["manifest.json"] = strToU8(
        JSON.stringify(
          {
            format: "spectra-flashcard-deck",
            version: 1,
            exportedAt: new Date().toISOString(),
            content: {
              cards: packagedCards,
              settings: record(content).settings ?? {
                shuffle: true,
                revealMode: "click",
              },
            },
          },
          null,
          2,
        ),
      );
      downloadDocumentBlob(
        "spectra-flashcards.spectra-deck.zip",
        new Blob([zipSync(archive, { level: 6 }) as BlobPart], {
          type: "application/zip",
        }),
      );
    } catch (error) {
      setDeckActionError(
        error instanceof Error
          ? error.message
          : "The portable deck could not be exported.",
      );
    }
  }

  function revealStudyAnswer() {
    if (!activeStudyCard) return;
    if (
      studyTyping &&
      studyTypedAnswer.trim().length > 0
    ) {
      const response = foldForComparison(studyTypedAnswer);
      const accepted = activeStudyAccepted.map(foldForComparison).filter(Boolean);
      setStudyTypedCorrect(accepted.includes(response));
    } else setStudyTypedCorrect(undefined);
    setStudyRevealed(true);
    markSpaceHintSeen();
    // The typed answer's field goes away; the keys stay with the session.
    studyDialogRef.current?.focus({ preventScroll: true });
  }

  async function rateStudyCard(rating: SpectraFlashcardRating) {
    if (!activeStudyCard || !activeStudyItem || studyReviewBusy) return;
    // Where the grade was given (a press or its key), for the pulse once it is recorded.
    const cause = recentCause();
    setStudyReviewBusy(true);
    setStudyError(undefined);
    try {
      const now = currentTimeMs();
      if (canRecordStudy) {
        const result = await reviewSpectraFlashcard({
          artifactId,
          cardId: activeStudyCard.id,
          direction: activeStudyItem.direction,
          rating,
          clientReviewId: `review-${uniqueToken()}`,
          elapsedMs: Math.max(0, now - studyCardStartedAt),
        });
        setStudyStates((current) => {
          const next = new Map(current);
          next.set(
            deckStudyKey(result.state.cardId, result.state.direction),
            result.state,
          );
          return next;
        });
      }
      setStudyRatings((current) => ({
        ...current,
        [rating]: current[rating] + 1,
      }));
      if (cause) verdictAt(cause, rating === "again" ? "wrong" : "right");
      setStudyClock(now);
      if (studyIndex + 1 >= studyQueue.length) {
        setStudyComplete(true);
      } else {
        setStudyIndex((current) => current + 1);
        setStudyRevealed(false);
        setStudyTypedAnswer("");
        setStudyTypedCorrect(undefined);
        setStudyCardStartedAt(now);
      }
    } catch (error) {
      setStudyError(
        error instanceof Error
          ? error.message
          : "This review could not be synchronized.",
      );
    } finally {
      setStudyReviewBusy(false);
    }
  }

  const activeStudyPreviews =
    activeStudyCard && activeStudyItem
      ? studyStates.get(
          deckStudyKey(activeStudyCard.id, activeStudyItem.direction),
        )?.previews
      : undefined;
  const activeStudyState =
    activeStudyCard && activeStudyItem
      ? studyStates.get(
          deckStudyKey(activeStudyCard.id, activeStudyItem.direction),
        )
      : undefined;

  /**
   * A note lives with the learner's study state, so saving one changes nothing
   * about the deck and needs no edit access (§11B).
   */
  async function saveStudyNote() {
    if (!activeStudyCard || !activeStudyItem) return;
    const note = studyNoteDraft.trim();
    if (note === (activeStudyState?.note ?? "").trim()) return;
    setStudyNoteSaving(true);
    try {
      const result = await setSpectraFlashcardNote({
        artifactId,
        cardId: activeStudyCard.id,
        direction: activeStudyItem.direction,
        note,
      });
      setStudyStates((current) => {
        const key = deckStudyKey(result.cardId, result.direction);
        const existing = current.get(key);
        if (!existing) return current;
        const next = new Map(current);
        next.set(key, { ...existing, note: result.note });
        return next;
      });
    } catch (error) {
      setStudyError(
        error instanceof Error ? error.message : "Your note was not saved.",
      );
    } finally {
      setStudyNoteSaving(false);
    }
  }

  /**
   * Move on without grading. The card returns at the end of this session and
   * its schedule is untouched — not answering is not the same as answering
   * badly, so it must not cost the learner an interval.
   */
  function skipStudyCard() {
    if (studyComplete || studyQueue.length < 2) return;
    setStudyQueue((current) => {
      const item = current[studyIndex];
      if (!item) return current;
      return [...current.filter((_, index) => index !== studyIndex), item];
    });
    setStudyRevealed(false);
    setStudyTypedAnswer("");
    setStudyTypedCorrect(undefined);
    setStudyCardStartedAt(currentTimeMs());
  }

  /** Step back to the card just graded, to read the answer again. */
  function reopenPreviousStudyCard() {
    if (studyIndex === 0) return;
    setStudyIndex((current) => current - 1);
    setStudyRevealed(true);
    setStudyTypedAnswer("");
    setStudyTypedCorrect(undefined);
  }

  const studyIntervalLabels: Record<SpectraFlashcardRating, string> = {
    again: activeStudyPreviews?.again.label ?? "1 min",
    hard: activeStudyPreviews?.hard.label ?? "6 min",
    good: activeStudyPreviews?.good.label ?? "1 d",
    easy: activeStudyPreviews?.easy.label ?? "4 d",
  };
  const activeStudyPrompt =
    activeStudyCard && activeStudyItem
      ? activeStudyCard.variant === "cloze"
        ? clozePrompt(activeStudyCard.front)
        : activeStudyItem.direction === "reverse"
          ? activeStudyCard.back
          : activeStudyCard.front
      : "";
  const activeStudyAnswer =
    activeStudyCard && activeStudyItem
      ? activeStudyCard.variant === "cloze"
        ? clozeAnswer(activeStudyCard.front)
        : activeStudyItem.direction === "reverse"
          ? activeStudyCard.front
          : activeStudyCard.back
      : "";
  /** Every answer a typed response may match: the face, its alternatives, the blanks. */
  const activeStudyAccepted =
    activeStudyCard && activeStudyItem
      ? [
          activeStudyAnswer,
          ...(activeStudyItem.direction === "forward"
            ? (activeStudyCard.acceptedAlternatives ?? [])
            : []),
          ...(activeStudyCard.variant === "cloze"
            ? clozeParts(activeStudyCard.front).map((part) => part.answer)
            : []),
        ]
      : [];
  const activeStudyMedia = activeStudyCard?.media
    ? deckAssets.find(
        (asset) => asset.assetId === activeStudyCard.media?.assetId,
      )
    : undefined;
  const activePreviewSource = activeCard
    ? previewRevealed
      ? activeCard.variant === "cloze"
        ? clozeAnswer(activeCard.front)
        : activeCard.back || "No answer yet"
      : activeCard.variant === "cloze"
        ? clozePrompt(activeCard.front)
        : activeCard.front || "Untitled card"
    : "";
  const activePreviewPlainText = plainTextFromStored(activePreviewSource);

  // The rail and the card editor are the two authoring panes. Browse and
  // Progress read the deck, so they get the whole width instead of inheriting a
  // 300px track that nothing occupies.
  const showItemRail =
    contract.surface === "full" && activeView === "build";
  const studyPrimaryLabel = studyStateLoading
    ? "Study"
    : dueStudyCount
      ? `Study ${dueStudyCount} due`
      : studyCards.length
        ? "Study ahead"
        : "Study";
  /**
   * Why this card is not in the study queue, in the owner's terms. `studyCards`
   * silently drops a card that cannot be answered, so without this the Study
   * count and the deck size disagreed and nothing said why.
   */
  const activeCardStudyBlocker = !activeCard
    ? ""
    : activeCard.variant === "cloze" &&
        clozeParts(activeCard.front).length === 0
      ? "Hide at least one word on the front before this card can be studied."
      : activeCard.variant === "image_occlusion" &&
          (!activeCard.media || (activeCard.occlusions?.length ?? 0) === 0)
        ? "Add a picture and hide at least one part of it before this card can be studied."
        : !activeCard.front.trim() || !activeCard.back.trim()
          ? "Needs a prompt and an answer before it can be studied."
          : "";

  // One declaration of what this type's controls mean. The bar decides which of
  // them survive the pane's width, so the deck can no longer grow a second row
  // under pressure the way the audited build did.
  const deckActions: CommandBinding[] = projectBindingsFromIr("flashcard_deck", [
    ...contentHistoryBindings(contract.history),
    {
      id: "add-card",
      label: "Add card",
      icon: Plus,
      priority: "essential",
      keepLabel: true,
      requires: "edit",
      hint: "Ctrl or Cmd and Enter",
      onSelect: () => addCard(),
    },
    ...(activeView === "build" && contract.surface === "full"
      ? ([
          {
            id: "rail",
            label: railCollapsed ? "Show cards" : "Hide cards",
            icon: PanelLeft,
            priority: "essential",
            active: !railCollapsed,
            onSelect: () => setRailCollapsed((collapsed) => !collapsed),
          },
        ] satisfies CommandBinding[])
      : []),
    // Reading views are toggles, and the one you are inside stays in the bar at
    // every width, so leaving it is never hidden behind a menu (D3). `requires`
    // ties progress to whoever may record a review: no recording, no progress.
    ...readingViews.flatMap<CommandBinding>((view) =>
      hasView(view.id)
        ? [
            {
              ...view,
              label: activeView === view.id ? "Back to the deck" : view.label,
              priority: activeView === view.id ? "essential" : "secondary",
              active: activeView === view.id,
              onSelect: () =>
                setStudioView(activeView === view.id ? "build" : view.id),
            },
          ]
        : [],
    ),
    {
      id: "import",
      label: "Import cards",
      icon: Import,
      requires: "edit",
      hint: "CSV, TSV, Markdown, or an Anki package",
      onSelect: () => deckImportRef.current?.click(),
    },
    {
      id: "add-section",
      label: "Add section",
      icon: FolderPlus,
      tab: "Cards",
      priority: "secondary",
      keepLabel: true,
      requires: "edit",
      onSelect: () => {
        const section = `Section ${sections.length + 1}`;
        setActiveSection(section);
        addCard(section);
      },
    },
    ...deckTemplates.map<CommandBinding>((template) => ({
      id: `template-${template.kind}`,
      label: template.label,
      hint: "Adds a card with this shape",
      icon: template.icon,
      tab: "Cards",
      priority: "secondary",
      keepLabel: true,
      requires: "edit",
      onSelect: () => applyDeckTemplate(template.kind),
    })),
    ...(["csv", "tsv"] as const).map<CommandBinding>((format) => ({
      id: `export-${format}`,
      label: `${format.toUpperCase()} file`,
      hint: "Opens in any spreadsheet",
      icon: FileDown,
      tab: "Export",
      priority: "secondary",
      keepLabel: true,
      onSelect: () => exportDeck(format),
    })),
    {
      id: "export-package",
      label: "Deck package",
      hint: "Everything in the deck, to open in Spectra again",
      icon: Archive,
      tab: "Export",
      priority: "secondary",
      keepLabel: true,
      onSelect: () => void exportDeckPackage(),
    },
    {
      id: "print",
      label: "Print or PDF",
      icon: Printer,
      tab: "Export",
      priority: "secondary",
      keepLabel: true,
      onSelect: () => window.print(),
    },
  ]);

  /**
   * Keyboard flow for fast entry, matching `keyboardOperations.flashcard_deck`
   * in `work/registry`. Ctrl or Cmd and Enter starts the next card from
   * anywhere, including mid-sentence in a card face, because that is the hot
   * path when someone is typing a deck. Alt with the arrows moves between cards
   * and Alt and Shift moves the card itself, but both stand down inside a text
   * field: Option and arrow is word-wise caret movement on macOS, and stealing
   * it would break typing to add a shortcut nobody asked for. Reading the deck
   * has no text entry to protect, so there the bare arrows turn the pages.
   */
  function onStudioKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented) return;
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      if (!canEdit) return;
      event.preventDefault();
      addCard(activeCard?.section);
      return;
    }
    if (
      activeView === "browse" &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      const step = event.key === "ArrowRight" ? 1 : -1;
      const nextCard = cards[activeCardIndex + step];
      if (!nextCard) return;
      event.preventDefault();
      setActiveCardId(nextCard.id);
      return;
    }
    if (!event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    if (!activeCard) return;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    event.preventDefault();
    if (event.shiftKey) {
      if (canEdit) nudgeCard(activeCard.id, direction);
      return;
    }
    const next = cards[activeCardIndex + direction];
    if (next) setActiveCardId(next.id);
  }

  return (
    <div
      ref={studioRef}
      className="spectra-flashcard-studio flex min-h-0 min-w-0 flex-col overflow-hidden"
      data-studio-view={activeView}
      data-rail-collapsed={railCollapsed || undefined}
      onKeyDown={onStudioKeyDown}
    >
      {/* Study is the bar's one verb, not a fourth tab: a deck's activity has
          its own session and its own exit, so it can never look like a place
          the owner might get stuck (CANON D2, D3). */}
      <ArtifactWorkbar
        label="Deck"
        modes={[]}
        selector={
          studyShown || activeView === "progress" || !cards.length ? undefined : (
            <WorkbarItemSelector
              ariaLabel="Current card"
              itemNoun="card"
              value={activeCard?.id ?? ""}
              onChange={setActiveCardId}
              items={cards.map((card) => ({
                value: card.id,
                label: plainTextFromStored(card.front) || "Untitled card",
              }))}
            />
          )
        }
        primary={
          studyShown
            ? {
                // The same place leaves the session: the deck is one press away.
                label: canEdit ? "Edit" : "Back to the deck",
                icon: PenLine,
                onSelect: closeStudySession,
                requires: "attempt",
              }
            : {
                label: studyPrimaryLabel,
                icon: Play,
                onSelect: () => beginStudySession(),
                disabled: !studyCards.length,
                requires: "attempt",
              }
        }
        // The deck's own tools wait behind the session; Edit brings them back.
        actions={studyShown ? [] : deckActions}
      />
      <div className="spectra-editor-body">
      {deckUpdateNotice ? (
        <div
          className="spectra-deck-update-notice"
          role="status"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <p>{deckUpdateNotice}</p>
          <button type="button" onClick={() => setStudyUpdateDismissed(true)}>
            Got it
          </button>
        </div>
      ) : null}
      {activeView === "browse" && activeCard ? (
        <section
          className="spectra-deck-viewer"
          data-anchor-region={activeCard.id}
          aria-label={`Flashcard ${activeCardIndex + 1} of ${cards.length}`}
        >
          <div className="spectra-deck-viewer-context">
            <span>{activeCard.section || "Section 1"}</span>
            {/* The bar's selector already counts the cards. What a reader
                cannot see while flipping is how this card has been going. */}
            <strong>
              {cardConfidence[activeCard.confidence ?? "unknown"].label}
            </strong>
          </div>
          <button
            type="button"
            className="spectra-deck-viewer-card"
            data-revealed={previewRevealed || undefined}
            data-density={
              activePreviewPlainText.length > 260
                ? "dense"
                : activePreviewPlainText.length > 130
                  ? "compact"
                  : undefined
            }
            onClick={() => setPreviewRevealed((revealed) => !revealed)}
          >
            <span>{previewRevealed ? "Answer" : "Prompt"}</span>
            <SpectraStoredText
              value={activePreviewSource}
              className="spectra-deck-viewer-copy"
            />
            {previewRevealed && activeCard.explanation ? (
              <small>{activeCard.explanation}</small>
            ) : !previewRevealed && activeCard.hint ? (
              <small>{activeCard.hint}</small>
            ) : null}
            <em>{previewRevealed ? "Show prompt" : "Reveal answer"}</em>
          </button>
        </section>
      ) : null}
      {activeView === "progress" ? (
        <section className="spectra-deck-progress" aria-label="Your progress">
          <header>
            <div>
              <h3>Your progress</h3>
              <p>
                Only you can see this. Editing the deck does not change it, and
                other people studying the same deck have their own.
              </p>
            </div>
            {canStudy ? (
              <button
                type="button"
                onClick={() => beginStudySession()}
                disabled={!studyCards.length}
              >
                <Play className="h-3.5 w-3.5" />
                Study {dueStudyCount ? `${dueStudyCount} due` : "ahead"}
              </button>
            ) : null}
          </header>
          {studyStateLoading ? (
            <p className="spectra-deck-progress-empty">
              Loading your progress…
            </p>
          ) : !studyItems.length ? (
            <div className="spectra-deck-progress-empty">
              <strong>Nothing to study yet</strong>
              <p>
                A card needs a prompt and an answer before it can be studied.
                {canEdit
                  ? " Finish a card in Build and it appears here."
                  : " Ask whoever maintains this deck to finish its cards."}
              </p>
              {canEdit ? (
                <button type="button" onClick={() => setStudioView("build")}>
                  Go to Build
                </button>
              ) : null}
            </div>
          ) : (
            <>
              {/* Recall strength used to sit in a metrics strip above the
                  toolbar, where it competed with the authoring controls and
                  told an owner nothing they could act on. It belongs next to
                  the bands that explain it. */}
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <strong className="font-display text-metric leading-none text-[var(--text-primary)]">
                  {personalMastery}%
                </strong>
                <span className="text-caption text-[var(--text-secondary)]">
                  recall strength, counting a card as held once you can leave it
                  for three weeks
                </span>
              </p>
              <div className="spectra-deck-progress-bands">
                {deckProgressBands.map((band) => (
                  <div key={band.key} data-band={band.key}>
                    <strong>{band.count}</strong>
                    <span>{band.label}</span>
                    <i
                      style={{
                        width: `${studyItems.length ? (band.count / studyItems.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                ))}
              </div>
              <ol className="spectra-deck-progress-list">
                {deckProgressRows.slice(0, 60).map((entry) => (
                  <li key={`${entry.cardId}:${entry.direction}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveCardId(entry.cardId);
                        setStudioView("browse");
                      }}
                    >
                      <span>{entry.prompt}</span>
                      <small data-band={entry.band}>{entry.dueLabel}</small>
                    </button>
                  </li>
                ))}
              </ol>
              {deckProgressRows.length > 60 ? (
                <p className="spectra-deck-progress-more">
                  Showing the 60 cards due soonest of {deckProgressRows.length}.
                </p>
              ) : null}
            </>
          )}
        </section>
      ) : null}
      {deckImportReport || deckImportError || deckActionError ? (
        <div
          className="spectra-deck-import-report"
          data-error={Boolean(deckImportError || deckActionError) || undefined}
          role="status"
        >
          <span>
            <strong>
              {deckActionError
                ? "Deck action failed"
                : deckImportError
                  ? "Couldn't import"
                  : "Import complete"}
            </strong>
            <small>
              {deckActionError || deckImportError || deckImportReport}
            </small>
          </span>
          <button
            type="button"
            onClick={() => {
              setDeckImportError(undefined);
              setDeckImportReport(undefined);
              setDeckActionError(undefined);
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {/* Both file pickers live next to the pane that uses them and stay out of
          the grid. They are hidden inputs, so they take no track. */}
      <input
        ref={deckMediaInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadDeckMedia(file);
        }}
      />
      <input
        ref={deckImportRef}
        type="file"
        accept=".csv,.tsv,.txt,.md,.markdown,.apkg,.zip,.spectra-deck"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void importCards(file);
        }}
      />
      <div className="spectra-item-rail-stage min-h-0 flex-1">
      {showItemRail ? (
        <StudioItemRail
          label="Cards"
          showIndex={false}
          count={cards.length}
          collapsed={railCollapsed}
          onToggleCollapsed={() => setRailCollapsed((open) => !open)}
          items={filteredCards.map((card) => ({
            id: card.id,
            title: plainTextFromStored(card.front) || "Untitled card",
            // The answer under the prompt: a rail of cards reads as the deck.
            subtitle: plainTextFromStored(card.back).slice(0, 120) || undefined,
            active: card.id === activeCard?.id,
            preview: <CardThumbnail card={card} />,
          }))}
          onSelect={(id) => {
            setActiveCardId(id);
            const card = cards.find((item) => item.id === id);
            if (card?.section) setActiveSection(card.section);
          }}
          onAdd={canEdit ? () => addCard() : undefined}
          addLabel="Add card"
          canEdit={canEdit}
          draggingId={draggedCardId}
          onDragStart={setDraggedCardId}
          onDragEnd={() => setDraggedCardId(undefined)}
          onMove={(from, to) => {
            const moved = filteredCards[from];
            const target = filteredCards[to];
            if (moved && target) reorderCard(moved.id, target.id);
          }}
          tools={
            <div className="mt-2 grid gap-1.5">
              <label className="flex h-8 min-w-0 items-center gap-1.5 rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-[var(--text-secondary)]">
                <Search className="size-3.5 shrink-0" />
                <input
                  value={deckSearch}
                  onChange={(event) => setDeckSearch(event.target.value)}
                  placeholder="Find cards"
                  aria-label="Find cards"
                  className="min-w-0 flex-1 bg-transparent text-micro text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]"
                />
              </label>
            </div>
          }
        />
      ) : null}
      <section className="spectra-deck-card-editor min-w-0 flex-1 overflow-auto pb-10">
        {activeCard ? (
          <CardSheet
            key={activeCard.id}
            card={activeCard}
            cardIndex={activeCardIndex}
            cardNumber={activeCardIndex + 1}
            canEdit={canEdit}
            sections={sections}
            aiChangedPaths={aiChangedPaths}
            problem={
              duplicateKeys.has(`${activeCard.front.trim().toLocaleLowerCase()}|${activeCard.back.trim().toLocaleLowerCase()}`)
                ? "Another card has the same prompt and answer."
                : // A blank card plainly needs writing; it is not a problem yet.
                  (activeCard.front.trim() || activeCard.back.trim() || activeCard.media) && activeCardStudyBlocker
                  ? activeCardStudyBlocker
                  : undefined
            }
            dirty={activeCardDirty && canEdit}
            image={{
              url: activeDeckMedia?.downloadUrl ?? undefined,
              busy: deckMediaBusy,
              error: deckMediaError,
              pick: () => deckMediaInputRef.current?.click(),
              remove: removeDeckMedia,
              dismissError: () => setDeckMediaError(undefined),
            }}
            masks={{ draft: maskDraft, begin: beginMask, move: moveMask, finish: finishMask, cancel: () => setMaskDraft(undefined) }}
            detailsOpen={advancedOpen}
            onDetailsOpenChange={setAdvancedOpen}
            detailsAiPath={advancedAiPath}
            onChange={(patch) => updateCard(activeCard.id, patch)}
            onDuplicate={() => {
              const copy: DeckCard = {
                ...activeCard,
                id: id("card"),
                front: `${activeCard.front}${activeCard.front ? " (copy)" : ""}`,
                review: undefined,
              };
              const next = [...cards];
              next.splice(activeCardIndex + 1, 0, copy);
              commit(next);
              setActiveCardId(copy.id);
            }}
            onRemove={() => {
              const next = cards.filter((card) => card.id !== activeCard.id);
              const replacement = next.length
                ? next
                : [{ id: id("card"), front: "", back: "", hint: "", section: activeSection, confidence: "unknown" as const, difficulty: "medium" as const }];
              commit(replacement);
              setActiveCardId(replacement[0]!.id);
            }}
            onRevert={() => {
              const baseline = cardEditBaseline;
              if (!baseline || baseline.id !== activeCard.id) return;
              commit(cards.map((card) => (card.id === activeCard.id ? structuredClone(baseline) : card)));
            }}
            onFocusSide={(side) => onActiveRegionChange?.(`${activeCard.id}:${side}`)}
          />
        ) : null}
        {canEdit ? <QuickCardEntry onAdd={appendCard} /> : null}
      </section>
      </div>
      {/* Study happens in the deck's own space, over the editor, not over
          the whole app: the rail, the tabs and the island stay where they are. */}
      {studyOpen && studyQueue.length
        ? (
            <div
              ref={studyDialogRef}
              tabIndex={-1}
              className="spectra-deck-study"
              role="region"
              aria-label="Study session"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  closeStudySession();
                  return;
                }
                if (studyComplete) return;
                const typing =
                  event.target instanceof HTMLInputElement ||
                  event.target instanceof HTMLTextAreaElement;
                if (
                  !studyRevealed &&
                  ((!typing && event.key === " ") || event.key === "Enter")
                ) {
                  event.preventDefault();
                  revealStudyAnswer();
                  return;
                }
                if (typing) return;
                // Enter carries on: once the answer shows, it grades the card
                // good, the grade most cards get.
                if (studyRevealed && event.key === "Enter") {
                  event.preventDefault();
                  void rateStudyCard("good");
                  return;
                }
                // Study runs entirely from the keyboard: reveal, grade, note,
                // skip and undo all have a key, so a session never needs a
                // pointer (§11B).
                if (studyRevealed && ["1", "2", "3", "4"].includes(event.key)) {
                  event.preventDefault();
                  const selected = (["again", "hard", "good", "easy"] as const)[
                    Number(event.key) - 1
                  ];
                  if (selected) void rateStudyCard(selected);
                  return;
                }
                if (studyRevealed && event.key.toLowerCase() === "n") {
                  event.preventDefault();
                  studyNoteRef.current?.focus();
                  return;
                }
                if (event.key === "ArrowRight" || event.key === "s") {
                  // Skipping leaves the schedule untouched: not answering is not
                  // the same as answering badly.
                  event.preventDefault();
                  skipStudyCard();
                  return;
                }
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  reopenPreviousStudyCard();
                  return;
                }
                if (
                  event.key === "?" ||
                  (event.shiftKey && event.key === "/")
                ) {
                  event.preventDefault();
                  setStudyShortcutsOpen((current) => !current);
                }
              }}
            >
              <header>
                <span>
                  <BookOpen className="h-4 w-4" />
                  <strong>Studying</strong>
                  <small>
                    {studyComplete
                      ? `${studyQueue.length} reviewed`
                      : `${studyIndex + 1} of ${studyQueue.length}`}
                  </small>
                </span>
                <i
                  className="spectra-deck-study-progress"
                  style={{
                    width: `${((studyComplete ? studyQueue.length : studyIndex) / studyQueue.length) * 100}%`,
                  }}
                  aria-hidden
                />
                <button
                  type="button"
                  className="spectra-deck-study-typing"
                  aria-pressed={studyTyping}
                  title="Type each answer and see which letters were right"
                  onClick={() => {
                    setStudyTypingChoice(!studyTyping);
                    setStudyTypedAnswer("");
                  }}
                >
                  <Keyboard className="h-4 w-4" />
                  Type answers
                </button>
                {onOpenFull ? (
                  <button
                    type="button"
                    aria-label="Study in the whole window"
                    title="Study in the whole window"
                    onClick={() => {
                      carryStudy(artifactId, {
                        queue: studyQueue,
                        index: studyIndex,
                        revealed: studyRevealed,
                        complete: studyComplete,
                        typedAnswer: studyTypedAnswer,
                        typedCorrect: studyTypedCorrect,
                        typingChoice: studyTypingChoice,
                        ratings: studyRatings,
                      });
                      onOpenFull();
                    }}
                  >
                    <Maximize2 className="h-4 w-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Keyboard shortcuts"
                  aria-expanded={studyShortcutsOpen}
                  onClick={() => setStudyShortcutsOpen(!studyShortcutsOpen)}
                >
                  <kbd className="!px-1 !text-micro">?</kbd>
                </button>
              </header>
              {studyShortcutsOpen ? (
                <dl className="spectra-deck-study-shortcuts">
                  {(
                    [
                      ["Space or Enter", "Reveal the answer"],
                      ["1 to 4", "Grade it: again, hard, good, or easy"],
                      ["Enter", "Once revealed, grade it good and go on"],
                      ["N", "Write a private note"],
                      ["S or →", "Skip without grading"],
                      ["←", "Go back a card"],
                      ["Esc", "Leave the session"],
                    ] as const
                  ).map(([keys, meaning]) => (
                    <div key={keys}>
                      <dt>
                        <kbd>{keys}</kbd>
                      </dt>
                      <dd>{meaning}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {studyError ? (
                <div className="spectra-deck-study-error" role="alert">
                  <AlertCircle className="h-4 w-4" />
                  <span>{studyError}</span>
                  <button
                    type="button"
                    onClick={() => setStudyError(undefined)}
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}
              {studyComplete ? (
                <main className="spectra-deck-study-complete">
                  <LifeForm />
                  <h3>That was the whole queue</h3>
                  <p>
                    {canRecordStudy
                      ? "Every result went to your own scheduler. Nobody else can see your answers or your review history."
                      : "This was practice. Nothing was recorded, so the deck's schedule and your progress are unchanged."}
                  </p>
                  <div>
                    {(["again", "hard", "good", "easy"] as const).map(
                      (rating) => (
                        <span key={rating}>
                          <strong>{studyRatings[rating]}</strong>
                          <small>{rating}</small>
                        </span>
                      ),
                    )}
                  </div>
                  <button type="button" onClick={beginStudySession}>
                    Review another queue
                  </button>
                </main>
              ) : activeStudyCard ? (
                <main>
                  <section>
                    {activeStudyItem?.direction === "reverse" ? (
                      <span>Back to front</span>
                    ) : null}
                    <SpectraStoredText
                      value={activeStudyPrompt}
                      className="spectra-deck-study-face"
                    />
                    {canRecordStudy ? null : (
                      <small>
                        Practice only. Grades are not recorded here, so nothing
                        changes your progress.
                      </small>
                    )}
                    {activeStudyCard.variant !== "image_occlusion" &&
                    activeStudyCard.media?.placement !== "back" &&
                    activeStudyMedia?.downloadUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={activeStudyMedia.downloadUrl}
                        alt={
                          activeStudyCard.media?.altText ||
                          activeStudyCard.media?.name ||
                          "Card image"
                        }
                        className="mx-auto mt-4 block max-h-[42vh] max-w-full rounded-card border border-[var(--border-default)] object-contain"
                      />
                    ) : null}
                    {activeStudyCard.variant === "image_occlusion" &&
                    activeStudyMedia?.downloadUrl ? (
                      <div className="relative mx-auto mt-4 w-fit max-w-full overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--text-primary)]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={activeStudyMedia.downloadUrl}
                          alt={
                            activeStudyCard.media?.altText ||
                            activeStudyCard.media?.name
                          }
                          className="block max-h-[48vh] max-w-full object-contain"
                        />
                        {(activeStudyCard.occlusions ?? []).map(
                          (mask, index) => (
                            <span
                              key={mask.id}
                              className={`absolute grid place-items-center border text-micro font-bold transition-[background-color,border-color,color] ${
                                studyRevealed
                                  ? "border-[var(--success)] bg-[color-mix(in_oklab,var(--success)_12%,transparent)] text-[var(--success)]"
                                  : "border-white/65 bg-[var(--text-primary)] text-white shadow-card"
                              }`}
                              style={{
                                left: `${mask.x * 100}%`,
                                top: `${mask.y * 100}%`,
                                width: `${mask.width * 100}%`,
                                height: `${mask.height * 100}%`,
                              }}
                            >
                              {studyRevealed
                                ? mask.label || index + 1
                                : index + 1}
                            </span>
                          ),
                        )}
                      </div>
                    ) : null}
                    {!studyRevealed &&
                    deckSettings.showHints !== false &&
                    activeStudyCard.hint ? (
                      <small>{activeStudyCard.hint}</small>
                    ) : null}
                  </section>
                  {studyRevealed ? (
                    <section data-answer="true">
                      <LifeForm />
                      <LifeVerdict
                        immediate
                        verdict={studyTypedCorrect === undefined ? null : studyTypedCorrect ? "right" : "wrong"}
                      />
                      {studyTypedCorrect !== undefined ? (
                        <TypedAnswerDiff
                          typed={studyTypedAnswer}
                          accepted={activeStudyAccepted}
                        />
                      ) : null}
                      <SpectraStoredText
                        value={activeStudyAnswer}
                        className="spectra-deck-study-face"
                      />
                      {activeStudyCard.variant !== "image_occlusion" &&
                      activeStudyCard.media?.placement === "back" &&
                      activeStudyMedia?.downloadUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={activeStudyMedia.downloadUrl}
                          alt={
                            activeStudyCard.media.altText ||
                            activeStudyCard.media.name
                          }
                          className="mx-auto mt-3 block max-h-[36vh] max-w-full rounded-card border border-[var(--border-default)] object-contain"
                        />
                      ) : null}
                      {activeStudyCard.variant === "cloze" &&
                      activeStudyCard.back.trim() ? (
                        <small>{activeStudyCard.back}</small>
                      ) : null}
                      {activeStudyCard.explanation ? (
                        <small>{activeStudyCard.explanation}</small>
                      ) : null}
                      <div className="spectra-deck-study-note">
                        <label htmlFor="spectra-study-note">
                          Your note <kbd>N</kbd>
                        </label>
                        <textarea
                          id="spectra-study-note"
                          ref={studyNoteRef}
                          rows={1}
                          value={studyNoteDraft}
                          placeholder="Only you can see this."
                          onChange={(event) =>
                            setStudyNoteDraft(event.target.value)
                          }
                          onBlur={() => void saveStudyNote()}
                        />
                        {studyNoteSaving ? <small>Saving…</small> : null}
                      </div>
                    </section>
                  ) : studyTyping ? (
                    <div className="spectra-deck-typed">
                      <input
                        autoFocus
                        value={studyTypedAnswer}
                        onChange={(event) =>
                          setStudyTypedAnswer(event.target.value)
                        }
                        aria-label="Your answer"
                        placeholder="Type the answer, then Enter"
                        spellCheck={false}
                        autoComplete="off"
                      />
                      <button type="button" onClick={revealStudyAnswer}>
                        Check
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="spectra-deck-reveal"
                      onClick={revealStudyAnswer}
                    >
                      Reveal answer
                      {spaceHintSeen ? null : <kbd>Space</kbd>}
                    </button>
                  )}
                </main>
              ) : null}
              {!studyComplete && studyRevealed ? (
                <footer>
                  {(["again", "hard", "good", "easy"] as const).map(
                    (rating, index) => (
                      <button
                        key={rating}
                        type="button"
                        data-rating={rating}
                        data-default={rating === "good" || undefined}
                        title={rating === "good" ? "Enter grades it good" : undefined}
                        disabled={studyReviewBusy}
                        onClick={() => void rateStudyCard(rating)}
                      >
                        {studyReviewBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <kbd>{index + 1}</kbd>
                        )}
                        <strong>
                          {rating[0]!.toUpperCase() + rating.slice(1)}
                        </strong>
                        {canRecordStudy ? (
                          <small>{studyIntervalLabels[rating]}</small>
                        ) : null}
                      </button>
                    ),
                  )}
                </footer>
              ) : null}
            </div>
          )
        : null}
      <section className="spectra-deck-print-sheet" aria-hidden="true">
        <header>
          <strong>Flashcard deck</strong>
          <span>
            {cards.length} cards · {sections.length} sections
          </span>
        </header>
        {sections.map((section) => (
          <div key={section} className="spectra-deck-print-section">
            <h2>{section}</h2>
            <ol>
              {cards
                .filter((card) => (card.section || "Section 1") === section)
                .map((card) => (
                  <li key={card.id}>
                    <div>
                      <small>Front</small>
                      <SpectraStoredText
                        className="spectra-deck-print-face"
                        value={
                          card.variant === "cloze"
                            ? clozePrompt(card.front)
                            : card.front
                        }
                        fallback="Incomplete card"
                      />
                      {deckMediaUrl(card) &&
                      (card.variant === "image_occlusion" ||
                        card.media?.placement !== "back") ? (
                        <div className="relative mt-2 w-fit max-w-full overflow-hidden border border-black/15">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={deckMediaUrl(card)!}
                            alt={card.media?.altText || card.media?.name}
                            className="block max-h-52 max-w-full object-contain"
                          />
                          {card.variant === "image_occlusion"
                            ? (card.occlusions ?? []).map((mask, index) => (
                                <span
                                  key={mask.id}
                                  className="absolute grid place-items-center border border-black bg-white text-micro font-bold text-black"
                                  style={{
                                    left: `${mask.x * 100}%`,
                                    top: `${mask.y * 100}%`,
                                    width: `${mask.width * 100}%`,
                                    height: `${mask.height * 100}%`,
                                  }}
                                >
                                  {index + 1}
                                </span>
                              ))
                            : null}
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <small>Back</small>
                      <SpectraStoredText
                        className="spectra-deck-print-face"
                        value={
                          card.variant === "cloze"
                            ? clozeAnswer(card.front)
                            : card.back
                        }
                        fallback="Incomplete card"
                      />
                      {card.variant === "cloze" && card.back ? (
                        <em>{card.back}</em>
                      ) : null}
                      {card.variant !== "image_occlusion" &&
                      card.media?.placement === "back" &&
                      deckMediaUrl(card) ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={deckMediaUrl(card)!}
                          alt={card.media.altText || card.media.name}
                          className="mt-2 block max-h-52 max-w-full object-contain"
                        />
                      ) : null}
                      {card.hint ? <em>Hint: {card.hint}</em> : null}
                    </div>
                  </li>
                ))}
            </ol>
          </div>
        ))}
      </section>
      </div>
    </div>
  );
}
