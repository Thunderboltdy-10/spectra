"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Bug, Loader2, MessageSquare, ShieldAlert, Sparkles, Upload, X, CircleHelp, Timer } from "lucide-react";
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

const MAX_MESSAGE_LENGTH = 500;
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

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

export function GlobalUtilityDock({ placement = "floating", className }: GlobalUtilityDockProps) {
  const { sidebarOpen } = useSidebar();
  const pathname = usePathname();
  const isAuthRoute = pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up") || pathname.startsWith("/join");
  const inProfileBar = placement === "profile-bar";
  const [desktopViewport, setDesktopViewport] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [message, setMessage] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [autoScreenshot, setAutoScreenshot] = useState<string | null>(null);
  const [chatContext, setChatContext] = useState<ChatFeedbackContext | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const traceId = useMemo(
    () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `trace-${Date.now()}`),
    [],
  );

  useEffect(() => {
    const updateViewport = () => setDesktopViewport(window.innerWidth >= 768);
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    if (feedbackOpen) {
      let cancelled = false;
      const onContextResponse = (e: Event) => {
        setChatContext(((e as CustomEvent<ChatFeedbackContext>).detail ?? null));
      };
      window.addEventListener("ai-school:chat-context-response", onContextResponse);
      window.dispatchEvent(new Event("ai-school:request-chat-context"));

      import("html2canvas").then((mod) => {
        if (cancelled) return;
        mod.default(document.body, {
          backgroundColor: "#ffffff",
          scale: 0.8,
          logging: false,
          useCORS: false,
        })
          .then((canvas) => {
            if (cancelled) return;
            const dataUrl = canvas.toDataURL("image/jpeg", 0.5);
            const payloadLength = dataUrl.length - "data:image/jpeg;base64,".length;
            const byteEstimate = Math.ceil((payloadLength * 3) / 4);
            if (byteEstimate <= MAX_SCREENSHOT_BYTES) {
              setAutoScreenshot(dataUrl);
            } else {
              setAutoScreenshot(null);
            }
          })
          .catch(() => {});
      });

      return () => {
        cancelled = true;
        window.removeEventListener("ai-school:chat-context-response", onContextResponse);
      };
    } else {
      setAutoScreenshot(null);
      setChatContext(null);
    }
  }, [feedbackOpen]);

  useEffect(() => {
    const onOpenFeedback = () => {
      setTimerOpen(false);
      setFeedbackOpen(true);
    };
    const onOpenTimer = () => {
      setFeedbackOpen(false);
      setTimerOpen(true);
    };
    window.addEventListener("ai-school:open-feedback", onOpenFeedback);
    window.addEventListener("ai-school:open-focus-timer", onOpenTimer);
    return () => {
      window.removeEventListener("ai-school:open-feedback", onOpenFeedback);
      window.removeEventListener("ai-school:open-focus-timer", onOpenTimer);
    };
  }, []);

  const remaining = MAX_MESSAGE_LENGTH - message.length;
  const anchorTop = "1rem";
  const dockStyle = desktopViewport
    ? {
        top: "auto",
        right: "auto",
        left: sidebarOpen ? "0.75rem" : "0.9rem",
        bottom: "6.9rem",
        width: sidebarOpen ? "calc(320px - 1.5rem)" : undefined,
      }
    : { top: anchorTop };
  const panelStyle = desktopViewport
    ? {
        top: "auto",
        right: "auto",
        left: sidebarOpen ? "0.75rem" : "4.25rem",
        bottom: "10.8rem",
      }
    : { top: `calc(${anchorTop} + 3.6rem)` };

  function resetFeedbackForm() {
    setCategory("bug");
    setMessage("");
    setScreenshot(null);
  }

  async function submitFeedback(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      toast.error("Please describe your feedback.");
      return;
    }
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      toast.error(`Feedback must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
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
      const form = new FormData();
      form.set("category", category);
      form.set("message", trimmed);
      form.set("page", pathname);
      form.set("device", navigator.userAgent);
      form.set("traceId", traceId);

      const mode = inferModeFromPath(pathname);
      if (mode) {
        form.set("mode", mode);
      }
      if (screenshot) {
        form.set("screenshot", screenshot);
      }
      if (chatContext?.chatId) form.set("chatId", chatContext.chatId);
      if (chatContext?.lastMessage) form.set("lastMessage", chatContext.lastMessage);
      if (chatContext?.activeMode) form.set("activeMode", chatContext.activeMode);
      if (chatContext?.activeModel) form.set("activeModel", chatContext.activeModel);
      form.set("viewportSize", `${window.innerWidth}x${window.innerHeight}`);
      if (autoScreenshot && !screenshot) {
        form.set("autoScreenshot", autoScreenshot);
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
      setFeedbackOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit feedback");
    } finally {
      setSubmitting(false);
    }
  }

  if (isAuthRoute) {
    return null;
  }

  const feedbackPanel = (
    <aside
      className={cn(
        "pointer-events-auto w-[min(92vw,24rem)] rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-soft)]",
        inProfileBar
          ? "absolute bottom-[calc(100%+0.65rem)] left-1/2 z-[90] -translate-x-1/2"
          : "fixed right-4 z-[78] sm:right-5",
      )}
      style={inProfileBar ? undefined : panelStyle}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Feedback</p>
          <h2 className="font-display text-lg text-[var(--text-primary)]">Help us improve</h2>
        </div>
        <button
          type="button"
          onClick={() => setFeedbackOpen(false)}
          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
          aria-label="Close feedback form"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form className="space-y-3" onSubmit={(event) => void submitFeedback(event)}>
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
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs transition ${
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
            onChange={(event) => setMessage(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
            placeholder="What happened, what did you expect, and how can we improve?"
            className="max-h-[190px] min-h-[110px] w-full resize-none overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
            required
            maxLength={MAX_MESSAGE_LENGTH}
          />
          <p className="mt-1 text-right text-[11px] text-[var(--text-secondary)]">{remaining} characters left</p>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
            Screenshot (optional)
          </label>
          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]">
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
        </div>

        <div className="rounded-lg bg-[var(--bg-secondary)] px-2.5 py-2 text-[11px] text-[var(--text-secondary)]">
          Auto-context: <span className="font-medium text-[var(--text-primary)]">{pathname}</span>
        </div>

        {autoScreenshot ? (
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2">
            <p className="mb-1 text-[11px] font-medium text-[var(--text-secondary)]">Auto-captured screenshot</p>
            <Image
              src={autoScreenshot}
              alt="Auto-captured feedback context screenshot"
              className="max-h-28 w-full rounded-md border border-[var(--border-default)] object-cover"
              width={640}
              height={360}
              unoptimized
            />
          </div>
        ) : null}

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
    <div
      className={cn(
        inProfileBar
          ? "absolute bottom-[calc(100%+0.65rem)] left-1/2 z-[90] -translate-x-1/2"
          : "fixed right-4 z-[78] sm:right-5",
      )}
      style={inProfileBar ? undefined : panelStyle}
    >
      <StudyTimer
        open={timerOpen}
        onOpen={() => setTimerOpen(true)}
        onClose={() => setTimerOpen(false)}
      />
    </div>
  );

  return (
    <div className={cn(inProfileBar ? "relative" : "", className)}>
      <div
        className={cn(
          inProfileBar
            ? "flex items-center justify-center gap-2 rounded-xl border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-secondary)_80%,var(--bg-elevated))] px-2.5 py-2"
            : "pointer-events-none fixed right-4 z-[74] flex items-center gap-2 border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-soft)] sm:right-5",
          !inProfileBar &&
            (desktopViewport
              ? sidebarOpen
                ? "rounded-2xl px-2.5 py-2"
                : "flex-col rounded-2xl px-1.5 py-1.5"
              : "rounded-full px-2 py-1.5"),
        )}
        style={inProfileBar ? undefined : dockStyle}
        aria-label="Global utility actions"
      >
        <div className={cn(inProfileBar ? "" : "pointer-events-auto")}>
          <NotificationBell
            buttonClassName="h-9 w-9 rounded-full"
            contentClassName="z-[91]"
            align={inProfileBar ? "center" : "end"}
          />
        </div>

        <Button
          type="button"
          variant="secondary"
          size="icon"
          className={cn("h-9 w-9 rounded-full", inProfileBar ? "" : "pointer-events-auto")}
          onClick={() => {
            setTimerOpen((prev) => !prev);
            setFeedbackOpen(false);
          }}
          data-tour="utility-timer"
          aria-label={timerOpen ? "Close focus timer" : "Open focus timer"}
        >
          <Timer className="h-4 w-4" />
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="icon"
          className={cn("h-9 w-9 rounded-full", inProfileBar ? "" : "pointer-events-auto")}
          onClick={() => {
            setFeedbackOpen((prev) => !prev);
            setTimerOpen(false);
          }}
          data-tour="utility-feedback"
          aria-label={feedbackOpen ? "Close feedback form" : "Open feedback form"}
        >
          <MessageSquare className="h-4 w-4" />
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="icon"
          className={cn("h-9 w-9 rounded-full", inProfileBar ? "" : "pointer-events-auto")}
          onClick={() => {
            window.dispatchEvent(new CustomEvent("ai-school:open-tour"));
          }}
          data-tour="utility-tour"
          aria-label="Open page tour"
        >
          <CircleHelp className="h-4 w-4" />
        </Button>
      </div>

      {feedbackOpen ? feedbackPanel : null}
      {timerOpen ? timerPanel : null}
    </div>
  );
}
