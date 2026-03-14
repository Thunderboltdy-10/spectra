"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, GraduationCap, FileText, Brain, BarChart3, MessageCircle, Sparkles } from "lucide-react";

const CX = 200;
const CY = 200;
const OUTER_R = 160;
const INNER_R = 98;

const OUTER_ITEMS = [
  { Icon: GraduationCap, label: "Curriculum standards", desc: "Answers stay on-syllabus & grade-appropriate", angle: 0 },
  { Icon: FileText, label: "Class materials", desc: "Your uploaded notes & resources", angle: 120 },
  { Icon: BookOpen, label: "Academic values", desc: "School-set tone, style & guidelines", angle: 240 },
];

const INNER_ITEMS = [
  { Icon: Brain, label: "Learning style", desc: "How explanations are shaped for you", angle: 60 },
  { Icon: BarChart3, label: "Knowledge gaps", desc: "What to reinforce next", angle: 180 },
  { Icon: MessageCircle, label: "Session memory", desc: "Progress & context across sessions", angle: 300 },
];

export function SoulDiagram() {
  const [angle, setAngle] = useState(0);
  const [hoveredOuter, setHoveredOuter] = useState<number | null>(null);
  const [hoveredInner, setHoveredInner] = useState<number | null>(null);
  const rafRef = useRef<number>(0);
  const prevTimeRef = useRef<number>(0);

  useEffect(() => {
    const animate = (time: number) => {
      if (prevTimeRef.current > 0) {
        const delta = time - prevTimeRef.current;
        setAngle((prev) => (prev + delta * 0.014) % 360);
      }
      prevTimeRef.current = time;
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const getPos = (baseAngle: number, radius: number, rotation: number) => {
    const rad = ((baseAngle + rotation) * Math.PI) / 180;
    return { x: CX + Math.cos(rad) * radius, y: CY + Math.sin(rad) * radius };
  };

  const outerPositions = OUTER_ITEMS.map((it) => getPos(it.angle, OUTER_R, angle));
  const innerPositions = INNER_ITEMS.map((it) => getPos(it.angle, INNER_R, -angle * 0.65));

  return (
    <div className="flex flex-col xl:flex-row gap-10 items-center w-full">
      {/* ── Onion SVG ── */}
      <div className="relative shrink-0" style={{ width: 400, height: 400 }}>
        {/* Ambient glow behind rings */}
        <div
          className="absolute pointer-events-none"
          style={{
            inset: 0,
            background:
              "radial-gradient(ellipse 65% 65% at 50% 50%, color-mix(in oklab, var(--brand-primary) 10%, transparent), transparent 70%)",
          }}
        />

        <svg
          width={400}
          height={400}
          className="absolute inset-0"
          style={{ overflow: "visible" }}
          aria-hidden
        >
          <defs>
            {/* Glow filters */}
            <filter id="glow-acc" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="glow-pri" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* Scanline gradient */}
            <linearGradient id="scan-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity="0" />
              <stop offset="50%" stopColor="var(--brand-primary)" stopOpacity="0.12" />
              <stop offset="100%" stopColor="var(--brand-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Outer ring: thick glow halo */}
          <circle cx={CX} cy={CY} r={OUTER_R} fill="none" stroke="var(--brand-accent)" strokeWidth="6" strokeOpacity="0.08" />
          {/* Outer ring: dashed main stroke */}
          <circle
            cx={CX}
            cy={CY}
            r={OUTER_R}
            fill="none"
            stroke="var(--brand-accent)"
            strokeWidth="1.5"
            strokeDasharray="9 6"
            strokeOpacity="0.75"
            filter="url(#glow-acc)"
          />
          {/* Outer fill */}
          <circle cx={CX} cy={CY} r={OUTER_R} fill="var(--brand-accent)" fillOpacity="0.035" />

          {/* Inner ring: thick glow halo */}
          <circle cx={CX} cy={CY} r={INNER_R} fill="none" stroke="var(--brand-primary)" strokeWidth="6" strokeOpacity="0.1" />
          {/* Inner ring: solid main stroke */}
          <circle
            cx={CX}
            cy={CY}
            r={INNER_R}
            fill="none"
            stroke="var(--brand-primary)"
            strokeWidth="2"
            strokeOpacity="0.8"
            filter="url(#glow-pri)"
          />
          {/* Inner fill */}
          <circle cx={CX} cy={CY} r={INNER_R} fill="var(--brand-primary)" fillOpacity="0.06" />

          {/* Center core */}
          <circle cx={CX} cy={CY} r={28} fill="var(--brand-primary)" fillOpacity="0.18" />
          <circle
            cx={CX}
            cy={CY}
            r={28}
            fill="none"
            stroke="var(--brand-primary)"
            strokeWidth="1.5"
            strokeOpacity="0.5"
            strokeDasharray="3 2"
          />
          <circle cx={CX} cy={CY} r={28} fill="none" stroke="var(--brand-primary)" strokeWidth="5" strokeOpacity="0.08" />

          {/* Hover connector lines */}
          {outerPositions.map(
            (p, i) =>
              hoveredOuter === i && (
                <line
                  key={`ol-${i}`}
                  x1={CX}
                  y1={CY}
                  x2={p.x}
                  y2={p.y}
                  stroke="var(--brand-accent)"
                  strokeWidth="0.75"
                  strokeOpacity="0.4"
                  strokeDasharray="4 3"
                />
              ),
          )}
          {innerPositions.map(
            (p, i) =>
              hoveredInner === i && (
                <line
                  key={`il-${i}`}
                  x1={CX}
                  y1={CY}
                  x2={p.x}
                  y2={p.y}
                  stroke="var(--brand-primary)"
                  strokeWidth="0.75"
                  strokeOpacity="0.4"
                  strokeDasharray="4 3"
                />
              ),
          )}

          {/* Scan line animation */}
          <rect
            x={CX - OUTER_R - 10}
            y={0}
            width={OUTER_R * 2 + 20}
            height={60}
            fill="url(#scan-grad)"
            style={{ animation: "scan-line 4s linear infinite" }}
          />

          {/* Ring labels (static) */}
          <text
            x={CX}
            y={CY - OUTER_R - 14}
            textAnchor="middle"
            fontSize={9}
            fontWeight="bold"
            fill="var(--brand-accent)"
            opacity={0.8}
            style={{ letterSpacing: "0.15em", textTransform: "uppercase" }}
          >
            SCHOOL CONTEXT
          </text>
          <text
            x={CX}
            y={CY - INNER_R - 10}
            textAnchor="middle"
            fontSize={9}
            fontWeight="bold"
            fill="var(--brand-primary)"
            opacity={0.7}
            style={{ letterSpacing: "0.15em" }}
          >
            STUDENT MEMORY
          </text>
        </svg>

        {/* Outer orbiting item badges */}
        {outerPositions.map((p, i) => {
          const item = OUTER_ITEMS[i];
          const Icon = item.Icon;
          const active = hoveredOuter === i;
          return (
            <div
              key={item.label}
              className="absolute transition-all duration-200"
              style={{
                left: p.x - 18,
                top: p.y - 18,
                width: 36,
                height: 36,
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: active ? "var(--brand-accent)" : "var(--bg-elevated)",
                border: `1px solid color-mix(in oklab, var(--brand-accent) ${active ? "60%" : "35%"}, transparent)`,
                color: active ? "white" : "var(--brand-accent)",
                boxShadow: active
                  ? "0 0 20px color-mix(in oklab, var(--brand-accent) 50%, transparent)"
                  : "0 0 8px color-mix(in oklab, var(--brand-accent) 20%, transparent)",
                cursor: "default",
                zIndex: 10,
              }}
              onMouseEnter={() => setHoveredOuter(i)}
              onMouseLeave={() => setHoveredOuter(null)}
            >
              <Icon size={15} strokeWidth={1.5} />
            </div>
          );
        })}

        {/* Inner orbiting item badges */}
        {innerPositions.map((p, i) => {
          const item = INNER_ITEMS[i];
          const Icon = item.Icon;
          const active = hoveredInner === i;
          return (
            <div
              key={item.label}
              className="absolute transition-all duration-200"
              style={{
                left: p.x - 15,
                top: p.y - 15,
                width: 30,
                height: 30,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: active ? "var(--brand-primary)" : "var(--bg-elevated)",
                border: `1px solid color-mix(in oklab, var(--brand-primary) ${active ? "60%" : "35%"}, transparent)`,
                color: active ? "white" : "var(--brand-primary)",
                boxShadow: active
                  ? "0 0 20px color-mix(in oklab, var(--brand-primary) 50%, transparent)"
                  : "0 0 6px color-mix(in oklab, var(--brand-primary) 20%, transparent)",
                cursor: "default",
                zIndex: 10,
              }}
              onMouseEnter={() => setHoveredInner(i)}
              onMouseLeave={() => setHoveredInner(null)}
            >
              <Icon size={13} strokeWidth={1.5} />
            </div>
          );
        })}

        {/* Center sparkle */}
        <div
          className="absolute"
          style={{
            left: CX - 16,
            top: CY - 16,
            width: 32,
            height: 32,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "color-mix(in oklab, var(--brand-primary) 20%, transparent)",
            color: "var(--brand-primary)",
          }}
        >
          <Sparkles size={16} />
        </div>
      </div>

      {/* ── Side panel ── */}
      <div className="flex-1 space-y-8 min-w-0">
        {/* Outer layer */}
        <div>
          <div className="flex items-center gap-2.5 mb-4">
            <div
              className="w-4 h-4 rounded-full flex-shrink-0"
              style={{
                border: "1.5px dashed var(--brand-accent)",
                background: "color-mix(in oklab, var(--brand-accent) 10%, transparent)",
              }}
            />
            <p className="text-sm font-bold" style={{ color: "var(--brand-accent)" }}>
              School context
            </p>
            <span className="text-[10px] text-[var(--text-tertiary)]">— set by administration</span>
          </div>
          <div className="space-y-1.5">
            {OUTER_ITEMS.map((item, i) => {
              const Icon = item.Icon;
              return (
                <div
                  key={item.label}
                  className="flex gap-3 px-4 py-3 rounded-xl cursor-default transition-all duration-200"
                  style={{
                    background: hoveredOuter === i
                      ? "color-mix(in oklab, var(--brand-accent) 10%, var(--bg-secondary))"
                      : "var(--bg-secondary)",
                    borderLeft: `2px solid ${hoveredOuter === i ? "var(--brand-accent)" : "transparent"}`,
                  }}
                  onMouseEnter={() => setHoveredOuter(i)}
                  onMouseLeave={() => setHoveredOuter(null)}
                >
                  <Icon
                    size={14}
                    strokeWidth={1.5}
                    style={{ color: "var(--brand-accent)", flexShrink: 0, marginTop: 2 }}
                  />
                  <div>
                    <p className="text-xs font-semibold text-[var(--text-primary)]">{item.label}</p>
                    <p className="text-[10px] mt-0.5 text-[var(--text-tertiary)]">{item.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Inner layer */}
        <div>
          <div className="flex items-center gap-2.5 mb-4">
            <div
              className="w-4 h-4 rounded-full flex-shrink-0"
              style={{
                border: "1.5px solid var(--brand-primary)",
                background: "color-mix(in oklab, var(--brand-primary) 12%, transparent)",
              }}
            />
            <p className="text-sm font-bold" style={{ color: "var(--brand-primary)" }}>
              Student memory
            </p>
            <span className="text-[10px] text-[var(--text-tertiary)]">— unique per learner</span>
          </div>
          <div className="space-y-1.5">
            {INNER_ITEMS.map((item, i) => {
              const Icon = item.Icon;
              return (
                <div
                  key={item.label}
                  className="flex gap-3 px-4 py-3 rounded-xl cursor-default transition-all duration-200"
                  style={{
                    background: hoveredInner === i
                      ? "color-mix(in oklab, var(--brand-primary) 10%, var(--bg-secondary))"
                      : "var(--bg-secondary)",
                    borderLeft: `2px solid ${hoveredInner === i ? "var(--brand-primary)" : "transparent"}`,
                  }}
                  onMouseEnter={() => setHoveredInner(i)}
                  onMouseLeave={() => setHoveredInner(null)}
                >
                  <Icon
                    size={14}
                    strokeWidth={1.5}
                    style={{ color: "var(--brand-primary)", flexShrink: 0, marginTop: 2 }}
                  />
                  <div>
                    <p className="text-xs font-semibold text-[var(--text-primary)]">{item.label}</p>
                    <p className="text-[10px] mt-0.5 text-[var(--text-tertiary)]">{item.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Synthesis */}
        <div
          className="rounded-2xl border p-5 transition-all duration-500"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "color-mix(in oklab, var(--brand-primary) 25%, var(--border-default))",
            boxShadow: "0 0 32px -12px color-mix(in oklab, var(--brand-primary) 20%, transparent)",
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={14} style={{ color: "var(--brand-primary)" }} />
            <p className="text-xs font-bold" style={{ color: "var(--brand-primary)" }}>
              Combined → Personalised response
            </p>
          </div>
          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
            Both layers merge at response time — every answer fits the school&apos;s curriculum and
            the student&apos;s personal journey. Neither layer is ever visible to the learner.
          </p>
        </div>
      </div>
    </div>
  );
}
