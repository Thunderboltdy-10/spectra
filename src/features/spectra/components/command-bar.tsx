"use client";

import type { ReactNode } from "react";
import { ArrowUp, FileText, Image as ImageIcon, Loader2, Paperclip, Plus, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type CommandBarProps = {
  placeholder: string;
  menu?: ReactNode;
  context?: ReactNode;
  className?: string;
  onSubmit?: (value: string, attachments: CommandAttachment[]) => void | boolean | Promise<void | boolean>;
  busy?: boolean;
  allowAttachments?: boolean;
  onStop?: () => void;
  allowConcurrent?: boolean;
  onStartNewThread?: () => void;
};

export type CommandAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  handling: "pdf" | "text" | "docx" | "unsupported_image";
  data?: string;
  error?: string;
};

const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);

function readFile(file: File, mode: "text" | "data-url") {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => resolve(String(reader.result ?? ""));
    if (mode === "text") reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

export function CommandBar({ placeholder, menu, context, className, onSubmit, busy = false, allowAttachments = false, onStop, allowConcurrent = false, onStartNewThread }: CommandBarProps) {
  const [value, setValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<CommandAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [blockedAttempt, setBlockedAttempt] = useState(false);
  const sendingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasMenu = allowAttachments || Boolean(menu);

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const available = Math.max(0, 4 - attachments.length);
    const selected = Array.from(files).slice(0, available);
    const next = await Promise.all(selected.map(async (file): Promise<CommandAttachment> => {
      const base = { id: crypto.randomUUID(), name: file.name, mimeType: file.type || "application/octet-stream", size: file.size };
      if (file.type.startsWith("image/")) return { ...base, handling: "unsupported_image", error: "Spectra cannot inspect image attachments yet. Use PDF, DOCX, or text for this run." };
      if (file.type === "application/pdf") {
        if (file.size > 10 * 1024 * 1024) return { ...base, handling: "pdf", error: "PDFs must be 10 MB or smaller." };
        return { ...base, handling: "pdf", data: await readFile(file, "data-url") };
      }
      if (TEXT_TYPES.has(file.type) || /\.(txt|md|csv|json)$/i.test(file.name)) {
        if (file.size > 2 * 1024 * 1024) return { ...base, handling: "text", error: "Text files must be 2 MB or smaller." };
        return { ...base, handling: "text", data: await readFile(file, "text") };
      }
      if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(file.name)) {
        if (file.size > 8 * 1024 * 1024) return { ...base, handling: "docx", error: "Documents must be 8 MB or smaller." };
        return { ...base, handling: "docx", data: await readFile(file, "data-url") };
      }
      return { ...base, handling: "text", error: "This file type is not supported. Use PDF, DOCX, TXT, Markdown, CSV, or JSON." };
    }));
    setAttachments((current) => [...current, ...next]);
    setMenuOpen(false);
  }

  async function submit() {
    const next = value.trim();
    if (sendingRef.current || sending || !next || attachments.some((attachment) => attachment.error)) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const accepted = await onSubmit?.(next, attachments);
      if (accepted === false) return;
      setValue("");
      setAttachments([]);
      setMenuOpen(false);
    } catch {
      // The owning run surface reports the failure. Keep the draft intact for recovery.
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }, [value]);

  useEffect(() => { if (!busy) setBlockedAttempt(false); }, [busy]);

  return (
    <div ref={rootRef} className={cn("spectra-command-bar relative flex items-center gap-2", className)}>
      <input ref={fileInputRef} type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.csv,.json,image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { void addFiles(event.target.files); event.currentTarget.value = ""; }} />
      {menuOpen && hasMenu ? (
        <div role="menu" className="absolute bottom-[calc(100%+8px)] left-0 z-20 min-w-[220px] rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[0_6px_18px_rgba(0,0,0,0.10)]">
          {allowAttachments ? <button type="button" onClick={() => fileInputRef.current?.click()} className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><Paperclip className="h-4 w-4" />Attach a file</button> : null}
          {menu}
        </div>
      ) : null}
      <button
        type="button"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-[color-mix(in_oklab,var(--bg-elevated)_82%,transparent)] text-[var(--text-secondary)] shadow-[0_2px_8px_rgba(27,20,12,0.04)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-35"
        onClick={() => hasMenu && setMenuOpen((open) => !open)}
        disabled={!hasMenu}
        aria-label="Open actions"
        title="Add or attach"
      >
        <Plus className="h-4 w-4" />
      </button>
      <div className="spectra-command-surface flex min-h-12 min-w-0 flex-1 flex-col rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_3px_12px_rgba(27,20,12,0.08)]">
        {blockedAttempt ? <div className="mb-1 flex min-h-8 flex-wrap items-center gap-1.5 rounded-[8px] bg-[color-mix(in_oklab,var(--warning)_7%,var(--bg-primary))] px-2 py-1 text-[10px] text-[var(--text-secondary)]" role="alert"><span className="mr-auto font-medium text-[var(--text-primary)]">This selected conversation is still running. Deselect its tab or start a new thread to send separately.</span>{onStop ? <button type="button" onClick={onStop} className="rounded-[5px] px-1.5 py-1 font-semibold text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]">Stop current run</button> : null}{onStartNewThread ? <button type="button" onClick={() => { onStartNewThread(); setBlockedAttempt(false); }} className="rounded-[5px] bg-[var(--text-primary)] px-2 py-1 font-semibold text-[var(--bg-primary)]">Start new thread</button> : null}</div> : null}
        {attachments.length > 0 ? <div className="flex flex-wrap gap-1.5 px-1 pb-1.5">{attachments.map((attachment) => <div key={attachment.id} className={`flex max-w-[260px] items-center gap-2 rounded-[8px] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-[10px] ${attachment.error ? "text-[var(--danger)]" : "text-[var(--text-secondary)]"}`} title={attachment.error ?? attachment.name}>{attachment.handling === "unsupported_image" ? <ImageIcon className="h-3.5 w-3.5 shrink-0" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}<span className="min-w-0 truncate">{attachment.name}</span><span className="shrink-0 text-[var(--text-tertiary)]">{Math.max(1, Math.round(attachment.size / 1024))} KB</span><button type="button" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] hover:bg-[var(--bg-hover)]" onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} aria-label={`Remove ${attachment.name}`}><X className="h-3 w-3" /></button></div>)}</div> : null}
        <div className="flex items-end gap-2">
        {context ? <div className="-mb-1.5 -ml-1.5 -mt-1.5 flex w-[88px] shrink-0 self-stretch items-stretch overflow-hidden rounded-l-[11px] border-r border-[var(--border-default)]">{context}</div> : null}
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.preventDefault();
              if (busy && !allowConcurrent) { setBlockedAttempt(true); return; }
              if (sending) return;
              void submit();
            }
          }}
          placeholder={placeholder}
          className="max-h-32 min-h-9 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-2 text-[14px] leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
        {busy && allowConcurrent && onStop ? <button type="button" onClick={onStop} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]" aria-label="Stop active response" title="Stop active response"><Square className="h-3.5 w-3.5" /></button> : null}
        <button
          type="button"
          disabled={sending || !value.trim() || attachments.some((attachment) => Boolean(attachment.error))}
          onClick={() => {
            if (busy && !allowConcurrent) setBlockedAttempt(true);
            else void submit();
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--text-primary)] text-[var(--bg-primary)] disabled:bg-[var(--bg-secondary)] disabled:text-[var(--text-tertiary)]"
          aria-label="Send command"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
        </div>
      </div>
    </div>
  );
}
