"use client";

import type { ReactNode } from "react";
import { ArrowUp, FileText, Image as ImageIcon, Loader2, Paperclip, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type CommandBarProps = {
  placeholder: string;
  menu?: ReactNode;
  context?: ReactNode;
  className?: string;
  onSubmit?: (value: string, attachments: CommandAttachment[]) => void | boolean;
  busy?: boolean;
  allowAttachments?: boolean;
  onStop?: () => void;
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

export function CommandBar({ placeholder, menu, context, className, onSubmit, busy = false, allowAttachments = false, onStop }: CommandBarProps) {
  const [value, setValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<CommandAttachment[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasMenu = allowAttachments || Boolean(menu);

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const available = Math.max(0, 4 - attachments.length);
    const selected = Array.from(files).slice(0, available);
    const next = await Promise.all(selected.map(async (file): Promise<CommandAttachment> => {
      const base = { id: crypto.randomUUID(), name: file.name, mimeType: file.type || "application/octet-stream", size: file.size };
      if (file.type.startsWith("image/")) return { ...base, handling: "unsupported_image", error: "The fixed DeepSeek route cannot inspect images yet." };
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

  function submit() {
    const next = value.trim();
    if (!next || attachments.some((attachment) => attachment.error)) return;
    if (onSubmit?.(next, attachments) === false) return;
    setValue("");
    setAttachments([]);
    setMenuOpen(false);
  }

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  return (
    <div ref={rootRef} className={cn("relative flex items-center gap-2", className)}>
      <input ref={fileInputRef} type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.csv,.json,image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { void addFiles(event.target.files); event.currentTarget.value = ""; }} />
      {menuOpen && hasMenu ? (
        <div className="absolute bottom-[calc(100%+8px)] left-0 z-20 min-w-[220px] rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[0_6px_18px_rgba(0,0,0,0.10)]">
          {allowAttachments ? <button type="button" onClick={() => fileInputRef.current?.click()} className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><Paperclip className="h-4 w-4" />Attach a file</button> : null}
          {menu}
        </div>
      ) : null}
      <button
        type="button"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[0_2px_8px_rgba(27,20,12,0.05)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        onClick={() => hasMenu && setMenuOpen((open) => !open)}
        disabled={!hasMenu}
        aria-label="Open actions"
      >
        <Plus className="h-4 w-4" />
      </button>
      <div className="flex min-h-12 min-w-0 flex-1 flex-col rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_3px_12px_rgba(27,20,12,0.08)]">
        {attachments.length > 0 ? <div className="flex flex-wrap gap-1.5 px-1 pb-1.5">{attachments.map((attachment) => <div key={attachment.id} className={`flex max-w-[260px] items-center gap-2 rounded-[8px] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-[10px] ${attachment.error ? "text-[var(--danger)]" : "text-[var(--text-secondary)]"}`} title={attachment.error ?? attachment.name}>{attachment.handling === "unsupported_image" ? <ImageIcon className="h-3.5 w-3.5 shrink-0" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}<span className="min-w-0 truncate">{attachment.name}</span><span className="shrink-0 text-[var(--text-tertiary)]">{Math.max(1, Math.round(attachment.size / 1024))} KB</span><button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} aria-label={`Remove ${attachment.name}`}><X className="h-3 w-3" /></button></div>)}</div> : null}
        <div className="flex items-end gap-2">
        {context ? <div className="hidden h-9 shrink-0 items-center border-r border-[var(--border-default)] pr-2 md:flex">{context}</div> : null}
        <textarea
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (busy) return;
              submit();
            }
          }}
          placeholder={placeholder}
          className="max-h-[80px] min-h-9 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[14px] leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
        <button
          type="button"
          disabled={busy ? !onStop : !value.trim() || attachments.some((attachment) => Boolean(attachment.error))}
          onClick={() => {
            if (busy && onStop) onStop();
            else submit();
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--text-primary)] text-[var(--bg-primary)] disabled:bg-[var(--bg-secondary)] disabled:text-[var(--text-tertiary)]"
          aria-label="Send command"
        >
          {busy ? onStop ? <X className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
        </div>
      </div>
    </div>
  );
}
