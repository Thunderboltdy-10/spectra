"use client";

import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  ArrowUp,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Plus,
  Square,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useLocalAutocomplete } from "@/features/spectra/compute/autocomplete";
import { useSpectraPreferences } from "@/features/spectra/settings/preference-store";
import { transitionFor, useSpectraMotion } from "../motion";

type CommandBarProps = {
  placeholder: string;
  menu?: ReactNode;
  context?: ReactNode;
  className?: string;
  onSubmit?: (
    value: string,
    attachments: CommandAttachment[],
  ) => void | boolean | Promise<void | boolean>;
  busy?: boolean;
  allowAttachments?: boolean;
  /** When set, attachment bubbles render into this host (above the run tabs). */
  attachmentsPortalTarget?: HTMLElement | null;
  onStop?: () => void;
  allowConcurrent?: boolean;
  onStartNewThread?: () => void;
  activeRunId?: string;
  onSteer?: (
    runId: string,
    mode:
      | "refine_current_goal"
      | "redirect_next_step"
      | "replace_goal"
      | "cancel_current_action",
    text: string,
    attachments?: CommandAttachment[],
  ) => void | Promise<unknown>;
};

export type CommandAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  handling: "pdf" | "text" | "docx" | "xlsx" | "pptx" | "image";
  data?: string;
  error?: string;
};

const TEXT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

function readFile(file: File, mode: "text" | "data-url") {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => resolve(String(reader.result ?? ""));
    if (mode === "text") reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

export function CommandBarMenuItem({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "flex w-full items-center gap-2 rounded-chip px-2.5 py-2 text-left text-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Nested flyout that opens to the right of the parent menu item. */
export function CommandBarSubmenu({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  function clearClose() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function scheduleClose() {
    clearClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  }

  useEffect(() => () => clearClose(), []);

  return (
    <div
      className="relative"
      onMouseEnter={() => {
        clearClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <CommandBarMenuItem
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        {Icon ? (
          <Icon className="h-4 w-4 shrink-0" />
        ) : (
          <Plus className="h-4 w-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1">{label}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
      </CommandBarMenuItem>
      {open ? (
        <div
          role="menu"
          className="absolute bottom-0 left-[calc(100%+6px)] z-chrome max-h-[min(420px,70vh)] min-w-[220px] overflow-y-auto rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-card"
          onMouseEnter={clearClose}
          onMouseLeave={scheduleClose}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function AttachmentBubbles({
  attachments,
  onRemove,
}: {
  attachments: CommandAttachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div
      className="mb-2 flex w-full flex-wrap gap-1.5"
      aria-label="Attached files"
    >
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className={`flex max-w-[280px] items-center gap-2 overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1.5 text-micro shadow-card ${attachment.error ? "text-[var(--danger)]" : "text-[var(--text-secondary)]"}`}
          title={attachment.error ?? attachment.name}
        >
          {attachment.handling === "image" &&
          attachment.data &&
          !attachment.error ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={attachment.data}
              alt=""
              className="h-9 w-9 shrink-0 rounded-chip object-cover"
            />
          ) : attachment.handling === "image" ? (
            <ImageIcon className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <FileText className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="min-w-0">
            <span className="block truncate font-medium text-[var(--text-primary)]">
              {attachment.name}
            </span>
            <span className="block truncate text-[var(--text-tertiary)]">
              {attachment.error
                ? attachment.error
                : `${attachment.handling.toUpperCase()} · ${Math.max(1, Math.round(attachment.size / 1024))} KB`}
            </span>
          </span>
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-chip hover:bg-[var(--bg-hover)]"
            onClick={() => onRemove(attachment.id)}
            aria-label={`Remove ${attachment.name}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function CommandBar({
  placeholder,
  menu,
  context,
  className,
  onSubmit,
  busy = false,
  allowAttachments = false,
  attachmentsPortalTarget = null,
  onStop,
  allowConcurrent = false,
  activeRunId,
  onSteer,
}: CommandBarProps) {
  const [value, setValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<CommandAttachment[]>([]);
  const [sending, setSending] = useState(false);
  /* Command feedback resolves on the completion grammar: the action control
     crossfades between send / steer / stop instead of snapping. */
  const motionLevel = useSpectraMotion();
  const commandTransition = transitionFor("completion", motionLevel.level);
  const [queuedSubmissions, setQueuedSubmissions] = useState<
    Array<{ value: string; attachments: CommandAttachment[] }>
  >([]);
  const sendingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasMenu = allowAttachments || Boolean(menu);
  const autocompleteHintId = useId();
  const { preferences } = useSpectraPreferences();
  const autocomplete = useLocalAutocomplete({
    value,
    surface: "quick_chat",
    enabled:
      preferences.writing.smartCompletion &&
      preferences.writing.quickChatSuggestions,
    delayMs: preferences.writing.delayMs,
  });

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const available = Math.max(0, 4 - attachments.length);
    const selected = Array.from(files).slice(0, available);
    const next = await Promise.all(
      selected.map(async (file): Promise<CommandAttachment> => {
        const base = {
          id: crypto.randomUUID(),
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
        };
        if (
          file.type.startsWith("image/") ||
          /\.(png|jpe?g|webp|gif)$/i.test(file.name)
        ) {
          const mime = file.type || "image/png";
          if (
            !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
              mime,
            ) &&
            !/\.(png|jpe?g|webp|gif)$/i.test(file.name)
          )
            return {
              ...base,
              handling: "image",
              error: "Use a PNG, JPEG, WebP, or GIF image.",
            };
          if (file.size > 8 * 1024 * 1024)
            return {
              ...base,
              handling: "image",
              error: "Images must be 8 MB or smaller.",
            };
          return {
            ...base,
            mimeType: mime.startsWith("image/") ? mime : "image/png",
            handling: "image",
            data: await readFile(file, "data-url"),
          };
        }
        if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
          if (file.size > 10 * 1024 * 1024)
            return {
              ...base,
              handling: "pdf",
              error: "PDFs must be 10 MB or smaller.",
            };
          return {
            ...base,
            handling: "pdf",
            data: await readFile(file, "data-url"),
          };
        }
        if (
          TEXT_TYPES.has(file.type) ||
          /\.(txt|md|csv|json)$/i.test(file.name)
        ) {
          if (file.size > 2 * 1024 * 1024)
            return {
              ...base,
              handling: "text",
              error: "Text files must be 2 MB or smaller.",
            };
          return {
            ...base,
            handling: "text",
            data: await readFile(file, "text"),
          };
        }
        if (
          file.type ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          /\.docx$/i.test(file.name)
        ) {
          if (file.size > 8 * 1024 * 1024)
            return {
              ...base,
              handling: "docx",
              error: "Documents must be 8 MB or smaller.",
            };
          return {
            ...base,
            handling: "docx",
            data: await readFile(file, "data-url"),
          };
        }
        if (
          file.type ===
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
          /\.xlsx$/i.test(file.name)
        ) {
          if (file.size > 12 * 1024 * 1024)
            return {
              ...base,
              handling: "xlsx",
              error: "Excel workbooks must be 12 MB or smaller.",
            };
          return {
            ...base,
            handling: "xlsx",
            data: await readFile(file, "data-url"),
          };
        }
        if (
          file.type ===
            "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
          /\.pptx$/i.test(file.name)
        ) {
          if (file.size > 20 * 1024 * 1024)
            return {
              ...base,
              handling: "pptx",
              error: "PowerPoint presentations must be 20 MB or smaller.",
            };
          return {
            ...base,
            handling: "pptx",
            data: await readFile(file, "data-url"),
          };
        }
        return {
          ...base,
          handling: "text",
          error:
            "This file type is not supported. Use PDF, DOCX, XLSX, PPTX, TXT, Markdown, CSV, JSON, PNG, JPEG, WebP, or GIF.",
        };
      }),
    );
    setAttachments((current) => [...current, ...next]);
    setMenuOpen(false);
  }

  const dispatchSubmission = useCallback(
    async (draft: string, draftAttachments: CommandAttachment[]) => {
      if (sendingRef.current) return;
      sendingRef.current = true;
      setSending(true);
      try {
        const accepted = await onSubmit?.(draft, draftAttachments);
        if (accepted === false) {
          setValue(draft);
          setAttachments(draftAttachments);
        }
      } catch {
        setValue(draft);
        setAttachments(draftAttachments);
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [onSubmit],
  );

  async function submit() {
    const draft = value.trim();
    if (!draft || attachments.some((attachment) => attachment.error)) return;
    const draftAttachments = attachments;
    if (busy && !allowConcurrent) {
      if (activeRunId && onSteer) {
        setValue("");
        setAttachments([]);
        setMenuOpen(false);
        try {
          const accepted = await onSteer(
            activeRunId,
            "refine_current_goal",
            draft,
            draftAttachments,
          );
          if (accepted === false) {
            setValue(draft);
            setAttachments(draftAttachments);
          }
        } catch {
          setValue(draft);
          setAttachments(draftAttachments);
        }
        return;
      }
      setQueuedSubmissions((current) => [
        ...current,
        { value: draft, attachments: draftAttachments },
      ]);
      setValue("");
      setAttachments([]);
      setMenuOpen(false);
      return;
    }
    if (sendingRef.current || sending) return;
    sendingRef.current = true;
    // Clear immediately so a hung/slow run cannot leave the draft glued in QC.
    // Restore only when the run surface rejects the start.
    setValue("");
    setAttachments([]);
    setMenuOpen(false);
    sendingRef.current = false;
    await dispatchSubmission(draft, draftAttachments);
  }

  useEffect(() => {
    if (!menuOpen) return;
    function isInsideMenuUi(target: EventTarget | null) {
      if (!(target instanceof Node)) return false;
      // Close when clicking the composer/textarea/tabs — only the open menu
      // panel and the + trigger count as "inside".
      if (menuPanelRef.current?.contains(target)) return true;
      if (menuTriggerRef.current?.contains(target)) return true;
      return false;
    }
    // Capture phase so outside closes even when a parent stops bubbling
    // (workspace composer sits under pointer-events-none shells).
    function onPointerDown(event: globalThis.PointerEvent) {
      if (!isInsideMenuUi(event.target)) setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "32px";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 32), 128)}px`;
  }, [value]);

  useEffect(() => {
    if (busy || sending || sendingRef.current || queuedSubmissions.length === 0)
      return;
    const next = queuedSubmissions[0]!;
    setQueuedSubmissions((current) => current.slice(1));
    void dispatchSubmission(next.value, next.attachments);
  }, [busy, dispatchSubmission, queuedSubmissions, sending]);

  const removeAttachment = (id: string) =>
    setAttachments((current) => current.filter((item) => item.id !== id));

  const bubbles = (
    <AttachmentBubbles attachments={attachments} onRemove={removeAttachment} />
  );
  const portalReady =
    typeof document !== "undefined" && attachmentsPortalTarget != null;
  const showInlineBubbles = !portalReady;

  return (
    <div
      ref={rootRef}
      className={cn(
        "spectra-command-bar relative flex items-center gap-1",
        className,
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(event) => {
          void addFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
      {portalReady ? createPortal(bubbles, attachmentsPortalTarget) : null}
      {menuOpen && hasMenu ? (
        <div
          ref={menuPanelRef}
          role="menu"
          className="absolute bottom-[calc(100%+8px)] left-0 z-chrome min-w-[240px] rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-card"
          onClick={(event) => {
            const target = event.target as HTMLElement | null;
            if (!target) return;
            // Close after choosing a leaf action; keep open for the
            // "New artifact" flyout trigger (aria-haspopup).
            const button = target.closest("button");
            if (!button || button.getAttribute("aria-haspopup") === "menu")
              return;
            setMenuOpen(false);
          }}
        >
          {menu}
          {allowAttachments ? (
            <>
              {menu ? (
                <div className="my-1 h-px bg-[var(--border-subtle)]" />
              ) : null}
              <CommandBarMenuItem onClick={() => fileInputRef.current?.click()}>
                <Paperclip className="h-4 w-4" />
                Select files
              </CommandBarMenuItem>
            </>
          ) : null}
        </div>
      ) : null}
      <button
        ref={menuTriggerRef}
        type="button"
        className="mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_82%,transparent)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-35"
        onClick={() => hasMenu && setMenuOpen((open) => !open)}
        disabled={!hasMenu}
        aria-expanded={menuOpen}
        aria-label="Open actions"
        title="Add or attach"
      >
        <Plus className="h-4 w-4" />
      </button>
      <div className="spectra-command-surface flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-surface border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-card">
        {showInlineBubbles ? bubbles : null}
        <div className="flex items-center gap-2">
          {context ? (
            <div className="flex shrink-0 self-center">{context}</div>
          ) : null}
          <div className="relative flex min-h-8 min-w-0 flex-1 items-center">
            {autocomplete.suggestion ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 max-h-32 overflow-hidden whitespace-pre-wrap break-words px-2 py-1.5 text-ui leading-5"
              >
                <span className="invisible">{value}</span>
                <span className="text-[var(--text-tertiary)] opacity-70">
                  {autocomplete.suggestion.text}
                </span>
              </div>
            ) : null}
            <textarea
              ref={textareaRef}
              rows={1}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onCompositionStart={autocomplete.compositionStart}
              onCompositionEnd={autocomplete.compositionEnd}
              aria-describedby={
                autocomplete.suggestion ? autocompleteHintId : undefined
              }
              onKeyDown={(event) => {
                if (autocomplete.suggestion && event.key === "Escape") {
                  event.preventDefault();
                  autocomplete.dismiss();
                  return;
                }
                if (autocomplete.suggestion && event.key === "Tab") {
                  event.preventDefault();
                  setValue(autocomplete.accept("all"));
                  return;
                }
                if (
                  autocomplete.suggestion &&
                  event.key === "ArrowRight" &&
                  event.currentTarget.selectionStart === value.length &&
                  event.currentTarget.selectionEnd === value.length
                ) {
                  event.preventDefault();
                  setValue(autocomplete.accept("word"));
                  return;
                }
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229
                ) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder={placeholder}
              className="relative z-base max-h-32 min-h-8 w-full resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-ui leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
            />
            {autocomplete.suggestion ? (
              <span id={autocompleteHintId} className="sr-only">
                Suggestion available. Press Tab to accept all, Right Arrow to
                accept a word, or Escape to dismiss.
              </span>
            ) : null}
          </div>
          {busy && onStop ? (
            <button
              type="button"
              onClick={() => onStop()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]"
              aria-label="Stop active response"
              title="Stop active response"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            disabled={
              (sending && !(busy && !allowConcurrent)) ||
              !value.trim() ||
              attachments.some((attachment) => Boolean(attachment.error))
            }
            onClick={() => {
              void submit();
            }}
            className={`flex h-9 shrink-0 items-center justify-center rounded-control bg-[var(--text-primary)] text-[var(--bg-primary)] disabled:bg-[var(--bg-secondary)] disabled:text-[var(--text-tertiary)] ${busy && !allowConcurrent ? "min-w-14 px-3 text-micro font-semibold" : "w-9"}`}
            aria-label={
              busy && !allowConcurrent ? "Steer active run" : "Send command"
            }
            title={busy && !allowConcurrent ? "Steer the active run" : "Send"}
          >
            {(() => {
              const commandState =
                sending && !busy
                  ? "sending"
                  : busy && !allowConcurrent
                    ? "steer"
                    : "send";
              return (
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={commandState}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={commandTransition}
                    className="flex items-center justify-center"
                  >
                    {commandState === "sending" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : commandState === "steer" ? (
                      "Steer"
                    ) : (
                      <ArrowUp className="h-4 w-4" />
                    )}
                  </motion.span>
                </AnimatePresence>
              );
            })()}
          </button>
        </div>
      </div>
    </div>
  );
}
