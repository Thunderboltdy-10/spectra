"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useCallback, type ReactNode, type KeyboardEvent, type ClipboardEvent } from "react";
import {
  ArrowUp,
  Square,
  Mic,
  Paperclip,
  ChevronDown,
  ChevronUp,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpeechToText } from "@/hooks/use-speech-to-text";

export type QuickChatProps = {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  isStreaming?: boolean;
  isProcessing?: boolean;
  disabled?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onMicUnsupported?: () => void;
  showMic?: boolean;
  showSpeechStatus?: boolean;
  placeholder?: string;
  className?: string;
  
  // Attachments
  files?: File[];
  onFilesAdd?: (files: File[]) => void;
  onRemoveFile?: (file: File) => void;
  fileUploadState?: Record<string, { status: "pending" | "uploading" | "processing" | "ready" | "error"; thumbnailUrl?: string; error?: string }>;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  
  // Custom Left/Right Content
  leftContent?: ReactNode;
  rightContent?: ReactNode;
  topContent?: ReactNode;
};

export function QuickChat({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming = false,
  isProcessing = false,
  disabled = false,
  onKeyDown,
  onMicUnsupported,
  showMic = true,
  showSpeechStatus = false,
  placeholder = "Ask anything. Include your context and goal.",
  className,
  files = [],
  onFilesAdd,
  onRemoveFile,
  fileUploadState = {},
  textareaRef,
  leftContent,
  rightContent,
  topContent,
}: QuickChatProps) {
  const [focused, setFocused] = useState(false);
  const [mounted, setMounted] = useState(false);
  const innerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const resolvedTextareaRef = textareaRef ?? innerTextareaRef;
  const speech = useSpeechToText();
  const listeningBaseValueRef = useRef<string | null>(null);
  const [attachmentsExpanded, setAttachmentsExpanded] = useState(true);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const el = resolvedTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [resolvedTextareaRef, value]);

  useEffect(() => {
    if (!speech.isListening) {
      listeningBaseValueRef.current = null;
      return;
    }
    if (listeningBaseValueRef.current === null) {
      listeningBaseValueRef.current = value;
    }
    const baseValue = listeningBaseValueRef.current ?? "";
    const transcript = speech.transcript.trim();
    const nextValue = [baseValue.trim(), transcript].filter(Boolean).join(baseValue.trim() ? " " : "");
    if (nextValue !== value) {
      onChange(nextValue);
    }
  }, [onChange, speech.isListening, speech.transcript, value]);

  const toggleMic = useCallback(() => {
    if (!speech.isSupported) {
      onMicUnsupported?.();
      return;
    }
    if (speech.isListening) {
      speech.stop();
      speech.reset();
      listeningBaseValueRef.current = null;
      return;
    }
    listeningBaseValueRef.current = value;
    speech.start();
  }, [onMicUnsupported, speech, value]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming && onStop) onStop();
      else if (!disabled && value.trim()) onSubmit();
    }
  }, [disabled, isStreaming, onKeyDown, onStop, onSubmit, value]);

  const handlePaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onFilesAdd) return;
    const items = Array.from(e.clipboardData.items);
    const files = items.map(i => i.getAsFile()).filter(Boolean) as File[];
    if (files.length > 0) {
      e.preventDefault();
      onFilesAdd(files);
    }
  }, [onFilesAdd]);

  function fileKey(file: File) {
    return `${file.name}-${file.size}-${file.lastModified}`;
  }

  function renderStatus(status: string, warning?: string) {
    if (status === "uploading" || status === "processing") {
      return <Loader2 className="h-3 w-3 animate-spin text-[var(--text-secondary)]" />;
    }
    if (status === "ready") {
      if (warning) return <AlertCircle className="h-3 w-3 text-[var(--warning)]" />;
      return <CheckCircle2 className="h-3 w-3 text-[var(--success)]" />;
    }
    if (status === "error") {
      return <AlertCircle className="h-3 w-3 text-[var(--danger)]" />;
    }
    return null;
  }

  return (
    <div className={cn("relative flex flex-col mx-auto min-w-[320px] transition-all duration-300", focused ? "w-full" : "w-[96%]", className)}>
      {files.length > 0 && (
        <div data-spectra-card="inbox" className="mb-2 w-[95%] mx-auto overflow-hidden rounded-[10px]">
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[var(--border-default)]/40">
            <button
              type="button"
              onClick={() => setAttachmentsExpanded((prev) => !prev)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
            >
              <Paperclip className="h-3.5 w-3.5" />
              {files.length} attachment{files.length === 1 ? "" : "s"}
              {attachmentsExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            </button>
          </div>
          {attachmentsExpanded && (
            <div className="p-2 flex flex-wrap gap-2 max-h-[120px] overflow-y-auto">
              {files.map((file) => {
                const state = fileUploadState[fileKey(file)] || { status: "pending" };
                const extension = file.name.split(".").pop()?.toUpperCase().slice(0, 4) || "FILE";
                return (
                  <div key={fileKey(file)} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs">
                    {state.thumbnailUrl ? (
                      <Image src={state.thumbnailUrl} alt="" width={32} height={32} className="h-8 w-8 rounded-md object-cover" unoptimized />
                    ) : (
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] text-[9px] font-bold text-[var(--text-secondary)]">
                        {extension}
                      </span>
                    )}
                    <span className="max-w-[120px] truncate">{file.name}</span>
                    {renderStatus(state.status, state.error)}
                    <button type="button" onClick={() => onRemoveFile?.(file)} className="spectra-icon-action h-6 w-6 text-[var(--text-tertiary)] hover:text-[var(--danger)]" aria-label={`Remove ${file.name}`} title={`Remove ${file.name}`}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}


      <div className="flex items-end gap-2 w-full">
        {leftContent && (
          <div className="flex items-center gap-1.5 shrink-0 self-end mb-[2px]">
            {leftContent}
          </div>
        )}

        <div
          data-spectra-card="result"
          data-card-state={isStreaming ? "continued" : focused ? "focused" : "normal"}
          className={cn(
            "spectra-quick-chat relative flex flex-1 flex-col gap-0 border backdrop-blur-xl",
            "transition-all duration-300 ease-[var(--ease-standard)]",
            focused
              ? "shadow-[0_18px_48px_-24px_rgba(8,22,40,0.30),0_4px_18px_-14px_rgba(8,22,40,0.16)]"
              : "shadow-[0_10px_32px_-20px_rgba(8,22,40,0.18),0_4px_12px_-12px_rgba(8,22,40,0.10)]"
          )}
        >
          {topContent && (
            <div className="w-full px-4 pt-2 pb-0 opacity-80">
              {topContent}
            </div>
          )}
          <div className="flex items-end gap-2 pl-3 pr-2.5 py-2">

          <div className="flex min-w-0 flex-1 items-end gap-2">
            <textarea
              ref={resolvedTextareaRef}
              rows={1}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onPaste={handlePaste}
              placeholder={placeholder}
              disabled={Boolean((disabled || isProcessing) && !isStreaming)}
              className="min-w-0 flex-1 resize-none border-none bg-transparent py-1.5 pl-1 text-[14px] leading-[1.5] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]/60"
              style={{ maxHeight: 120, minHeight: 24 }}
            />
          </div>

          <div className="spectra-quick-chat-tools flex items-center gap-1.5 shrink-0 self-end">
          {mounted && showMic && (speech.isSupported || onMicUnsupported) && (
            <button
              type="button"
              onClick={toggleMic}
              className={cn(
                "spectra-icon-action h-9 w-9 rounded-[10px] transition-colors",
                speech.isListening ? "is-active text-[var(--accent-coral)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              )}
              aria-label={speech.isListening ? "Stop dictation" : "Start dictation"}
              title={speech.isListening ? "Stop dictation" : "Start dictation"}
            >
              <Mic className="h-4 w-4" />
            </button>
          )}

          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              className="spectra-icon-action is-danger h-9 w-9 rounded-[10px] text-[var(--accent-coral)]"
              aria-label="Stop response"
              title="Stop response"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={Boolean(!value.trim() || disabled)}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-[10px] transition-all duration-150",
                value.trim()
                  ? "bg-[var(--accent-cyan)] text-white shadow-[0_8px_18px_-10px_rgba(14,142,232,0.70)] hover:-translate-y-0.5"
                  : "bg-transparent text-[var(--text-tertiary)]",
              )}
              aria-label="Send message"
              title="Send message"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
        </div>
      </div>
      {rightContent && (
        <div className="flex items-center gap-1.5 shrink-0 self-end mb-[2px]">
          {rightContent}
        </div>
      )}
      </div>

      {showSpeechStatus && (speech.isListening || speech.error) ? (
        <div className="mt-1.5 px-2 text-xs">
          {speech.isListening ? (
            <p className="inline-flex items-center gap-1 text-[var(--danger)]" aria-live="polite">
              <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-[var(--danger)]" />
              {speech.isTranscribing ? "Transcribing..." : "Recording... dictating into composer"}
            </p>
          ) : null}
          {speech.error ? (
            <p className="text-[var(--warning)]" aria-live="polite">{speech.error}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
