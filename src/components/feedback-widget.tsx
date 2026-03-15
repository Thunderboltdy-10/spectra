"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, Bug, ImagePlus, Loader2, MessageSquare, Send, ShieldAlert, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const MAX_MESSAGE_LENGTH = 500;
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

const CATEGORY_OPTIONS = [
  { value: "bug", label: "Bug", icon: Bug },
  { value: "confusing", label: "Confusing", icon: MessageSquare },
  { value: "feature", label: "Feature", icon: Sparkles },
  { value: "safety", label: "Safety", icon: ShieldAlert },
] as const;

type FeedbackCategory = (typeof CATEGORY_OPTIONS)[number]["value"];

function inferModeFromPath(pathname: string) {
  if (pathname.startsWith("/flashcards")) return "flashcard";
  if (pathname.startsWith("/analytics")) return "general";
  if (pathname.startsWith("/agents")) return "general";
  if (pathname.startsWith("/models")) return "research";
  if (pathname === "/" || pathname.startsWith("/chat")) return "general";
  return undefined;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function FeedbackWidget() {
  const pathname = usePathname();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [message, setMessage] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [noEvidenceWarning, setNoEvidenceWarning] = useState(false);
  const traceId = useMemo(
    () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `trace-${Date.now()}`),
    [],
  );

  const remaining = MAX_MESSAGE_LENGTH - message.length;

  function resetForm() {
    setCategory("bug");
    setMessage("");
    setScreenshot(null);
    setNoEvidenceWarning(false);
  }

  async function compressCanvasToFile(canvas: HTMLCanvasElement): Promise<File | null> {
    const attempts = [0.78, 0.62, 0.48, 0.36];
    for (const quality of attempts) {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", quality);
      });
      if (!blob) continue;
      if (blob.size <= MAX_SCREENSHOT_BYTES) {
        return new File([blob], "auto-screenshot.jpg", { type: "image/jpeg" });
      }
    }
    return null;
  }

  async function captureScreenshot(): Promise<File | null> {
    try {
      const { default: html2canvas } = await import("html2canvas");
      await wait(220);
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));

      const canvas = await html2canvas(document.body, {
        backgroundColor: getComputedStyle(document.body).backgroundColor || "#f7f4ec",
        useCORS: true,
        allowTaint: false,
        scale: Math.min(window.devicePixelRatio || 1, 1.8),
        logging: false,
        width: window.innerWidth,
        height: window.innerHeight,
        x: window.scrollX,
        y: window.scrollY,
      });

      return compressCanvasToFile(canvas);
    } catch {
      return null;
    }
  }

  async function doSubmit(screenshotFile: File | null) {
    setSubmitting(true);
    setNoEvidenceWarning(false);
    setOpen(false);
    try {
      const form = new FormData();
      form.set("category", category);
      form.set("message", message.trim());
      form.set("page", pathname);
      form.set("device", navigator.userAgent);
      form.set("traceId", traceId);

      const mode = inferModeFromPath(pathname);
      if (mode) form.set("mode", mode);
      if (screenshotFile) form.set("screenshot", screenshotFile);

      const response = await fetch("/api/feedback", { method: "POST", body: form });

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
      resetForm();
    } catch (error) {
      setOpen(true);
      toast.error(error instanceof Error ? error.message : "Failed to submit feedback");
    } finally {
      setSubmitting(false);
    }
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
      await doSubmit(screenshot);
      return;
    }

    // No file attached — close widget and attempt auto-capture
    setOpen(false);
    const autoShot = await captureScreenshot();
    if (autoShot) {
      await doSubmit(autoShot);
      return;
    }

    // Auto-capture failed — reopen with warning
    setOpen(true);
    setNoEvidenceWarning(true);
  }

  if (!open) {
    return (
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 left-5 z-[70] h-12 w-12 rounded-full border border-white/20 bg-[linear-gradient(135deg,var(--accent-cyan),var(--accent-coral))] text-white shadow-[0_18px_34px_-20px_rgba(2,8,23,0.75)] hover:brightness-105"
        aria-label="Open feedback widget"
        title="Send feedback"
      >
        <MessageSquare className="h-5 w-5" />
      </Button>
    );
  }

  return (
    <aside data-feedback-widget data-html2canvas-ignore className="fixed bottom-5 left-5 z-[70] w-[min(92vw,22rem)] rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-soft)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Feedback</p>
          <h2 className="font-display text-lg text-[var(--text-primary)]">Help us improve</h2>
        </div>
        <button
          type="button"
          onClick={() => { setOpen(false); setNoEvidenceWarning(false); }}
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
            onChange={(event) => {
              setMessage(event.target.value.slice(0, MAX_MESSAGE_LENGTH));
              if (noEvidenceWarning) setNoEvidenceWarning(false);
            }}
            placeholder="What happened, what did you expect, and how can we improve?"
            className="max-h-[190px] min-h-[100px] w-full resize-none overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
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
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setScreenshot(file);
                if (file) setNoEvidenceWarning(false);
                event.currentTarget.value = "";
              }}
            />
            {screenshot ? <span>{formatFileSize(screenshot.size)}</span> : null}
          </label>
        </div>

        {/* No-evidence warning banner */}
        {noEvidenceWarning ? (
          <div className="rounded-xl border border-[color-mix(in_oklab,var(--warning)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_8%,var(--bg-secondary))] p-3">
            <div className="mb-2 flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />
              <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                <span className="font-semibold text-[var(--text-primary)]">No screenshot captured.</span>{" "}
                Adding a screenshot or attachment helps us reproduce the issue faster.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setNoEvidenceWarning(false);
                  window.setTimeout(() => fileInputRef.current?.click(), 50);
                }}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
              >
                <ImagePlus className="h-3.5 w-3.5" />
                Attach
              </button>
              <button
                type="button"
                onClick={() => void doSubmit(null)}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-inverse)] transition hover:brightness-105"
              >
                <Send className="h-3.5 w-3.5" />
                Send anyway
              </button>
            </div>
          </div>
        ) : null}

        <div className="rounded-lg bg-[var(--bg-secondary)] px-2.5 py-2 text-[11px] text-[var(--text-secondary)]">
          Auto-context: <span className="font-medium text-[var(--text-primary)]">{pathname}</span>
        </div>

        {!noEvidenceWarning ? (
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
        ) : null}
      </form>
    </aside>
  );
}
