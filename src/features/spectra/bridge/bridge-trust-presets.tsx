"use client";

import {
  BRIDGE_TRUST_OPTIONS,
  type BridgeTrustPreset,
} from "../../../../shared/bridge-trust";

export function BridgeTrustPresets({
  value,
  pending,
  disabled = false,
  onSelect,
}: {
  value: BridgeTrustPreset;
  pending?: BridgeTrustPreset | null;
  disabled?: boolean;
  onSelect: (preset: BridgeTrustPreset) => void;
}) {
  const visible = pending ?? value;
  const option = BRIDGE_TRUST_OPTIONS.find(
    (candidate) => candidate.id === visible,
  )!;

  return (
    <div className="grid gap-3">
      <div
        className="grid gap-2 md:grid-cols-3"
        role="radiogroup"
        aria-label="Bridge trust"
      >
        {BRIDGE_TRUST_OPTIONS.map((candidate) => {
          const selected = candidate.id === visible;
          return (
            <button
              key={candidate.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onSelect(candidate.id)}
              className={`min-h-[132px] rounded-card border p-3 text-left transition-colors disabled:opacity-45 ${
                selected
                  ? "border-[var(--text-primary)] bg-[var(--bg-secondary)]"
                  : "border-[var(--border-default)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <span className="block text-caption font-semibold text-[var(--text-primary)]">
                {candidate.label}
              </span>
              <span className="mt-2 block text-micro leading-5 text-[var(--text-secondary)]">
                {candidate.summary}
              </span>
            </button>
          );
        })}
      </div>
      <div className="rounded-card border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
        <div className="text-micro font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
          What changes
        </div>
        <div className="mt-2 grid gap-3 text-micro leading-5 text-[var(--text-secondary)] md:grid-cols-2">
          <p>
            <span className="font-semibold text-[var(--text-primary)]">
              On this PC ·{" "}
            </span>
            {option.localPreview}
          </p>
          <p>
            <span className="font-semibold text-[var(--text-primary)]">
              In Spectra ·{" "}
            </span>
            {option.cloudPreview}
          </p>
        </div>
        {pending ? (
          <p className="mt-3 text-micro text-[var(--warning)]" role="status">
            Review this choice below and apply it explicitly. Existing folders
            are not moved by an account preset change.
          </p>
        ) : value === "advanced" ? (
          <p className="mt-3 text-micro text-[var(--text-tertiary)]">
            Your detailed settings are still in force. The controls below are
            the authority for this custom state.
          </p>
        ) : null}
      </div>
    </div>
  );
}
