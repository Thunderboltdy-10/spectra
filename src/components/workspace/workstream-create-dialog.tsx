"use client";

import { useState } from "react";
import { BookOpen, Folder, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { WORKSTREAM_COLORS, WORKSTREAM_EMOJIS } from "@/lib/workspace/zoom-helpers";

type WorkstreamCreateDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (data: {
    type: string;
    title: string;
    description?: string;
    emoji?: string;
    color?: string;
  }) => Promise<void>;
};

const TYPES = [
  {
    value: "subject",
    label: "Subject",
    desc: "Linked to a school subject",
    icon: BookOpen,
  },
  {
    value: "project",
    label: "Project",
    desc: "Deadline-centric work",
    icon: Folder,
  },
  {
    value: "general",
    label: "General",
    desc: "Flexible, user-defined",
    icon: Sparkles,
  },
] as const;

export function WorkstreamCreateDialog({
  open,
  onClose,
  onCreate,
}: WorkstreamCreateDialogProps) {
  const [step, setStep] = useState<"type" | "details">("type");
  const [type, setType] = useState<string>("general");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("📚");
  const [color, setColor] = useState<string>(WORKSTREAM_COLORS[0].value);
  const [submitting, setSubmitting] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  function reset() {
    setStep("type");
    setType("general");
    setTitle("");
    setDescription("");
    setEmoji("📚");
    setColor(WORKSTREAM_COLORS[0].value);
    setSubmitting(false);
    setShowEmojiPicker(false);
  }

  async function handleSubmit() {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await onCreate({
        type,
        title: title.trim(),
        description: description.trim() || undefined,
        emoji,
        color,
      });
      reset();
      onClose();
    } catch {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          reset();
          onClose();
        }
      }}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-[var(--bg-overlay)]" />

      {/* Dialog */}
      <div
        className={cn(
          "relative w-full max-w-md mx-4",
          "bg-[var(--bg-elevated)] rounded-[var(--radius-container)]",
          "shadow-[var(--shadow-soft)]",
          "overflow-hidden",
        )}
        style={{
          animation: "dialogIn 280ms cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <h2 className="font-display text-lg font-bold text-[var(--text-primary)]">
            {step === "type" ? "New Workstream" : "Details"}
          </h2>
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="p-1 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === "type" ? (
          /* Step 1: Type selection */
          <div className="px-6 pb-6 pt-2 space-y-2">
            <p className="text-xs text-[var(--text-secondary)] mb-3">
              Choose how this workstream is organized
            </p>
            {TYPES.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => {
                    setType(t.value);
                    setStep("details");
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl",
                    "text-left transition-all duration-[var(--motion-fast)]",
                    "border border-[var(--border-default)]",
                    "hover:border-[var(--accent-cyan)] hover:shadow-[0_0_0_1px_var(--accent-cyan)]",
                    "hover:bg-[var(--accent-cyan)]/4",
                  )}
                >
                  <div
                    className={cn(
                      "w-9 h-9 rounded-xl flex items-center justify-center",
                      "bg-[var(--bg-secondary)]",
                    )}
                  >
                    <Icon className="w-4 h-4 text-[var(--text-secondary)]" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      {t.label}
                    </div>
                    <div className="text-[11px] text-[var(--text-tertiary)]">
                      {t.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          /* Step 2: Details */
          <div className="px-6 pb-6 pt-2 space-y-4">
            {/* Emoji + Title row */}
            <div className="flex items-start gap-3">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className={cn(
                    "w-11 h-11 rounded-xl flex items-center justify-center",
                    "bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]",
                    "text-xl transition-colors duration-[var(--motion-fast)]",
                    "border border-[var(--border-default)]",
                  )}
                >
                  {emoji}
                </button>
                {showEmojiPicker && (
                  <div
                    className={cn(
                      "absolute top-full left-0 mt-1 z-10",
                      "bg-[var(--bg-elevated)] border border-[var(--border-default)]",
                      "rounded-xl p-2 shadow-[var(--shadow-soft)]",
                      "grid grid-cols-8 gap-1 w-[200px]",
                    )}
                  >
                    {WORKSTREAM_EMOJIS.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => {
                          setEmoji(e);
                          setShowEmojiPicker(false);
                        }}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-sm"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex-1">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Workstream name..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && title.trim()) {
                      void handleSubmit();
                    }
                  }}
                  className={cn(
                    "w-full px-3 py-2.5 rounded-xl",
                    "bg-[var(--bg-secondary)] border border-[var(--border-default)]",
                    "text-sm text-[var(--text-primary)]",
                    "placeholder:text-[var(--text-tertiary)]",
                    "outline-none focus:border-[var(--accent-cyan)] focus:ring-1 focus:ring-[var(--accent-cyan)]/30",
                    "transition-all duration-[var(--motion-fast)]",
                  )}
                />
              </div>
            </div>

            {/* Description */}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className={cn(
                "w-full px-3 py-2.5 rounded-xl resize-none",
                "bg-[var(--bg-secondary)] border border-[var(--border-default)]",
                "text-sm text-[var(--text-primary)]",
                "placeholder:text-[var(--text-tertiary)]",
                "outline-none focus:border-[var(--accent-cyan)] focus:ring-1 focus:ring-[var(--accent-cyan)]/30",
                "transition-all duration-[var(--motion-fast)]",
              )}
            />

            {/* Color picker */}
            <div>
              <label className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider mb-1.5 block">
                Color
              </label>
              <div className="flex gap-2">
                {WORKSTREAM_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    className={cn(
                      "w-7 h-7 rounded-full transition-all duration-[var(--motion-fast)]",
                      color === c.value
                        ? "ring-2 ring-offset-2 ring-offset-[var(--bg-elevated)] scale-110"
                        : "hover:scale-105",
                    )}
                    style={{
                      backgroundColor: c.value,
                      "--tw-ring-color": c.value,
                    } as React.CSSProperties}
                    title={c.name}
                  />
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setStep("type")}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                &larr; Back
              </button>

              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!title.trim() || submitting}
                className={cn(
                  "px-5 py-2 rounded-xl text-sm font-semibold",
                  "bg-[var(--accent-cyan)] text-white",
                  "hover:brightness-110 active:brightness-95",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  "transition-all duration-[var(--motion-fast)]",
                  "shadow-[0_2px_8px_-2px_rgba(14,142,232,0.3)]",
                )}
              >
                {submitting ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes dialogIn {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(8px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
