"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export function SoulDiagram() {
  const [phase, setPhase] = useState(0);
  const triggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = triggerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.unobserve(el);
          setTimeout(() => setPhase(1), 400);
          setTimeout(() => setPhase(2), 950);
          setTimeout(() => setPhase(3), 1500);
        }
      },
      { threshold: 0.25 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const panelAnim = (delay = 0): React.CSSProperties => ({
    opacity: phase >= 1 ? 1 : 0,
    transform: `translateY(${phase >= 1 ? 0 : 12}px)`,
    transition: `opacity 360ms cubic-bezier(0.22,1,0.36,1) ${delay}ms, transform 360ms cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
  });

  return (
    <div ref={triggerRef}>
      <div className="grid md:grid-cols-2 gap-4">
        {/* School SOUL */}
        <div
          style={{
            ...panelAnim(0),
            background:
              "color-mix(in oklab, #f59e0b 8%, var(--bg-elevated))",
            borderColor:
              "color-mix(in oklab, #f59e0b 35%, var(--border-default))",
          }}
          className="rounded-[var(--radius-container)] border p-5"
        >
          <p className="font-display text-base mb-3">School SOUL</p>
          <ul className="space-y-2">
            {[
              "Academic tone and values",
              "Assessment rubric guidelines",
              "Subject curriculum context",
            ].map((item) => (
              <li
                key={item}
                className="flex items-start gap-2 text-sm text-[var(--text-secondary)]"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
                  style={{ background: "#f59e0b" }}
                />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Your SOUL */}
        <div
          style={{
            ...panelAnim(120),
            background:
              "color-mix(in oklab, var(--accent-cyan) 8%, var(--bg-elevated))",
            borderColor:
              "color-mix(in oklab, var(--accent-cyan) 35%, var(--border-default))",
          }}
          className="rounded-[var(--radius-container)] border p-5"
        >
          <p className="font-display text-base mb-3">Your SOUL</p>
          <ul className="space-y-2">
            {[
              "Learning pace preference",
              "Subject: Biology (Year 11)",
              "Auto-updates from your sessions",
            ].map((item) => (
              <li
                key={item}
                className="flex items-start gap-2 text-sm text-[var(--text-secondary)]"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
                  style={{ background: "var(--accent-cyan)" }}
                />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Merge arrow */}
      <div
        className="flex flex-col items-center my-4"
        style={{
          opacity: phase >= 2 ? 1 : 0,
          transform: `scaleY(${phase >= 2 ? 1 : 0})`,
          transformOrigin: "top",
          transition:
            "opacity 300ms cubic-bezier(0.22,1,0.36,1) 200ms, transform 300ms cubic-bezier(0.22,1,0.36,1) 200ms",
        }}
      >
        <div className="w-px h-6 bg-[var(--border-default)]" />
        <ChevronDown size={14} className="text-[var(--text-tertiary)] -mt-0.5" />
        <div className="w-px h-2 bg-[var(--border-default)] -mt-0.5" />
      </div>

      {/* Response card */}
      {phase >= 3 && (
        <div className="card-entrance rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 max-w-md mx-auto shadow-[var(--shadow-card)]">
          <p className="text-xs text-[var(--text-tertiary)] mb-2 font-medium">
            Personalised response
          </p>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            Your response reflects your school&apos;s formal academic tone and your
            personal preference for concise, step-by-step explanations
            calibrated to Year 11 Biology.
          </p>
        </div>
      )}
    </div>
  );
}
