"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, GraduationCap, FileText, BookOpen, Network, Brain, BarChart3, MessageCircle } from "lucide-react";

// ── Concentric 3D cross-section onion ────────────────────────

const OUTER_ITEMS = [
  { Icon: GraduationCap, label: "Curriculum standards", desc: "Answers stay on-syllabus", angle: 15 },
  { Icon: FileText, label: "Class materials", desc: "Uploaded notes & resources", angle: 105 },
  { Icon: BookOpen, label: "School guidelines", desc: "Academic integrity rules", angle: 195 },
  { Icon: Network, label: "School Ontology", desc: "Mappings to school taxonomy", angle: 285 },
];

const INNER_ITEMS = [
  { Icon: Brain, label: "Learning style", desc: "How explanations are shaped", angle: 60 },
  { Icon: BarChart3, label: "Knowledge gaps", desc: "What to reinforce", angle: 150 },
  { Icon: MessageCircle, label: "Session memory", desc: "Context across sessions", angle: 240 },
  { Icon: Sparkles, label: "Personalized tone", desc: "Adaptable language model", angle: 330 },
];

const CX = 275; // Increased size to 550x550
const CY = 275;
const OUTER_R = 220;
const INNER_R = 140;
const CORE_R = 50;

// ── Holographic 3D Sphere Component ──────────────────────────────────────
function HologramSphere({ radius, color, rotation = 0 }: { radius: number, color: string, rotation?: number }) {
  const rings = [];
  // Render rings from 90 to 360 to leave a 90-degree slice open
  for (let a = 90; a <= 360; a += 15) {
    rings.push(
      <div
        key={a}
        className="absolute left-1/2 top-1/2 rounded-full pointer-events-none"
        style={{
          width: radius * 2,
          height: radius * 2,
          marginLeft: -radius,
          marginTop: -radius,
          border: `1px solid ${color}`,
          opacity: a % 30 === 0 ? 0.3 : 0.1,
          transform: `rotateY(${a}deg)`,
        }}
      />
    );
  }

  // Cross-section planes
  const Plane = ({ angle }: { angle: number }) => (
    <div
      className="absolute left-1/2 top-1/2 rounded-full pointer-events-none"
      style={{
        width: radius * 2,
        height: radius * 2,
        marginLeft: -radius,
        marginTop: -radius,
        background: `color-mix(in oklab, ${color} 15%, transparent)`,
        borderRight: `2px solid ${color}`,
        borderTop: `2px solid ${color}`,
        borderBottom: `2px solid ${color}`,
        clipPath: "polygon(50% 0%, 100% 0%, 100% 100%, 50% 100%)",
        transform: `rotateY(${angle}deg)`,
      }}
    >
      {/* Inner grid lines for holographic effect */}
      <div className="absolute inset-0" style={{ backgroundImage: `linear-gradient(${color}20 1px, transparent 1px), linear-gradient(90deg, ${color}20 1px, transparent 1px)`, backgroundSize: '24px 24px', clipPath: "polygon(50% 0%, 100% 0%, 100% 100%, 50% 100%)" }} />
    </div>
  );

  return (
    <div className="absolute inset-0" style={{ transformStyle: "preserve-3d", transform: `rotateY(${rotation}deg)` }}>
      {rings}
      <Plane angle={0} />
      <Plane angle={90} />
      {/* Equator ring */}
      <div
        className="absolute left-1/2 top-1/2 rounded-full pointer-events-none"
        style={{
          width: radius * 2,
          height: radius * 2,
          marginLeft: -radius,
          marginTop: -radius,
          border: `2px solid ${color}`,
          opacity: 0.5,
          transform: "rotateX(90deg)",
        }}
      />
    </div>
  );
}

export function SoulDiagram() {
  const [rotY, setRotY] = useState(0);
  const [rotX, setRotX] = useState(25); // Tilt
  const rafRef = useRef<number>(0);
  const prevTimeRef = useRef(0);

  useEffect(() => {
    const animate = (t: number) => {
      if (prevTimeRef.current > 0) {
        const dt = t - prevTimeRef.current;
        setRotY((v) => (v + dt * 0.012) % 360);
      }
      prevTimeRef.current = t;
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div className="flex flex-col xl:flex-row gap-16 items-center w-full">
      {/* ── 3D Hologram Cake Visualisation ── */}
      <div
        className="relative shrink-0 flex items-center justify-center group"
        style={{ width: 550, height: 550, perspective: "1400px" }}
      >
        {/* Ambient glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 60% 60% at 50% 50%, color-mix(in oklab, var(--brand-primary) 15%, transparent), transparent 70%)",
            filter: "blur(60px)",
          }}
        />

        {/* 3D container */}
        <div
          className="absolute inset-0"
          style={{
            transformStyle: "preserve-3d",
            transform: `rotateX(${-rotX}deg) rotateZ(0deg) rotateY(${rotY}deg)`,
          }}
        >
          {/* Outer Layer (School Context) */}
          <HologramSphere radius={OUTER_R} color="var(--brand-accent)" />

          {/* Middle Layer (Student Memory) */}
          <HologramSphere radius={INNER_R} color="var(--brand-primary)" rotation={-45} />

          {/* Inner Core (Files & Memory) */}
          <div
            className="absolute rounded-full"
            style={{
              left: CX - CORE_R,
              top: CY - CORE_R,
              width: CORE_R * 2,
              height: CORE_R * 2,
              background: "radial-gradient(circle at 30% 30%, var(--brand-primary), var(--bg-primary))",
              boxShadow: "0 0 60px var(--brand-primary), inset 0 0 30px white",
              transform: `translateZ(0px) rotateY(${-rotY}deg) rotateX(${rotX}deg)`,
              transformStyle: "preserve-3d"
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <Sparkles size={32} color="white" className="animate-pulse" />
            </div>
          </div>

          {/* Floating Labels that face the camera */}
          
          {/* School Layer Label */}
          <div
            className="absolute flex flex-col items-center justify-center pointer-events-none transition-opacity duration-300"
            style={{
              left: CX - 100,
              top: CY - 30,
              width: 200,
              // Orbit positioned along the outer edge
              transform: `translateX(${Math.cos(45 * Math.PI / 180) * (OUTER_R + 60)}px) translateZ(${Math.sin(45 * Math.PI / 180) * (OUTER_R + 60)}px) rotateY(${-rotY}deg) rotateX(${rotX}deg)`,
              transformStyle: "preserve-3d",
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--brand-accent)] shadow-[0_0_8px_var(--brand-accent)]" />
              <span className="font-display font-bold text-lg tracking-wide uppercase text-[var(--brand-accent)]" style={{ textShadow: "0 4px 20px rgba(0,0,0,0.8)" }}>School Layer</span>
            </div>
            <div className="h-px w-full bg-gradient-to-r from-transparent via-[var(--brand-accent)] to-transparent opacity-60" />
            <span className="text-xs font-semibold text-[var(--text-secondary)] mt-2 bg-[var(--bg-elevated)] px-3 py-1 rounded-full border border-[var(--brand-accent)]/30 backdrop-blur-md">External Constraints</span>
          </div>

          {/* Personal Memory Label */}
          <div
            className="absolute flex flex-col items-center justify-center pointer-events-none transition-opacity duration-300"
            style={{
              left: CX - 100,
              top: CY - 30,
              width: 200,
              // Orbit positioned along the inner edge
              transform: `translateX(${Math.cos(225 * Math.PI / 180) * (INNER_R + 60)}px) translateZ(${Math.sin(225 * Math.PI / 180) * (INNER_R + 60)}px) rotateY(${-rotY}deg) rotateX(${rotX}deg)`,
              transformStyle: "preserve-3d",
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--brand-primary)] shadow-[0_0_8px_var(--brand-primary)]" />
              <span className="font-display font-bold text-lg tracking-wide uppercase text-[var(--brand-primary)]" style={{ textShadow: "0 4px 20px rgba(0,0,0,0.8)" }}>Personal Memory</span>
            </div>
            <div className="h-px w-full bg-gradient-to-r from-transparent via-[var(--brand-primary)] to-transparent opacity-60" />
            <span className="text-xs font-semibold text-[var(--text-secondary)] mt-2 bg-[var(--bg-elevated)] px-3 py-1 rounded-full border border-[var(--brand-primary)]/30 backdrop-blur-md">Internal Adaptive Core</span>
          </div>
        </div>
      </div>

      {/* ── Side panel ── */}
      <div className="flex-1 space-y-10 min-w-0 py-8">
        {/* Outer layer */}
        <div className="group">
          <div className="flex items-center gap-3 mb-5">
            <div
              className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center"
              style={{
                border: "2px solid var(--brand-accent)",
                background: "color-mix(in oklab, var(--brand-accent) 15%, transparent)",
                boxShadow: "0 0 15px var(--brand-accent)",
              }}
            >
              <div className="w-2 h-2 rounded-full bg-[var(--brand-accent)]" />
            </div>
            <p className="text-xl font-bold uppercase tracking-widest" style={{ color: "var(--brand-accent)" }}>
              School Layer
            </p>
            <span className="text-xs font-mono text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity">— External Constraints</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {OUTER_ITEMS.map((item, i) => {
              const Icon = item.Icon;
              return (
                <div
                  key={item.label}
                  className="flex gap-3 px-5 py-4 rounded-2xl cursor-default transition-all duration-300 border border-transparent hover:-translate-y-1 hover:shadow-[0_10px_20px_rgba(0,0,0,0.1)]"
                  style={{
                    background: "var(--bg-secondary)",
                  }}
                >
                  <Icon size={18} strokeWidth={2} style={{ color: "var(--brand-accent)", flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <p className="text-sm font-bold text-[var(--text-primary)] mb-1">{item.label}</p>
                    <p className="text-xs text-[var(--text-tertiary)] leading-tight">{item.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Inner layer */}
        <div className="group">
          <div className="flex items-center gap-3 mb-5">
            <div
              className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center"
              style={{
                border: "2px solid var(--brand-primary)",
                background: "color-mix(in oklab, var(--brand-primary) 15%, transparent)",
                boxShadow: "0 0 15px var(--brand-primary)",
              }}
            >
              <div className="w-2 h-2 rounded-full bg-[var(--brand-primary)]" />
            </div>
            <p className="text-xl font-bold uppercase tracking-widest" style={{ color: "var(--brand-primary)" }}>
              Personal Layer
            </p>
            <span className="text-xs font-mono text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity">— Internal Adaptive Core</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {INNER_ITEMS.map((item, i) => {
              const Icon = item.Icon;
              return (
                <div
                  key={item.label}
                  className="flex gap-3 px-5 py-4 rounded-2xl cursor-default transition-all duration-300 border border-transparent hover:-translate-y-1 hover:shadow-[0_10px_20px_rgba(0,0,0,0.1)]"
                  style={{
                    background: "var(--bg-secondary)",
                  }}
                >
                  <Icon size={18} strokeWidth={2} style={{ color: "var(--brand-primary)", flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <p className="text-sm font-bold text-[var(--text-primary)] mb-1">{item.label}</p>
                    <p className="text-xs text-[var(--text-tertiary)] leading-tight">{item.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
