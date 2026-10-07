"use client";

import { useMissingAssets } from "./use-missing-assets";
import { currentTimeMs, shuffleInPlace, uniqueToken } from "@/lib/unique-token";
import {
  AlertCircle,
  Archive,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileDown,
  Focus,
  FolderPlus,
  Gauge,
  ImageIcon,
  Import,
  LayoutTemplate,
  Loader2,
  PanelLeft,
  Play,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { LifeForm, LifeVerdict } from "@/components/ui/life-moments";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { recentCause, verdictAt } from "../life/use-life";
import { createPortal } from "react-dom";
import { targetAttrs } from "../collaboration/target-attributes";
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
import { aiRegionAttr, pathTouches } from "./ai-region-path";
import { OFFICE_ARCHIVE_LIMITS, readBoundedArchive } from "../../../../shared/parser-limits";
import { spectraBus } from "../events";
import {
  ArtifactRichTextEditor,
  Field,
  deckCards,
  iconButtonClass,
  inputClass,
} from "./artifact-studio";
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
import {
  ArtifactWorkbar,
  WorkbarItemSelector,
  contentHistoryBindings,
  type CommandBinding,
} from "./artifact-workbar";
import { projectBindingsFromIr } from "../capabilities";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

/** Starting shapes for a new card, offered in the bar's overflow menu. */
const deckTemplates = [
  { kind: "concept", label: "Add a concept and cloze card" },
  { kind: "language", label: "Add a vocabulary card" },
  { kind: "formula", label: "Add a formula card" },
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
}: {
  artifactId: string;
  mode: "split" | "tab";
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
  const [deckTagDraft, setDeckTagDraft] = useState("");
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
  const [studyOpen, setStudyOpen] = useState(false);
  const [studyRevealed, setStudyRevealed] = useState(false);
  const [studyIndex, setStudyIndex] = useState(0);
  const [studyQueue, setStudyQueue] = useState<DeckStudyItem[]>([]);
  const [studyComplete, setStudyComplete] = useState(false);
  const [studyCardStartedAt, setStudyCardStartedAt] = useState(0);
  const [studyClock, setStudyClock] = useState(0);
  const [studyReviewBusy, setStudyReviewBusy] = useState(false);
  const [studyError, setStudyError] = useState<string>();
  const [studyTypedAnswer, setStudyTypedAnswer] = useState("");
  const [studyTypedCorrect, setStudyTypedCorrect] = useState<boolean>();
  const [studyNoteDraft, setStudyNoteDraft] = useState("");
  const [studyNoteSaving, setStudyNoteSaving] = useState(false);
  const [studyShortcutsOpen, setStudyShortcutsOpen] = useState(false);
  const studyNoteRef = useRef<HTMLTextAreaElement>(null);
  const [studyRatings, setStudyRatings] = useState<
    Record<SpectraFlashcardRating, number>
  >({ again: 0, hard: 0, good: 0, easy: 0 });
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
    JSON.stringify(activeCard) !== JSON.stringify(cardEditBaseline),
  );
  const duplicateKeys = new Set(
    Array.from(
      cards.reduce((counts, card) => {
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
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  const closeStudySession = () => {
    setStudyOpen(false);
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => undefined);
  };
  // Escape stays on the dialog's own key handler; the hook moves focus into
  // the session, keeps Tab inside it and returns focus when it closes.
  const studyDialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(studyDialogRef, { open: studyOpen && studyQueue.length > 0 });
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

  function addActiveCardTag() {
    if (!activeCard) return;
    const tag = deckTagDraft.trim();
    if (!tag) return;
    updateCard(activeCard.id, {
      tags: [...new Set([...(activeCard.tags ?? []), tag])].slice(0, 8),
    });
    setDeckTagDraft("");
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
      deckSettings.revealMode === "type" &&
      studyTypedAnswer.trim().length > 0
    ) {
      const normalize = (value: string) =>
        plainTextFromStored(value)
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, " ")
          .trim();
      const response = normalize(studyTypedAnswer);
      const accepted = [
        activeStudyAnswer,
        ...(activeStudyItem?.direction === "forward"
          ? (activeStudyCard.acceptedAlternatives ?? [])
          : []),
        ...(activeStudyCard.variant === "cloze"
          ? clozeParts(activeStudyCard.front).map((part) => part.answer)
          : []),
      ]
        .map(normalize)
        .filter(Boolean);
      setStudyTypedCorrect(accepted.includes(response));
    } else setStudyTypedCorrect(undefined);
    setStudyRevealed(true);
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
      ? "Make one answer on the front a cloze deletion before this card can be studied."
      : activeCard.variant === "image_occlusion" &&
          (!activeCard.media || (activeCard.occlusions?.length ?? 0) === 0)
        ? "Add an image and hide at least one region before this card can be studied."
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
      priority: "advanced",
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
      icon: LayoutTemplate,
      priority: "advanced",
      requires: "edit",
      onSelect: () => applyDeckTemplate(template.kind),
    })),
    ...(["csv", "tsv"] as const).map<CommandBinding>((format) => ({
      id: `export-${format}`,
      label: `Export as ${format.toUpperCase()}`,
      icon: FileDown,
      priority: "advanced",
      onSelect: () => exportDeck(format),
    })),
    {
      id: "export-package",
      label: "Export a portable deck package",
      icon: Archive,
      priority: "advanced",
      onSelect: () => void exportDeckPackage(),
    },
    {
      id: "print",
      label: "Print or save as PDF",
      icon: Printer,
      priority: "advanced",
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
          activeView === "progress" || !cards.length ? undefined : (
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
        primary={{
          label: studyPrimaryLabel,
          icon: Play,
          onSelect: () => beginStudySession(),
          disabled: !studyCards.length,
          requires: "attempt",
        }}
        actions={deckActions}
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
                  ? "Import quarantined"
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
          count={cards.length}
          collapsed={railCollapsed}
          onToggleCollapsed={() => setRailCollapsed((open) => !open)}
          items={filteredCards.map((card) => ({
            id: card.id,
            title: plainTextFromStored(card.front) || "Untitled card",
            subtitle: `${card.section || "Section 1"} · ${card.difficulty ?? "medium"}`,
            active: card.id === activeCard?.id,
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
      <section className="spectra-deck-card-editor min-w-0 overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
        {activeCard ? (
          <div>
            <div className="spectra-deck-card-heading mb-4 flex items-center justify-between gap-3">
              {/* The bar already says which card this is, so this line answers
                  the question the bar cannot: whether the card is fit to study.
                  An incomplete card is silently excluded from the queue, and
                  before this the owner had no way to find out why. */}
              {duplicateKeys.has(
                `${activeCard.front.trim().toLocaleLowerCase()}|${activeCard.back.trim().toLocaleLowerCase()}`,
              ) ? (
                <p className="flex min-w-0 items-center gap-1.5 text-caption text-[var(--warning)]">
                  <Copy className="size-3.5 shrink-0" aria-hidden="true" />
                  Another card has the same prompt and answer.
                </p>
              ) : activeCardStudyBlocker ? (
                <p className="flex min-w-0 items-center gap-1.5 text-caption text-[var(--text-secondary)]">
                  <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                  {activeCardStudyBlocker}
                </p>
              ) : (
                <p className="min-w-0 truncate text-caption text-[var(--text-secondary)]">
                  {activeCard.section || "Section 1"}
                </p>
              )}
              {canEdit ? (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className={iconButtonClass()}
                    onClick={() => {
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
                    aria-label="Duplicate card"
                    title="Duplicate card"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className={iconButtonClass()}
                    onClick={() => {
                      const next = cards.filter(
                        (card) => card.id !== activeCard.id,
                      );
                      const replacement =
                        next.length > 0
                          ? next
                          : [
                              {
                                id: id("card"),
                                front: "",
                                back: "",
                                hint: "",
                                section: activeSection,
                                confidence: "unknown" as const,
                                difficulty: "medium" as const,
                              },
                            ];
                      commit(replacement);
                      setActiveCardId(replacement[0]!.id);
                    }}
                    aria-label="Remove card"
                    title="Remove card"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </div>
            <CardFace
              label="Front"
              value={activeCard.front}
              placeholder="Question or prompt"
              disabled={!canEdit}
              onChange={(value) => updateCard(activeCard.id, { front: value })}
              onFocus={() => onActiveRegionChange?.(`${activeCard.id}:front`)}
              clozeMode={activeCard.variant === "cloze"}
              aiActive={pathTouches(
                aiChangedPaths,
                `/cards/${activeCardIndex}/front`,
              )}
              path={`/cards/${activeCardIndex}/front`}
            />
            {activeCard.variant !== "image_occlusion" &&
            activeCard.media?.placement !== "back" &&
            activeDeckMedia?.downloadUrl ? (
              <div className="mt-3 overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activeDeckMedia.downloadUrl}
                  alt={
                    activeCard.media?.altText ||
                    activeCard.media?.name ||
                    "Card image"
                  }
                  className="mx-auto block max-h-[360px] max-w-full rounded-chip object-contain"
                />
              </div>
            ) : null}
            {activeCard.variant === "image_occlusion" ? (
              <section className="mt-3 rounded-card border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                <div className="mb-2 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <strong className="block text-caption text-[var(--text-primary)]">
                      Image occlusion
                    </strong>
                    <span className="text-micro leading-4 text-[var(--text-tertiary)]">
                      Drag over the image to hide a region. Each mask is
                      revealed with the answer.
                    </span>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 text-micro font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    disabled={deckMediaBusy || !canEdit}
                    onClick={() => deckMediaInputRef.current?.click()}
                  >
                    {deckMediaBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImageIcon className="h-3.5 w-3.5" />
                    )}
                    {activeCard.media ? "Replace image" : "Add image"}
                  </button>
                  {activeCard.media ? (
                    <button
                      type="button"
                      className={iconButtonClass()}
                      disabled={deckMediaBusy || !canEdit}
                      onClick={removeDeckMedia}
                      aria-label="Remove image"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                {activeDeckMedia?.downloadUrl ? (
                  <>
                    <div
                      className={`relative mx-auto max-h-[440px] w-fit touch-none select-none overflow-hidden rounded-control border border-[var(--border-default)] bg-[var(--text-primary)] ${canEdit ? "cursor-crosshair" : ""}`}
                      onPointerDown={canEdit ? beginMask : undefined}
                      onPointerMove={canEdit ? moveMask : undefined}
                      onPointerUp={canEdit ? finishMask : undefined}
                      onPointerCancel={() => setMaskDraft(undefined)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={activeDeckMedia.downloadUrl}
                        alt={
                          activeCard.media?.altText || activeCard.media?.name
                        }
                        className="pointer-events-none block max-h-[440px] max-w-full object-contain"
                        draggable={false}
                      />
                      {(activeCard.occlusions ?? []).map((mask, index) => (
                        <button
                          key={mask.id}
                          type="button"
                          className="absolute grid place-items-center border border-white/65 bg-[var(--text-primary)]/90 text-micro font-bold text-white shadow-card hover:bg-[var(--danger)]/90"
                          style={{
                            left: `${mask.x * 100}%`,
                            top: `${mask.y * 100}%`,
                            width: `${mask.width * 100}%`,
                            height: `${mask.height * 100}%`,
                          }}
                          title="Remove this mask"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            updateCard(activeCard.id, {
                              occlusions: (activeCard.occlusions ?? []).filter(
                                (candidate) => candidate.id !== mask.id,
                              ),
                            });
                          }}
                        >
                          {index + 1}
                        </button>
                      ))}
                      {maskDraft ? (
                        <span
                          className="pointer-events-none absolute border border-white/75 bg-[var(--accent-cyan)]/75"
                          style={{
                            left: `${Math.min(maskDraft.x, maskDraft.currentX) * 100}%`,
                            top: `${Math.min(maskDraft.y, maskDraft.currentY) * 100}%`,
                            width: `${Math.abs(maskDraft.currentX - maskDraft.x) * 100}%`,
                            height: `${Math.abs(maskDraft.currentY - maskDraft.y) * 100}%`,
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <Field label="Image description">
                        <input
                          className={inputClass()}
                          value={activeCard.media?.altText ?? ""}
                          onChange={(event) =>
                            updateCard(activeCard.id, {
                              media: activeCard.media
                                ? {
                                    ...activeCard.media,
                                    altText: event.target.value,
                                  }
                                : undefined,
                            })
                          }
                          placeholder="Describe the image for accessibility"
                        />
                      </Field>
                      <Field label="Hidden regions">
                        <div className="flex h-10 items-center rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-micro text-[var(--text-secondary)]">
                          {(activeCard.occlusions ?? []).length
                            ? `${activeCard.occlusions!.length} ready to reveal`
                            : canEdit
                              ? "Drag on the image to add the first mask"
                              : "None yet"}
                        </div>
                      </Field>
                    </div>
                    {(activeCard.occlusions ?? []).length ? (
                      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                        {(activeCard.occlusions ?? []).map((mask, index) => (
                          <div
                            key={mask.id}
                            className="flex items-center gap-2 rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] p-1.5"
                          >
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-chip bg-[var(--text-primary)] text-micro font-bold text-white">
                              {index + 1}
                            </span>
                            <input
                              value={mask.label ?? ""}
                              onChange={(event) =>
                                updateCard(activeCard.id, {
                                  occlusions: (activeCard.occlusions ?? []).map(
                                    (candidate) =>
                                      candidate.id === mask.id
                                        ? {
                                            ...candidate,
                                            label: event.target.value,
                                          }
                                        : candidate,
                                  ),
                                })
                              }
                              className="min-w-0 flex-1 bg-transparent px-1 text-micro text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                              placeholder="Optional revealed label"
                              readOnly={!canEdit}
                              aria-label={`Label for hidden region ${index + 1}`}
                            />
                            {canEdit ? (
                            <button
                              type="button"
                              className="grid h-7 w-7 shrink-0 place-items-center rounded-chip text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--danger)]"
                              onClick={() =>
                                updateCard(activeCard.id, {
                                  occlusions: (
                                    activeCard.occlusions ?? []
                                  ).filter(
                                    (candidate) => candidate.id !== mask.id,
                                  ),
                                })
                              }
                              aria-label={`Remove hidden region ${index + 1}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : canEdit ? (
                  <button
                    type="button"
                    className="grid min-h-40 w-full place-items-center rounded-control border border-dashed border-[var(--border-default)] bg-[var(--bg-primary)] text-center"
                    onClick={() => deckMediaInputRef.current?.click()}
                  >
                    <span>
                      <ImageIcon className="mx-auto mb-2 h-5 w-5 text-[var(--text-tertiary)]" />
                      <strong className="block text-caption text-[var(--text-primary)]">
                        Add the diagram or image to study
                      </strong>
                      <small className="mt-1 block text-micro text-[var(--text-tertiary)]">
                        PNG, JPEG, WebP, or GIF
                      </small>
                    </span>
                  </button>
                ) : (
                  <p className="grid min-h-40 w-full place-items-center rounded-control border border-dashed border-[var(--border-default)] bg-[var(--bg-primary)] text-center text-caption text-[var(--text-secondary)]">
                    This card has no image yet.
                  </p>
                )}
                {deckMediaError ? (
                  <div
                    className="mt-2 flex items-center gap-2 rounded-control bg-[color-mix(in_oklab,var(--danger)_8%,var(--bg-primary))] px-2.5 py-2 text-micro text-[var(--danger)]"
                    role="alert"
                  >
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span className="min-w-0 flex-1">{deckMediaError}</span>
                    <button
                      type="button"
                      onClick={() => setDeckMediaError(undefined)}
                    >
                      Dismiss
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}
            {canEdit ? (
              <div className="my-3 flex justify-center">
                {/* The audited build left this as a bare circle on the seam
                    between the two faces, so the one control that rewrites both
                    of them was a guess. The shared width is overridden here
                    rather than in the stylesheet because the label belongs to
                    this button, not to every pill in the product. */}
                <button
                  type="button"
                  className="spectra-deck-swap !w-auto gap-1.5 !px-3 text-micro font-semibold"
                  onClick={() =>
                    updateCard(activeCard.id, {
                      front: activeCard.back,
                      back: activeCard.front,
                    })
                  }
                  title="Swap front and back"
                >
                  <RotateCcw className="h-4 w-4 shrink-0" />
                  Swap sides
                </button>
              </div>
            ) : null}
            <CardFace
              label="Back"
              value={activeCard.back}
              placeholder="Answer"
              disabled={!canEdit}
              onChange={(value) => updateCard(activeCard.id, { back: value })}
              onFocus={() => onActiveRegionChange?.(`${activeCard.id}:back`)}
              noteValue={activeCard.hint ?? ""}
              onNoteChange={(value) =>
                updateCard(activeCard.id, { hint: value })
              }
              aiActive={pathTouches(
                aiChangedPaths,
                `/cards/${activeCardIndex}/back`,
              )}
              aiNoteActive={pathTouches(
                aiChangedPaths,
                `/cards/${activeCardIndex}/hint`,
              )}
              path={`/cards/${activeCardIndex}/back`}
              notePath={`/cards/${activeCardIndex}/hint`}
            />
            {activeCard.variant !== "image_occlusion" &&
            activeCard.media?.placement === "back" &&
            activeDeckMedia?.downloadUrl ? (
              <div className="mt-3 overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activeDeckMedia.downloadUrl}
                  alt={activeCard.media.altText || activeCard.media.name}
                  className="mx-auto block max-h-[360px] max-w-full rounded-chip object-contain"
                />
              </div>
            ) : null}
            <div className="spectra-deck-tag-field mt-3">
              <span className="text-micro font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                Tags
              </span>
              <div className="mt-2 flex min-h-9 flex-wrap items-center gap-1.5">
                {(activeCard.tags ?? []).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex h-7 items-center gap-1 rounded-chip border border-[color-mix(in_oklab,var(--brand-primary)_20%,var(--border-default))] bg-[color-mix(in_oklab,var(--brand-primary)_6%,var(--bg-elevated))] px-2 text-micro text-[var(--text-secondary)]"
                  >
                    {tag}
                    {canEdit ? (
                      <button
                        type="button"
                        className="grid size-4 place-items-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--danger)]"
                        onClick={() =>
                          updateCard(activeCard.id, {
                            tags: (activeCard.tags ?? []).filter(
                              (candidate) => candidate !== tag,
                            ),
                          })
                        }
                        aria-label={`Remove ${tag}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    ) : null}
                  </span>
                ))}
                {canEdit ? (
                  <>
                    <input
                      value={deckTagDraft}
                      onChange={(event) => setDeckTagDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addActiveCardTag();
                        }
                      }}
                      // Not flex-1: stretching the field threw its own Add
                      // button to the far edge of a 1200px column, so the two
                      // halves of one control sat a screen apart.
                      className="h-7 w-40 min-w-24 bg-transparent px-1 text-micro text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                      placeholder="Add tag"
                      aria-label="Add card tag"
                    />
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-1 rounded-chip px-2 text-micro text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      onClick={addActiveCardTag}
                      disabled={!deckTagDraft.trim()}
                    >
                      <Plus className="h-3 w-3" /> Add
                    </button>
                  </>
                ) : (activeCard.tags ?? []).length ? null : (
                  <span className="text-micro text-[var(--text-secondary)]">
                    No tags
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              className="spectra-deck-advanced-trigger"
              aria-expanded={advancedOpen}
              {...(advancedAiPath ? targetAttrs(advancedAiPath) : {})}
              onClick={() => setAdvancedOpen(!advancedOpen)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Advanced card settings
              <ChevronDown
                className={`ml-auto h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              />
            </button>
            {advancedOpen ? (
              <div className="spectra-deck-advanced">
                <div>
                  <CardChoice
                    label="Card type"
                    path={`/cards/${activeCardIndex}/variant`}
                    aiActive={pathTouches(
                      aiChangedPaths,
                      `/cards/${activeCardIndex}/variant`,
                    )}
                    disabled={!canEdit}
                    value={activeCard.variant ?? "basic"}
                    onChange={(next) => {
                      const variant = next as DeckCard["variant"];
                      updateCard(activeCard.id, {
                        variant,
                        ...(variant !== "basic"
                          ? { bidirectional: false }
                          : {}),
                      });
                    }}
                    options={[
                      { value: "basic", label: "Basic front and back" },
                      { value: "cloze", label: "Cloze deletion" },
                      { value: "image_occlusion", label: "Image occlusion" },
                    ]}
                  />
                  <CardChoice
                    label="Difficulty"
                    path={`/cards/${activeCardIndex}/difficulty`}
                    aiActive={pathTouches(
                      aiChangedPaths,
                      `/cards/${activeCardIndex}/difficulty`,
                    )}
                    disabled={!canEdit}
                    value={activeCard.difficulty ?? "medium"}
                    onChange={(next) =>
                      updateCard(activeCard.id, {
                        difficulty: next as DeckCard["difficulty"],
                      })
                    }
                    options={[
                      { value: "easy", label: "Easy" },
                      { value: "medium", label: "Medium" },
                      { value: "hard", label: "Hard" },
                    ]}
                  />
                  <CardChoice
                    label="Confidence"
                    path={`/cards/${activeCardIndex}/confidence`}
                    aiActive={pathTouches(
                      aiChangedPaths,
                      `/cards/${activeCardIndex}/confidence`,
                    )}
                    disabled={!canEdit}
                    value={activeCard.confidence ?? "unknown"}
                    onChange={(next) =>
                      updateCard(activeCard.id, {
                        confidence: next as DeckCard["confidence"],
                      })
                    }
                    options={[
                      { value: "unknown", label: "Not rated yet" },
                      { value: "weak", label: "Giving you trouble" },
                      { value: "medium", label: "Still working on it" },
                      { value: "strong", label: "You find it easy" },
                    ]}
                  />
                  <CardChoice
                    label="Section"
                    path={`/cards/${activeCardIndex}/section`}
                    disabled={!canEdit}
                    value={activeCard.section ?? "Section 1"}
                    onChange={(next) =>
                      updateCard(activeCard.id, { section: next })
                    }
                    options={sections.map((section) => ({
                      value: section,
                      label: section,
                    }))}
                  />
                  <Field
                    label="Language"
                    path={`/cards/${activeCardIndex}/language`}
                  >
                    <input
                      value={activeCard.language ?? ""}
                      onChange={(event) =>
                        updateCard(activeCard.id, {
                          language: event.target.value,
                        })
                      }
                      className={inputClass()}
                      placeholder="e.g. English, Spanish"
                      disabled={!canEdit}
                    />
                  </Field>
                </div>
                {activeCard.variant !== "image_occlusion" ? (
                  <div className="rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <strong className="block text-micro text-[var(--text-primary)]">
                          Card image
                        </strong>
                        <span className="text-micro leading-4 text-[var(--text-tertiary)]">
                          Add a useful visual to the prompt or answer.
                        </span>
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1.5 rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 text-micro font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        disabled={deckMediaBusy || !canEdit}
                        onClick={() => deckMediaInputRef.current?.click()}
                      >
                        {deckMediaBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ImageIcon className="h-3.5 w-3.5" />
                        )}
                        {activeCard.media ? "Replace" : "Add image"}
                      </button>
                      {activeCard.media ? (
                        <button
                          type="button"
                          className={iconButtonClass()}
                          disabled={deckMediaBusy || !canEdit}
                          onClick={removeDeckMedia}
                          aria-label="Remove card image"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                    {activeCard.media ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <CardChoice
                          label="Place image on"
                          path={`/cards/${activeCardIndex}/media/placement`}
                          disabled={!canEdit}
                          value={activeCard.media.placement ?? "front"}
                          onChange={(next) =>
                            updateCard(activeCard.id, {
                              media: activeCard.media
                                ? {
                                    ...activeCard.media,
                                    placement: next as "front" | "back",
                                  }
                                : undefined,
                            })
                          }
                          options={[
                            { value: "front", label: "The prompt" },
                            { value: "back", label: "The answer" },
                          ]}
                        />
                        <Field
                          label="Image description"
                          path={`/cards/${activeCardIndex}/media/altText`}
                        >
                          <input
                            value={activeCard.media.altText ?? ""}
                            onChange={(event) =>
                              updateCard(activeCard.id, {
                                media: activeCard.media
                                  ? {
                                      ...activeCard.media,
                                      altText: event.target.value,
                                    }
                                  : undefined,
                              })
                            }
                            className={inputClass()}
                            placeholder="Describe it for accessibility"
                          />
                        </Field>
                      </div>
                    ) : null}
                    {deckMediaError ? (
                      <p className="mt-2 text-micro text-[var(--danger)]">
                        {deckMediaError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <Field
                  label="Explanation"
                  path={`/cards/${activeCardIndex}/explanation`}
                >
                  <textarea
                    value={activeCard.explanation ?? ""}
                    onChange={(event) =>
                      updateCard(activeCard.id, {
                        explanation: event.target.value,
                      })
                    }
                    className={`${inputClass()} min-h-[74px] resize-y py-2`}
                    placeholder="Why this answer is correct or useful"
                  />
                </Field>
                <Field
                  label="Accepted alternatives"
                  path={`/cards/${activeCardIndex}/acceptedAlternatives`}
                >
                  <input
                    value={(activeCard.acceptedAlternatives ?? []).join("; ")}
                    onChange={(event) =>
                      updateCard(activeCard.id, {
                        acceptedAlternatives: event.target.value
                          .split(";")
                          .map((value) => value.trim())
                          .filter(Boolean),
                      })
                    }
                    className={inputClass()}
                    placeholder="Alternative answer; another accepted form"
                  />
                </Field>
                <Field
                  label="Learning objective"
                  path={`/cards/${activeCardIndex}/learningObjective`}
                >
                  <input
                    value={activeCard.learningObjective ?? ""}
                    onChange={(event) =>
                      updateCard(activeCard.id, {
                        learningObjective: event.target.value,
                      })
                    }
                    className={inputClass()}
                    placeholder="What should this card help the learner retrieve?"
                  />
                </Field>
                <Field
                  label="Sources / provenance"
                  path={`/cards/${activeCardIndex}/sourceRefs`}
                >
                  <input
                    value={(activeCard.sourceRefs ?? []).join(", ")}
                    onChange={(event) =>
                      updateCard(activeCard.id, {
                        sourceRefs: event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })
                    }
                    className={inputClass()}
                    placeholder="Chapter 3, lecture notes"
                  />
                </Field>
                <label className="spectra-deck-check-field">
                  <input
                    type="checkbox"
                    {...targetAttrs(
                      `/cards/${activeCardIndex}/bidirectional`,
                    )}
                    checked={activeCard.bidirectional === true}
                    disabled={activeCard.variant !== "basic"}
                    onChange={() =>
                      updateCard(activeCard.id, {
                        bidirectional: !activeCard.bidirectional,
                      })
                    }
                  />
                  {activeCard.variant === "basic"
                    ? "Generate and schedule the reverse direction separately"
                    : "Reverse study is available for basic front / back cards"}
                </label>
              </div>
            ) : null}
            <div className="spectra-deck-sync-actions">
              {activeCardDirty && canEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    const baseline = cardEditBaseline;
                    if (!baseline || baseline.id !== activeCard.id) return;
                    commit(
                      cards.map((card) =>
                        card.id === activeCard.id
                          ? structuredClone(baseline)
                          : card,
                      ),
                    );
                  }}
                >
                  Revert this card
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
      </div>
      {studyOpen && studyQueue.length && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={studyDialogRef}
              tabIndex={-1}
              className="spectra-deck-study"
              role="dialog"
              aria-modal="true"
              aria-label="Private flashcard study session"
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
                  <strong>Private study session</strong>
                  <small>
                    {studyComplete
                      ? `${studyQueue.length} reviewed`
                      : `${studyIndex + 1} of ${studyQueue.length}`}
                  </small>
                </span>
                <button
                  type="button"
                  aria-label="Keyboard shortcuts"
                  aria-expanded={studyShortcutsOpen}
                  onClick={() => setStudyShortcutsOpen(!studyShortcutsOpen)}
                >
                  <kbd className="!px-1 !text-micro">?</kbd>
                </button>
                <button
                  type="button"
                  aria-label="Close study session"
                  onClick={closeStudySession}
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
              {studyShortcutsOpen ? (
                <dl className="spectra-deck-study-shortcuts">
                  {(
                    [
                      ["Space", "Reveal the answer"],
                      ["1 to 4", "Grade it: again, hard, good, or easy"],
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
                  <LifeForm bars="h3, p" />
                  <span className="grid size-12 place-items-center rounded-full bg-[color-mix(in_oklab,var(--success)_10%,var(--bg-primary))] text-[var(--success)]">
                    <CheckCircle2 className="h-6 w-6" />
                  </span>
                  <h3>Study queue complete</h3>
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
                    <span>
                      Prompt
                      {activeStudyItem?.direction === "reverse"
                        ? " · reverse"
                        : ""}
                    </span>
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
                      <LifeForm bars="span, p" />
                      <LifeVerdict
                        immediate
                        verdict={studyTypedCorrect === undefined ? null : studyTypedCorrect ? "right" : "wrong"}
                      />
                      <span>Answer</span>
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
                      {studyTypedCorrect !== undefined ? (
                        <small
                          className={
                            studyTypedCorrect
                              ? "text-[var(--success)]"
                              : "text-[var(--warning)]"
                          }
                        >
                          {studyTypedCorrect
                            ? "Your typed answer matched."
                            : `Your answer: ${studyTypedAnswer}`}
                        </small>
                      ) : null}
                      <div className="spectra-deck-study-note">
                        <label htmlFor="spectra-study-note">
                          Your note <kbd>N</kbd>
                        </label>
                        <textarea
                          id="spectra-study-note"
                          ref={studyNoteRef}
                          rows={2}
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
                  ) : deckSettings.revealMode === "type" ? (
                    <div className="spectra-deck-reveal flex-col !items-stretch gap-2">
                      <label className="text-left text-micro font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                        Type your answer
                      </label>
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          value={studyTypedAnswer}
                          onChange={(event) =>
                            setStudyTypedAnswer(event.target.value)
                          }
                          className="h-10 min-w-0 flex-1 rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-ui text-[var(--text-primary)] outline-none focus:border-[color-mix(in_oklab,var(--brand-primary)_55%,var(--border-default))]"
                          placeholder="Recall before revealing"
                        />
                        <button type="button" onClick={revealStudyAnswer}>
                          Check answer
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="spectra-deck-reveal"
                      onClick={revealStudyAnswer}
                    >
                      Reveal answer
                      <kbd>Space</kbd>
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
            </div>,
            document.body,
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

/**
 * One card-level choice.
 *
 * `path` is applied to the trigger rather than to the label wrapper, so an AI
 * edit or a peer's target resolves to the control that actually changes the
 * card (brief §3.3). `Field` can only decorate native tags, and a Radix trigger
 * is a component, so the annotation is made here instead of being handed over
 * and silently downgraded to the label's padding box.
 */
function CardChoice({
  label,
  path,
  aiActive = false,
  disabled,
  value,
  onChange,
  options,
}: {
  label: string;
  path: string;
  aiActive?: boolean;
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          size="sm"
          aria-label={label}
          className="w-full"
          data-ai-region={aiRegionAttr(aiActive)}
          {...targetAttrs(path)}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function CardFace({
  label,
  value,
  placeholder,
  onChange,
  onFocus,
  clozeMode = false,
  disabled = false,
  noteValue,
  onNoteChange,
  aiActive = false,
  aiNoteActive = false,
  path,
  notePath,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  clozeMode?: boolean;
  /** The viewer lacks `edit`. The face still reads; it does not accept typing. */
  disabled?: boolean;
  noteValue?: string;
  onNoteChange?: (value: string) => void;
  aiActive?: boolean;
  aiNoteActive?: boolean;
  /** Canonical pointer for the face, e.g. `/cards/2/front`. */
  path?: string;
  /** Canonical pointer for the hint field. */
  notePath?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function markCloze() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end) || "answer";
    const nextIndex =
      Math.max(0, ...clozeParts(value).map((part) => part.index)) + 1;
    const marker = `{{c${nextIndex}::${selected}}}`;
    onChange(`${value.slice(0, start)}${marker}${value.slice(end)}`);
    requestAnimationFrame(() => {
      textarea.focus();
      const selectionStart = start + `{{c${nextIndex}::`.length;
      textarea.setSelectionRange(
        selectionStart,
        selectionStart + selected.length,
      );
    });
  }

  return (
    <section data-card-face={label.toLowerCase()}>
      <div className="mb-2 flex items-center gap-2 text-micro font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        <span>{label}</span>
        {clozeMode ? (
          <>
            {disabled ? null : (
            <button
              type="button"
              onClick={markCloze}
              className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-chip border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-micro font-semibold normal-case tracking-normal text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              title="Select text, then create a cloze deletion"
            >
              <Focus className="h-3.5 w-3.5" />
              Make cloze
            </button>
            )}
            <span className="ml-auto normal-case tracking-normal text-[var(--text-tertiary)]">
              {clozeParts(value).length}{" "}
              {clozeParts(value).length === 1 ? "deletion" : "deletions"}
            </span>
          </>
        ) : null}
      </div>
      <div className={onNoteChange ? "spectra-card-face-shell" : undefined}>
        {clozeMode ? (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onFocus={() => onFocus?.()}
            data-ai-region={aiRegionAttr(aiActive)}
            {...(path ? targetAttrs(path) : {})}
            readOnly={disabled}
            className="min-h-[112px] w-full resize-none rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)] px-6 py-6 text-center font-display text-metric leading-snug text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,var(--brand-primary)_55%,var(--border-default))]"
            placeholder={placeholder}
          />
        ) : (
          <div data-ai-region={aiRegionAttr(aiActive)}>
            <ArtifactRichTextEditor
              value={value}
              onChange={onChange}
              onFocus={onFocus}
              path={path}
              placeholder={placeholder}
              variant="card"
              disabled={disabled}
            />
          </div>
        )}
        {onNoteChange ? (
          <input
            value={noteValue ?? ""}
            onChange={(event) => onNoteChange(event.target.value)}
            onFocus={() => onFocus?.()}
            data-ai-region={aiRegionAttr(aiNoteActive)}
            {...(notePath ? targetAttrs(notePath) : {})}
            className="spectra-card-face-note"
            readOnly={disabled}
            placeholder={disabled ? "" : "Add a note (optional)"}
            aria-label="Note or hint"
          />
        ) : null}
      </div>
      {clozeMode && clozeParts(value).length ? (
        <div className="mt-2 rounded-control border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
          <span className="mb-1 block text-micro font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            Study preview
          </span>
          <p className="font-serif text-subhead leading-6 text-[var(--text-secondary)]">
            {clozePrompt(value)}
          </p>
        </div>
      ) : null}
    </section>
  );
}
