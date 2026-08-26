"use client";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  PROTECTED_ORIGINAL_TOGGLE,
  STORAGE_TOGGLES,
  consequenceFor,
  type StorageChoice,
} from "./sync-toggles";

export function StorageToggleGroup({
  value,
  onChange,
  disabled = false,
  hasLocalCopy = false,
  protectedOriginal = false,
  onProtectedChange,
  showProtected = false,
}: {
  value: StorageChoice;
  onChange: (choice: StorageChoice) => void;
  disabled?: boolean;
  hasLocalCopy?: boolean;
  protectedOriginal?: boolean;
  onProtectedChange?: (next: boolean) => void;
  showProtected?: boolean;
}) {
  return (
    <div className="grid gap-2">
      {STORAGE_TOGGLES.map((toggle) => {
        const selected = value === toggle.choice;
        const sentence = consequenceFor(toggle.choice, hasLocalCopy);
        return (
          <button
            key={toggle.choice}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(toggle.choice)}
            className={`rounded-card border px-3 py-2.5 text-left transition-colors disabled:opacity-45 ${
              selected
                ? "border-[var(--text-primary)] bg-[var(--bg-secondary)]"
                : "border-[var(--border-default)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <span className="flex items-center gap-2 text-caption font-semibold text-[var(--text-primary)]">
              {toggle.label}
              {toggle.recommended ? (
                <span className="text-micro font-medium text-[var(--text-tertiary)]">
                  Recommended
                </span>
              ) : null}
            </span>
            {selected ? (
              <span className="mt-1 block text-micro leading-5 text-[var(--text-secondary)]">
                {sentence}
              </span>
            ) : null}
          </button>
        );
      })}
      {showProtected && onProtectedChange && value !== "spectra" ? (
        <div className="mt-2 flex items-start justify-between gap-3 rounded-card border border-[var(--border-subtle)] px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-caption font-semibold text-[var(--text-primary)]">
              {PROTECTED_ORIGINAL_TOGGLE.label}
            </div>
            <p className="mt-1 text-micro leading-5 text-[var(--text-secondary)]">
              {PROTECTED_ORIGINAL_TOGGLE.consequence}
            </p>
          </div>
          <Switch
            checked={protectedOriginal}
            disabled={disabled}
            onCheckedChange={onProtectedChange}
            aria-label={PROTECTED_ORIGINAL_TOGGLE.label}
          />
        </div>
      ) : null}
    </div>
  );
}

export function StorageBusyNote({ children }: { children: string }) {
  return (
    <p className="text-micro text-[var(--text-secondary)]" role="status">
      {children}
    </p>
  );
}

export function ReconnectAction({
  href,
  label = "Reconnect",
}: {
  href: string;
  label?: string;
}) {
  return (
    <Button size="sm" asChild>
      <a href={href}>{label}</a>
    </Button>
  );
}
