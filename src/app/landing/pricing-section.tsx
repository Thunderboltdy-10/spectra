"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

const FEATURES = [
  "12 study modes (8 live + 4 staged)",
  "Intelligent routing across 260+ active models",
  "Reliability fallback chain (including length-safe retries)",
  "Clarification continuity + branchable responses",
  "School context layer (curriculum, materials, rules)",
  "Two-layer memory fabric (profile + topic memory)",
  "Budget-aware orchestration and usage controls",
  "Teacher dashboard & analytics",
  "Priority support",
];

const MIN_PRICE = 9.99;
const MAX_PRICE = 49.99;
const DEFAULT_PRICE = 14.99;
const STEP = 1;

export function PricingSection() {
  const [price, setPrice] = useState(DEFAULT_PRICE);
  const [students, setStudents] = useState(30);

  const monthlyTotal = (price * students).toFixed(2);
  const sliderPercent = ((price - MIN_PRICE) / (MAX_PRICE - MIN_PRICE)) * 100;

  return (
    <div className="max-w-lg mx-auto">
      <div
        className="rounded-[var(--radius-container)] border border-[var(--border-default)] p-8 sm:p-10"
        style={{
          background: "var(--bg-elevated)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        {/* Price display */}
        <div className="text-center mb-8">
          <p className="text-sm font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
            Per student, per month
          </p>
          <p className="font-display font-bold leading-none" style={{ fontSize: "clamp(3rem, 8vw, 4.5rem)" }}>
            €{price.toFixed(2)}
          </p>
          <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>
            Billed monthly · Cancel anytime
          </p>
        </div>

        {/* Price slider */}
        <div className="mb-6">
          <div className="flex justify-between text-xs mb-2" style={{ color: "var(--text-tertiary)" }}>
            <span>€{MIN_PRICE.toFixed(2)}</span>
            <span>€{MAX_PRICE.toFixed(2)}</span>
          </div>
          <div className="relative">
            <input
              type="range"
              min={MIN_PRICE}
              max={MAX_PRICE}
              step={STEP}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              className="pricing-slider w-full h-2 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, var(--brand-primary) 0%, var(--brand-accent) ${sliderPercent}%, var(--bg-tertiary) ${sliderPercent}%)`,
              }}
              aria-label="Adjust price per student"
            />
          </div>
        </div>

        {/* Students input */}
        <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border-default)] px-4 py-3 mb-6" style={{ background: "var(--bg-primary)" }}>
          <label className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Students in your school
          </label>
          <input
            type="number"
            min={1}
            max={9999}
            value={students}
            onChange={(e) => setStudents(Math.max(1, Math.min(9999, Number(e.target.value) || 1)))}
            className="w-20 text-right font-display text-lg font-bold bg-transparent outline-none text-[var(--text-primary)]"
          />
        </div>

        {/* Monthly total */}
        <div
          className="text-center rounded-xl px-4 py-4 mb-8 border border-[var(--border-default)]"
          style={{ background: "var(--bg-primary)" }}
        >
          <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: "var(--text-tertiary)" }}>
            Estimated monthly total
          </p>
          <p className="font-display text-2xl font-bold" style={{ color: "var(--brand-primary)" }}>
            €{monthlyTotal}
          </p>
        </div>

        {/* Features */}
        <ul className="space-y-3 mb-8">
          {FEATURES.map((feature) => (
            <li key={feature} className="flex items-start gap-3 text-sm" style={{ color: "var(--text-secondary)" }}>
              <Check className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--brand-accent)" }} />
              {feature}
            </li>
          ))}
        </ul>

        {/* CTA */}
        <Link
          href="/sign-up"
          className="flex items-center justify-center gap-2 w-full px-8 py-4 rounded-xl text-white font-bold text-base transition-all hover:-translate-y-0.5"
          style={{
            background: "var(--gradient-brand)",
            boxShadow: "0 8px 24px color-mix(in oklab, var(--brand-primary) 28%, transparent)",
          }}
        >
          Get started
          <ArrowRight size={16} />
        </Link>

        <p className="text-center text-xs mt-4" style={{ color: "var(--text-tertiary)" }}>
          Schools set their own per-student budget. Minimum €{MIN_PRICE.toFixed(2)}/month.
        </p>
      </div>
    </div>
  );
}
