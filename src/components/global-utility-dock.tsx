"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import {
  Bug,
  CircleHelp,
  Loader2,
  MessageSquare,
  ShieldAlert,
  Sparkles,
  Timer,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import { NotificationBell } from "@/components/notification-bell";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/context/sidebar-context";
import { cn } from "@/lib/utils";

const StudyTimer = dynamic(
  () => import("@/components/study-timer").then((module) => module.StudyTimer),
  { ssr: false },
);

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const AUTO_SCREENSHOT_NAME = "page-screenshot.jpg";

type UtilityPanel = "none" | "feedback" | "timer" | "info";

type TimerSnapshot = {
  display: string;
  isRunning: boolean;
  progress: number;
};

type PanelAnchor = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const CATEGORY_OPTIONS = [
  { value: "bug", label: "Bug", icon: Bug },
  { value: "confusing", label: "Confusing", icon: MessageSquare },
  { value: "feature", label: "Feature", icon: Sparkles },
  { value: "safety", label: "Safety", icon: ShieldAlert },
] as const;

type FeedbackCategory = (typeof CATEGORY_OPTIONS)[number]["value"];
type ChatFeedbackContext = {
  chatId?: string;
  lastMessage?: string;
  activeMode?: string;
  activeModel?: string;
};

type GlobalUtilityDockProps = {
  placement?: "floating" | "profile-bar";
  className?: string;
};

function inferModeFromPath(pathname: string) {
  if (pathname.startsWith("/flashcards")) return "flashcard";
  if (pathname.startsWith("/analytics")) return "general";
  if (pathname.startsWith("/agents")) return "general";
  if (pathname.startsWith("/models")) return "research";
  if (pathname === "/") return "general";
  return undefined;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function estimateDataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Math.ceil((base64.length * 3) / 4);
}

function dataUrlToFile(dataUrl: string, fileName: string) {
  const [header, payload] = dataUrl.split(",");
  if (!header || !payload) return null;
  const mimeMatch = header.match(/^data:(.*?);base64$/);
  const mimeType = mimeMatch?.[1] || "image/jpeg";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], fileName, { type: mimeType });
}

function extractImageFromClipboard(clipboardData: DataTransfer | null) {
  if (!clipboardData) return null;
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
}

function UtilityActionButton(props: {
  label: string;
  active?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  dataTour?: string;
  ariaLabel?: string;
  progress?: number;
  buttonClassName?: string;
}) {
  const {
    label,
    active = false,
    onClick,
    icon,
    dataTour,
    ariaLabel,
    progress,
    buttonClassName,
  } = props;
  const progressWidth = Math.max(0, Math.min(100, Math.round((progress ?? 0) * 100)));

  return (
    <div className="group/utility-btn relative w-fit">
      <Button
        type="button"
        variant="secondary"
        size="icon"
        className={cn(
          "h-9.5 w-9.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
          active && "text-[var(--text-primary)]",
          buttonClassName,
        )}
        onClick={onClick}
        data-tour={dataTour}
        aria-label={ariaLabel ?? label}
      >
        {icon}
      </Button>
      <span className="pointer-events-none absolute -top-8 left-1/2 z-[95] -translate-x-1/2 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--text-secondary)] opacity-0 shadow-[var(--shadow-soft)] transition group-hover/utility-btn:opacity-100">
        {label}
      </span>
      {typeof progress === "number" && progressWidth > 0 ? (
        <span className="pointer-events-none absolute -bottom-1 left-0 right-0 h-0.5 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
          <span className="block h-full bg-[var(--accent-cyan)]" style={{ width: `${progressWidth}%` }} />
        </span>
      ) : null}
    </div>
  );
}

export function GlobalUtilityDock({ placement = "floating", className }: GlobalUtilityDockProps) {
  const { sidebarOpen } = useSidebar();
  const pathname = usePathname();
  const isAuthRoute = pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up") || pathname.startsWith("/join");
  const inProfileBar = placement === "profile-bar";

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [desktopViewport, setDesktopViewport] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [panelAnchor, setPanelAnchor] = useState<PanelAnchor | null>(null);
  const [activePanel, setActivePanel] = useState<UtilityPanel>("none");
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [message, setMessage] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [chatContext, setChatContext] = useState<ChatFeedbackContext | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [timerSnapshot, setTimerSnapshot] = useState<TimerSnapshot | null>(null);
  const traceId = useMemo(
    () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `trace-${Date.now()}`),
    [],
  );

  const feedbackOpen = activePanel === "feedback";
  const timerOpen = activePanel === "timer";
  const infoOpen = activePanel === "info";
  const closeNotifications = useCallback(() => {
    window.dispatchEvent(new Event("ai-school:close-notifications"));
  }, []);

  useEffect(() => {
    const updateViewport = () => {
      setDesktopViewport(window.innerWidth >= 768);
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateAnchor = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPanelAnchor({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
    };
    updateAnchor();
    window.addEventListener("resize", updateAnchor);
    window.addEventListener("scroll", updateAnchor, { passive: true });
    return () => {
      window.removeEventListener("resize", updateAnchor);
      window.removeEventListener("scroll", updateAnchor);
    };
  }, [activePanel, desktopViewport, inProfileBar, sidebarOpen]);

  useEffect(() => {
    const onTimerState = (event: Event) => {
      const detail = (event as CustomEvent<TimerSnapshot>).detail;
      if (!detail) return;
      setTimerSnapshot({
        display: detail.display,
        isRunning: Boolean(detail.isRunning),
        progress: Number.isFinite(detail.progress) ? Math.max(0, Math.min(1, detail.progress)) : 0,
      });
    };
    window.addEventListener("ai-school:timer-state", onTimerState as EventListener);
    return () => window.removeEventListener("ai-school:timer-state", onTimerState as EventListener);
  }, []);

  useEffect(() => {
    if (activePanel === "none") return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target)) {
        setActivePanel("none");
        closeNotifications();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [activePanel, closeNotifications]);

  const waitForUiToSettle = useCallback(
    () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve());
        });
      }),
    [],
  );

  const captureAutoScreenshot = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const html2canvas = (await import("html2canvas")).default;
      const root = document.documentElement;
      const canvas = await html2canvas(root, {
        backgroundColor: "#ffffff",
        scale: Math.min(window.devicePixelRatio || 1, 1),
        logging: false,
        useCORS: true,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        windowWidth: root.clientWidth,
        windowHeight: root.clientHeight,
      });

      const qualityCandidates = [0.8, 0.72, 0.64, 0.56, 0.48];
      for (const quality of qualityCandidates) {
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (estimateDataUrlBytes(dataUrl) > MAX_SCREENSHOT_BYTES) continue;
        const file = dataUrlToFile(dataUrl, AUTO_SCREENSHOT_NAME);
        if (!file) continue;
        return { dataUrl, file };
      }

      if (options?.silent) {
        return null;
      } else {
        throw new Error("Auto capture exceeded 2MB. You can still paste or attach an image.");
      }
    } catch (error) {
      console.warn("html2canvas failed:", error);
      if (options?.silent) {
        return null;
      } else {
        throw new Error("Auto screenshot unavailable. Paste or attach one manually.");
      }
    }
  }, []);

  useEffect(() => {
    if (!feedbackOpen) {
      setChatContext(null);
      return;
    }

    let cancelled = false;
    const onContextResponse = (e: Event) => {
      if (cancelled) return;
      setChatContext(((e as CustomEvent<ChatFeedbackContext>).detail ?? null));
    };
    window.addEventListener("ai-school:chat-context-response", onContextResponse);
    window.dispatchEvent(new Event("ai-school:request-chat-context"));

    return () => {
      cancelled = true;
      window.removeEventListener("ai-school:chat-context-response", onContextResponse);
    };
  }, [feedbackOpen]);

  useEffect(() => {
    const onOpenFeedback = () => {
      closeNotifications();
      setActivePanel("feedback");
    };
    const onOpenTimer = () => {
      closeNotifications();
      setActivePanel("timer");
    };
    const onOpenTour = () => {
      closeNotifications();
      setActivePanel("info");
    };
    window.addEventListener("ai-school:open-feedback", onOpenFeedback);
    window.addEventListener("ai-school:open-focus-timer", onOpenTimer);
    window.addEventListener("ai-school:open-tour", onOpenTour);
    return () => {
      window.removeEventListener("ai-school:open-feedback", onOpenFeedback);
      window.removeEventListener("ai-school:open-focus-timer", onOpenTimer);
      window.removeEventListener("ai-school:open-tour", onOpenTour);
    };
  }, [closeNotifications]);

  const dockStyle = inProfileBar
    ? undefined
    : desktopViewport
      ? {
          top: "auto",
          right: "auto",
          left: sidebarOpen ? "0.75rem" : "0.9rem",
          bottom: "6.9rem",
          width: sidebarOpen ? "calc(320px - 1.5rem)" : undefined,
        }
      : {
          right: "0.75rem",
          bottom: "5.4rem",
        };

  const panelClassName = desktopViewport
    ? "fixed z-[280]"
    : inProfileBar
      ? "absolute bottom-[calc(100%+0.65rem)] left-0 z-[280] w-full"
      : "absolute bottom-[calc(100%+0.65rem)] right-0 z-[280]";

  const panelStyle = useMemo<CSSProperties | undefined>(() => {
    if (!desktopViewport) return undefined;
    if (!panelAnchor) return undefined;
    const bottomOffset = Math.max(12, Math.round(viewportHeight - panelAnchor.top + 10));
    return {
      left: "8px",
      bottom: `${bottomOffset}px`,
      minWidth: "360px",
      maxWidth: "460px",
    };
  }, [desktopViewport, panelAnchor, viewportHeight]);

  function resetFeedbackForm() {
    setCategory("bug");
    setMessage("");
    setScreenshot(null);
  }

  function togglePanel(panel: Exclude<UtilityPanel, "none">) {
    closeNotifications();
    setActivePanel((prev) => (prev === panel ? "none" : panel));
  }

  function handleFeedbackPaste(event: React.ClipboardEvent<HTMLElement>) {
    const pastedImage = extractImageFromClipboard(event.clipboardData);
    if (!pastedImage) return;
    event.preventDefault();
    if (pastedImage.size > MAX_SCREENSHOT_BYTES) {
      toast.error("Pasted image is larger than 2MB.");
      return;
    }
    setScreenshot(pastedImage);
    toast.success("Screenshot pasted.");
  }

  async function submitFeedback(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      toast.error("Please describe your feedback.");
      return;
    }
    if (screenshot) {
      if (!screenshot.type.startsWith("image/")) {
        toast.error("Screenshot must be an image.");
        return;
      }
      if (screenshot.size > MAX_SCREENSHOT_BYTES) {
        toast.error("Screenshot must be 2MB or smaller.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const contextSnapshot = chatContext;
      const manualScreenshot = screenshot;
      setActivePanel("none");
      closeNotifications();

      let capturedScreenshot: Awaited<ReturnType<typeof captureAutoScreenshot>> = null;
      if (!manualScreenshot) {
        await waitForUiToSettle();
        capturedScreenshot = await captureAutoScreenshot({ silent: true });
      }

      const form = new FormData();
      form.set("category", category);
      form.set("message", trimmed);
      form.set("page", pathname);
      form.set("device", navigator.userAgent);
      form.set("traceId", traceId);

      const mode = inferModeFromPath(pathname);
      if (mode) form.set("mode", mode);
      if (manualScreenshot) {
        form.set("screenshot", manualScreenshot);
      } else if (capturedScreenshot?.file) {
        form.set("screenshot", capturedScreenshot.file);
      }
      if (contextSnapshot?.chatId) form.set("chatId", contextSnapshot.chatId);
      if (contextSnapshot?.lastMessage) form.set("lastMessage", contextSnapshot.lastMessage);
      if (contextSnapshot?.activeMode) form.set("activeMode", contextSnapshot.activeMode);
      if (contextSnapshot?.activeModel) form.set("activeModel", contextSnapshot.activeModel);
      form.set("viewportSize", `${window.innerWidth}x${window.innerHeight}`);
      if (!manualScreenshot && capturedScreenshot?.dataUrl) {
        form.set("autoScreenshot", capturedScreenshot.dataUrl);
      }

      const response = await fetch("/api/feedback", {
        method: "POST",
        body: form,
      });

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } | string }
          | null;
        const messageFromResponse =
          typeof errorPayload?.error === "string"
            ? errorPayload.error
            : errorPayload?.error?.message;
        throw new Error(messageFromResponse || "Failed to submit feedback");
      }

      toast.success("Feedback sent. Thank you.");
      resetFeedbackForm();
    } catch (error) {
      setActivePanel("feedback");
      toast.error(error instanceof Error ? error.message : "Failed to submit feedback");
    } finally {
      setSubmitting(false);
    }
  }

  if (isAuthRoute) {
    return null;
  }

  const timerChipVisible = Boolean(timerSnapshot?.isRunning || (timerSnapshot?.progress ?? 0) > 0.01);

  const feedbackPanel = (
    <aside
      className={cn("w-[min(92vw,24rem)] rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-soft)]", panelClassName)}
      style={panelStyle}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Feedback</p>
          <h2 className="font-display text-lg text-[var(--text-primary)]">Help us improve</h2>
        </div>
        <button
          type="button"
          onClick={() => setActivePanel("none")}
          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
          aria-label="Close feedback form"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form className="space-y-3" onSubmit={(event) => void submitFeedback(event)} onPaste={handleFeedbackPaste}>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
            Category
          </label>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORY_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = category === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setCategory(option.value)}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs transition ${
                    active
                      ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,var(--bg-elevated))] text-[var(--text-primary)]"
                      : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
                  aria-pressed={active}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor="feedback-message" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
            Details
          </label>
          <textarea
            id="feedback-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="What happened, what did you expect, and how can we improve?"
            className="max-h-[190px] min-h-[110px] w-full resize-none overflow-y-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-transparent focus:ring-0 focus-visible:border-transparent focus-visible:ring-0"
            required
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
            Screenshot (optional)
          </label>
          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]">
            <span className="inline-flex items-center gap-1.5">
              <Upload className="h-3.5 w-3.5" />
              {screenshot ? screenshot.name : "Attach image up to 2MB"}
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setScreenshot(file);
                event.currentTarget.value = "";
              }}
            />
            {screenshot ? <span>{formatFileSize(screenshot.size)}</span> : null}
          </label>
          <p className="mt-1 text-[10px] text-[var(--text-secondary)]">
            Tip: paste a screenshot directly here with Ctrl/Cmd+V. If you skip it, we will capture the page after this popup closes.
          </p>
        </div>

        <div className="rounded-md bg-[var(--bg-secondary)] px-2.5 py-2 text-[11px] text-[var(--text-secondary)]">
          Auto-context: <span className="font-medium text-[var(--text-primary)]">{pathname}</span>
        </div>

        <p className="text-[10px] text-[var(--text-secondary)]">
          Feedback screenshots are used only for debugging this report and are not used for model training.
        </p>

        <Button type="submit" className="w-full gap-2" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Sending...
            </>
          ) : (
            "Send feedback"
          )}
        </Button>
      </form>
    </aside>
  );

  const timerPanel = (
    <div className={panelClassName} style={panelStyle}>
      <StudyTimer
        className={inProfileBar ? "w-full max-w-none" : undefined}
        open={timerOpen}
        onOpen={() => setActivePanel("timer")}
        onClose={() => setActivePanel("none")}
      />
    </div>
  );

  const infoPanel = (
    <aside
      className={cn("w-[min(92vw,22rem)] rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-soft)]", panelClassName)}
      style={panelStyle}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Info</p>
        <button
          type="button"
          onClick={() => setActivePanel("none")}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          aria-label="Close info panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-2 text-xs text-[var(--text-secondary)]">
        <p>Tips rotate in chat based on context. Use them for faster workflows.</p>
        <p>Keyboard: <span className="font-medium text-[var(--text-primary)]">Cmd/Ctrl + K</span> for quick mode switch.</p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("ai-school:open-tour"))}
            className="rounded-md border border-[var(--border-default)] px-2 py-1 text-[11px] transition hover:bg-[var(--bg-hover)]"
          >
            Start tour
          </button>
          <button
            type="button"
            onClick={() => setActivePanel("feedback")}
            className="rounded-md border border-[var(--border-default)] px-2 py-1 text-[11px] transition hover:bg-[var(--bg-hover)]"
          >
            Report issue
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <div
      ref={rootRef}
      className={cn(inProfileBar ? "relative" : "fixed z-[74]", className)}
      style={dockStyle}
    >
      {inProfileBar && timerChipVisible && (typeof timerSnapshot?.progress === "number") && (
        <div className="mb-1 h-0.5 w-full overflow-hidden rounded-full bg-[var(--bg-secondary)]">
          <div
            className="h-full bg-[var(--accent-cyan)] transition-all duration-500"
            style={{ width: `${Math.round((timerSnapshot.progress) * 100)}%` }}
          />
        </div>
      )}
      <div className="relative">
        <div
          className={cn(
            inProfileBar
              ? "flex w-full items-center justify-between gap-2"
              : "inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-1.5 py-1 shadow-[var(--shadow-soft)]",
          )}
          aria-label="Global utility actions"
        >
          <div className="group/utility-btn relative w-fit" onClickCapture={() => setActivePanel("none")}>
            <NotificationBell
              buttonClassName="h-9.5 w-9.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]"
              contentClassName="z-[98]"
              align={inProfileBar ? "start" : "end"}
              side={inProfileBar || desktopViewport ? "left" : "top"}
              sideOffset={10}
              onOpenChange={(open) => {
                if (open) {
                  setActivePanel("none");
                }
              }}
            />
            <span className="pointer-events-none absolute -top-8 left-1/2 z-[95] -translate-x-1/2 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--text-secondary)] opacity-0 shadow-[var(--shadow-soft)] transition group-hover/utility-btn:opacity-100">
              Notifications
            </span>
          </div>

          <UtilityActionButton
            label="Timer"
            active={timerOpen}
            onClick={() => togglePanel("timer")}
            icon={<Timer className="h-4 w-4" />}
            dataTour="utility-timer"
            ariaLabel={timerOpen ? "Close focus timer" : "Open focus timer"}
            progress={timerChipVisible ? timerSnapshot?.progress : undefined}
            buttonClassName="rounded-xl"
          />

          <UtilityActionButton
            label="Feedback"
            active={feedbackOpen}
            onClick={() => togglePanel("feedback")}
            icon={<MessageSquare className="h-4 w-4" />}
            dataTour="utility-feedback"
            ariaLabel={feedbackOpen ? "Close feedback form" : "Open feedback form"}
            buttonClassName="rounded-xl"
          />

          <UtilityActionButton
            label="Info"
            active={infoOpen}
            onClick={() => togglePanel("info")}
            icon={<CircleHelp className="h-4 w-4" />}
            dataTour="utility-tour"
            ariaLabel={infoOpen ? "Close info panel" : "Open info panel"}
            buttonClassName="rounded-xl"
          />
        </div>

        {feedbackOpen ? feedbackPanel : null}
        {timerOpen ? timerPanel : null}
        {infoOpen ? infoPanel : null}
      </div>
    </div>
  );
}
