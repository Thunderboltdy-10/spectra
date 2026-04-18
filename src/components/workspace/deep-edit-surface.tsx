"use client";

import {
  Sparkles,
  BookOpen,
  Edit3,
  Check,
  Eye,
  Pencil,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { HubSurface } from "@/components/workspace/hub-surface";
import type { WorkspaceItemData } from "@/lib/workspace/contracts";
import {
  CANONICAL_WORKSPACE_TYPE_META,
  type CanonicalWorkspaceType,
} from "@/lib/artifact-types";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";

type DeepEditSurfaceProps = {
  item: WorkspaceItemData;
  locked?: boolean;
  pinned?: boolean;
  hidden?: boolean;
  onClose: () => void;
  onToggleLock: () => void;
};

/* --- Thread Conversation View --- */

function ThreadView({ item }: { item: WorkspaceItemData }) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-5">
        {item.preview ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-2xl border border-[var(--border-default)]/20 bg-[var(--bg-elevated)] px-4 py-3 text-[13px] leading-relaxed text-[var(--text-primary)]">
              {item.preview}
            </div>
          </div>
        ) : (
          <div className="flex h-40 flex-col items-center justify-center text-center">
            <Sparkles className="mb-2 h-5 w-5 text-[var(--accent-cyan)] opacity-30" />
            <span className="text-[12px] text-[var(--text-tertiary)]">No messages yet</span>
            <span className="mt-1 text-[10px] text-[var(--text-tertiary)]/50">Use the command bar to start a conversation</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* --- Editable Title --- */

function EditableTitle({
  title,
  onChange,
}: {
  title: string;
  onChange?: (newTitle: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title) {
      onChange?.(trimmed);
    } else {
      setDraft(title);
    }
    setEditing(false);
  }, [draft, title, onChange]);

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setDraft(title); setEditing(false); }
          }}
          className="min-w-0 flex-1 truncate rounded-md border border-[var(--accent-cyan)]/30 bg-[var(--bg-secondary)]/60 px-1.5 py-0.5 text-[14px] font-semibold text-[var(--text-primary)] outline-none"
        />
        <button
          type="button"
          onClick={commit}
          className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--accent-cyan)] text-white"
        >
          <Check className="h-2.5 w-2.5" />
        </button>
      </div>
    );
  }

  return (
    <span
      className="group/title flex cursor-text items-center gap-1 truncate text-[14px] font-semibold text-[var(--text-primary)]"
      onClick={() => setEditing(true)}
    >
      <span className="truncate">{title}</span>
      <Edit3 className="h-2.5 w-2.5 shrink-0 text-[var(--text-tertiary)]/0 transition-colors group-hover/title:text-[var(--text-tertiary)]/60" />
    </span>
  );
}

/* --- Artifact Content View --- */

/** Detect language from meta, title extension, or content patterns */
function detectCodeLanguage(item: WorkspaceItemData): string {
  if (item.meta) {
    const langMap: Record<string, string> = {
      "python": "python", "py": "python",
      "javascript": "javascript", "js": "javascript",
      "typescript": "typescript", "ts": "typescript",
      "jsx": "jsx", "tsx": "tsx",
      "html": "html", "css": "css",
      "rust": "rust", "go": "go",
      "java": "java", "c": "c", "cpp": "cpp",
      "ruby": "ruby", "php": "php",
      "sql": "sql", "bash": "bash", "sh": "bash",
      "swift": "swift", "kotlin": "kotlin",
      "dart": "dart", "yaml": "yaml", "json": "json",
      "markdown": "markdown", "md": "markdown",
    };
    const metaLower = item.meta.toLowerCase().trim();
    if (langMap[metaLower]) return langMap[metaLower];
  }
  const titleLower = item.title.toLowerCase();
  const extMatch = titleLower.match(/\.(py|js|ts|jsx|tsx|html|css|rs|go|java|c|cpp|rb|php|sql|sh|swift|kt|dart|yaml|yml|json|md)$/);
  if (extMatch) {
    const extMap: Record<string, string> = {
      "py": "python", "js": "javascript", "ts": "typescript",
      "jsx": "jsx", "tsx": "tsx", "html": "html", "css": "css",
      "rs": "rust", "go": "go", "java": "java", "c": "c", "cpp": "cpp",
      "rb": "ruby", "php": "php", "sql": "sql", "sh": "bash",
      "swift": "swift", "kt": "kotlin", "dart": "dart",
      "yaml": "yaml", "yml": "yaml", "json": "json", "md": "markdown",
    };
    if (extMap[extMatch[1]]) return extMap[extMatch[1]];
  }
  const code = item.preview ?? "";
  if (code.startsWith("#!/usr/bin/env python") || code.startsWith("#!/usr/bin/python")) return "python";
  if (code.startsWith("#!/bin/bash") || code.startsWith("#!/bin/sh")) return "bash";
  if (code.startsWith("<!DOCTYPE") || code.startsWith("<html")) return "html";
  if (code.match(/^import\s+(React|{\s*useState)/m)) return "typescript";
  if (code.match(/^(def |import |from )/m)) return "python";
  if (code.match(/^(func |package )/m)) return "go";
  if (code.match(/^(fn |let mut |impl )/m)) return "rust";
  return "";
}

function ArtifactView({ item }: { item: WorkspaceItemData }) {
  const isEditable = ["note", "code", "export"].includes(item.itemType);
  const isCode = item.itemType === "code";
  const isExport = item.itemType === "export";
  const [content, setContent] = useState(item.preview ?? "");
  const [isEditing, setIsEditing] = useState(false);
  const codeLang = isCode ? detectCodeLanguage(item) : "";

  useEffect(() => {
    setContent(item.preview ?? "");
  }, [item.preview]);

  const handleBlur = () => {
    if (content !== item.preview) {
      void fetch("/api/artifacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifactId: item.id, content }),
      }).catch(() => undefined);
    }
  };

  // Build fenced code block for syntax highlighting
  const fencedCode = isCode
    ? codeLang
      ? `${"```"}${codeLang}\n${content || "// No code yet"}\n${"```"}`
      : `${"```"}\n${content || "// No code yet"}\n${"```"}`
    : "";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Preview/Edit toggle for all editable types including code */}
      {isEditable && (
        <div className="flex items-center justify-between px-5 pt-3 pb-1 shrink-0">
          {/* Language badge for code */}
          {isCode && codeLang && !isEditing ? (
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]/60 bg-[var(--bg-elevated)]/50 px-2 py-0.5 rounded">{codeLang}</span>
          ) : isExport ? (
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]/50">Document</span>
          ) : (
            <span />
          )}
          <div className="flex items-center rounded-lg bg-[var(--bg-secondary)]/30 p-1">
            <button
              onClick={() => setIsEditing(false)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-all",
                !isEditing ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              )}
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </button>
            <button
              onClick={() => setIsEditing(true)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-all",
                isEditing ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              )}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-4 h-full">
          {isCode && isEditing ? (
            /* Code editing — dark editor textarea with active-line indicator */
            <div className="relative h-full min-h-[280px]">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onBlur={handleBlur}
                spellCheck={false}
                placeholder="// Start coding here\u2026"
                className={cn(
                  "w-full h-full resize-none rounded-2xl p-5 pl-6 transition-all duration-200",
                  "bg-[var(--bg-code-editor)] text-[var(--text-code-editor)] hover:bg-[var(--bg-code-editor)]/90",
                  "focus:ring-1 focus:ring-[var(--accent-cyan)]/30 focus:bg-[var(--bg-code-editor)]",
                  "outline-none font-mono text-[13px] leading-[1.6]",
                  "placeholder:text-[var(--text-code-editor)]/40 border-l-2 border-[var(--accent-cyan)]/20",
                  "focus:border-l-[var(--accent-cyan)]/40"
                )}
              />
            </div>
          ) : isCode && !isEditing ? (
            /* Code preview — syntax-highlighted via MarkdownRenderer */
            <div className="min-h-[240px] rounded-2xl bg-[var(--bg-code-editor)] p-5 overflow-auto [&_.markdown-body]:!bg-transparent [&_.markdown-body]:!text-[13px] [&_.markdown-body_pre]:!bg-transparent [&_.markdown-body_pre]:!m-0 [&_.markdown-body_pre]:!p-0 [&_.markdown-body_code]:!text-[13px] [&_.markdown-body_code]:!leading-[1.6] [&_.markdown-body_pre_code]:!font-mono [&_.markdown-body_pre_code]:!bg-transparent [&_.markdown-body]:!leading-[1.6] [&_button]:hidden">
              <MarkdownRenderer content={fencedCode} />
            </div>
          ) : isEditable && isEditing ? (
            /* Note/Export editing textarea */
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onBlur={handleBlur}
              placeholder="Start writing here\u2026"
              className={cn(
                "w-full h-full min-h-[280px] resize-none rounded-2xl p-5 transition-all duration-200",
                "bg-[var(--bg-secondary)]/10 hover:bg-[var(--bg-secondary)]/20",
                "focus:bg-[var(--bg-secondary)]/25 focus:ring-1 focus:ring-[var(--accent-cyan)]/15",
                "text-[15px] leading-[1.75] text-[var(--text-primary)] outline-none font-[var(--font-manrope)]",
                "placeholder:text-[var(--text-tertiary)]/40",
                isExport && "border border-[var(--border-default)]/10 bg-white/[0.02]"
              )}
            />
          ) : (
            /* Note/Export preview — rendered markdown */
            <div className={cn(
              "min-h-[240px] rounded-2xl p-5",
              isExport
                ? "bg-white/[0.02] border border-[var(--border-default)]/10 shadow-[inset_0_1px_3px_rgba(0,0,0,0.03)]"
                : "bg-[var(--bg-secondary)]/10"
            )}>
              {content ? (
                <MarkdownRenderer content={content} mode={isExport ? "document" : undefined} />
              ) : (
                <span className="text-[var(--text-tertiary)]/50">No content yet</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* --- Main Deep Edit Surface --- */

export function DeepEditSurface({
  item,
  locked = false,
  pinned = false,
  hidden = false,
  onClose,
  onToggleLock,
  index = 0,
}: DeepEditSurfaceProps & { index?: number }) {
  const meta = useMemo(
    () =>
      CANONICAL_WORKSPACE_TYPE_META[
        item.itemType as CanonicalWorkspaceType
      ],
    [item.itemType],
  );
  const focusedItemId = useWorkspaceStore((s) => s.focusedItemId);
  const isFocused = focusedItemId === item.id;
  const isThread = item.itemType === "thread";
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspace = workspaces.find((entry) => entry.id === item.workspaceId);

  const collapsed = (
    <button
      type="button"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-[14px] border w-[36px] min-h-[100px] py-3 backdrop-blur-xl transition-all duration-200",
        isFocused
          ? "border-[color-mix(in_oklab,var(--accent-cyan)_25%,var(--border-default))] bg-[var(--bg-elevated)]/98 shadow-[0_10px_24px_-16px_rgba(14,142,232,0.18)]"
          : "border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/95 shadow-[0_10px_24px_-16px_rgba(8,22,40,0.14)]",
      )}
    >

      {meta?.icon ? (
        <meta.icon
          className="h-4 w-4 shrink-0"
          style={{ color: meta.color }}
        />
      ) : (
        <BookOpen className="h-4 w-4 text-[var(--text-secondary)]" />
      )}
      <span className="text-[10px] font-semibold text-[var(--text-secondary)]" style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}>
        {item.title}
      </span>
    </button>
  );

  const handleTitleChange = useCallback(async (newTitle: string) => {
    if (workspace) {
      if (item.itemType === "planner") {
        await fetch("/api/planner-items", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plannerItemId: item.id, title: newTitle }),
        }).catch(() => undefined);
      } else if (item.itemType === "thread") {
        await fetch(`/api/chats/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle }),
        }).catch(() => undefined);
      } else {
        await fetch("/api/artifacts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update", artifactId: item.id, title: newTitle }),
        }).catch(() => undefined);
      }
      window.dispatchEvent(new CustomEvent("workspace:content-mutated", {
        detail: { workstreamId: workspace.id, refreshHub: true, refreshWorkstreams: true },
      }));
    }
  }, [item.id, item.itemType, workspace]);

  const expandedClassName = "right-0 top-0";

  return (
    <HubSurface
      id={`deep-edit-${item.id}`}
      edge="right"
      collapsed={collapsed}
      locked={locked}
      pinned={pinned}
      hidden={hidden}
      onToggleLock={onToggleLock}
      expandedClassName={expandedClassName}
      className="!-translate-y-0 transition-all duration-300"
      style={{ top: `${260 + index * 110}px` }}
    >
      <div className="flex h-[620px] w-[540px] flex-col overflow-hidden rounded-[28px]">
        {/* Surface header — icon + title only, lock handled by HubSurface wrapper */}
        <div
          className={cn(
            "flex h-14 shrink-0 items-center justify-between border-b px-5 transition-colors duration-200",
            isFocused
              ? "border-[color-mix(in_oklab,var(--accent-cyan)_15%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_2%,transparent)]"
              : "border-[var(--border-default)]/20",
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200",
                isFocused && "ring-1 ring-[var(--accent-cyan)]/20",
              )}
              style={{
                backgroundColor: `color-mix(in oklab, ${meta?.color ?? "#637083"} ${isFocused ? "12" : "8"}%, var(--bg-secondary))`,
              }}
            >
              {meta?.icon ? (
                <meta.icon className="h-4 w-4" style={{ color: meta.color }} />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <EditableTitle title={item.title} onChange={handleTitleChange} />
            </div>
          </div>
        </div>

        {/* Content body u2014 maximum space for actual content */}
        {isThread ? <ThreadView item={item} /> : <ArtifactView item={item} />}
        <button type="button" className="sr-only" onClick={onClose}>Close</button>
      </div>
    </HubSurface>
  );
}
