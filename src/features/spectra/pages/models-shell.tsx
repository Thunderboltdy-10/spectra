"use client";

import { Cpu, ShieldCheck, Sparkles, Waypoints } from "lucide-react";
import {
  SPECTRA_DEFAULT_MODEL_ID,
  SPECTRA_DEFAULT_VISION_MODEL_ID,
  SPECTRA_FALLBACK_PROVIDERS,
  SPECTRA_MODEL_GATEWAY,
  SPECTRA_PRIMARY_PROVIDER,
  getSpectraProviderRouting,
} from "@/features/spectra/ai/model-config";

export function ModelsShell() {
  const primary = getSpectraProviderRouting("primary");
  const fallback = getSpectraProviderRouting("fallback");

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <header className="border-b border-[var(--border-default)] px-8 py-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Runtime
        </p>
        <h1 className="mt-1 font-display text-[28px] text-[var(--text-primary)]">
          Models
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
          Spectra routes production work through OpenRouter to the native
          DeepSeek provider. Emergency fallbacks keep the same model id and are
          treated as defects when they fire during normal use.
        </p>
      </header>

      <div className="grid gap-4 overflow-y-auto px-8 py-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-soft)]">
          <div className="flex items-center gap-2 text-[var(--text-primary)]">
            <Sparkles size={16} className="text-[var(--accent-primary)]" />
            <h2 className="text-sm font-semibold">Primary collaborator</h2>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                Model
              </dt>
              <dd className="mt-1 font-mono text-[13px] text-[var(--text-primary)]">
                {SPECTRA_DEFAULT_MODEL_ID}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                Gateway · provider
              </dt>
              <dd className="mt-1 text-[var(--text-secondary)]">
                {SPECTRA_MODEL_GATEWAY} · {SPECTRA_PRIMARY_PROVIDER}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                Routing
              </dt>
              <dd className="mt-1 font-mono text-[12px] text-[var(--text-secondary)]">
                order={JSON.stringify(primary.order)} · only=
                {JSON.stringify(primary.only)} · allow_fallbacks=
                {String(primary.allow_fallbacks)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-soft)]">
          <div className="flex items-center gap-2 text-[var(--text-primary)]">
            <Waypoints size={16} className="text-[var(--accent-cyan)]" />
            <h2 className="text-sm font-semibold">Emergency recovery</h2>
          </div>
          <p className="mt-3 text-sm text-[var(--text-secondary)]">
            Same model id, alternate OpenRouter providers only after a genuine
            primary failure.
          </p>
          <ul className="mt-4 space-y-2">
            {SPECTRA_FALLBACK_PROVIDERS.map((provider) => (
              <li
                key={provider}
                className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 font-mono text-[12px] text-[var(--text-primary)]"
              >
                {provider}
              </li>
            ))}
          </ul>
          <p className="mt-3 font-mono text-[11px] text-[var(--text-tertiary)]">
            fallback allow_fallbacks={String(fallback.allow_fallbacks)}
          </p>
        </section>

        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-soft)]">
          <div className="flex items-center gap-2 text-[var(--text-primary)]">
            <Cpu size={16} />
            <h2 className="text-sm font-semibold">Vision evidence</h2>
          </div>
          <p className="mt-3 text-sm text-[var(--text-secondary)]">
            Image attachments are analysed by MiMo V2.5 (Xiaomi) into a thorough
            text evidence packet. DeepSeek V4 Pro then plans from that packet —
            it never receives the image bytes on the native DeepSeek route.
          </p>
          <p className="mt-4 font-mono text-[13px] text-[var(--text-primary)]">
            {SPECTRA_DEFAULT_VISION_MODEL_ID}
          </p>
        </section>

        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-soft)]">
          <div className="flex items-center gap-2 text-[var(--text-primary)]">
            <ShieldCheck size={16} className="text-[var(--accent-green)]" />
            <h2 className="text-sm font-semibold">Defaults</h2>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
            Default model{" "}
            <span className="font-mono">{SPECTRA_DEFAULT_MODEL_ID}</span>.
            Ordinary users cannot disable AI; operators meter usage without
            gating legitimate capability.
          </p>
        </section>
      </div>
    </div>
  );
}
