"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { ARTIFACT_TYPES, ARTIFACT_TYPE_META, type ArtifactType } from "@/lib/artifact-types";
import { cn } from "@/lib/utils";

export function CreateArtifactDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (type: ArtifactType, title: string, tags: string[]) => void;
}) {
  const [selectedType, setSelectedType] = useState<ArtifactType | null>(null);
  const [title, setTitle] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [step, setStep] = useState<"type" | "details">("type");

  function reset() {
    setSelectedType(null);
    setTitle("");
    setTagsInput("");
    setStep("type");
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleTypeSelect(type: ArtifactType) {
    setSelectedType(type);
    setStep("details");
  }

  function handleCreate() {
    if (!selectedType || !title.trim()) return;
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    onCreate(selectedType, title.trim(), tags);
    handleClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-soft)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
          <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
            {step === "type" ? "New Artifact" : "Details"}
          </h2>
          <button
            type="button"
            className="rounded-lg p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === "type" ? (
          <div className="p-5">
            <p className="mb-4 text-sm text-[var(--text-secondary)]">
              Choose the type of artifact to create.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {ARTIFACT_TYPES.map((type) => {
                const meta = ARTIFACT_TYPE_META[type];
                const Icon = meta.icon;
                return (
                  <button
                    key={type}
                    type="button"
                    className="flex items-center gap-3 rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-left transition-all hover:border-[color-mix(in_oklab,var(--brand-primary)_40%,var(--border-default))] hover:shadow-[var(--shadow-card)]"
                    onClick={() => handleTypeSelect(type)}
                  >
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
                      style={{
                        background: `color-mix(in oklab, ${meta.color} 12%, var(--bg-primary))`,
                        color: meta.color,
                      }}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--text-primary)]">
                        {meta.label}
                      </div>
                      <div className="truncate text-[10px] text-[var(--text-tertiary)]">
                        {meta.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="p-5">
            {selectedType ? (
              <div className="mb-4 flex items-center gap-2">
                {(() => {
                  const meta = ARTIFACT_TYPE_META[selectedType];
                  const Icon = meta.icon;
                  return (
                    <>
                      <div
                        className="flex h-7 w-7 items-center justify-center rounded-lg"
                        style={{
                          background: `color-mix(in oklab, ${meta.color} 12%, var(--bg-primary))`,
                          color: meta.color,
                        }}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <span className="text-sm font-medium text-[var(--text-secondary)]">
                        {meta.label}
                      </span>
                      <button
                        type="button"
                        className="ml-auto text-xs text-[var(--brand-primary)] hover:underline"
                        onClick={() => setStep("type")}
                      >
                        Change type
                      </button>
                    </>
                  );
                })()}
              </div>
            ) : null}

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter artifact title..."
                  className="w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--brand-primary)] focus:outline-none"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                  }}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                  Tags <span className="font-normal text-[var(--text-tertiary)]">(comma-separated, optional)</span>
                </label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="physics, revision, exam prep..."
                  className="w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--brand-primary)] focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                onClick={handleClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-[var(--radius-input)] bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                disabled={!title.trim()}
                onClick={handleCreate}
              >
                Create Artifact
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
