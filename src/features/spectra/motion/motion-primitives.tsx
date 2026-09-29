"use client";

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { grammarFor, transitionFor, type MotionPrimitive } from "./grammar";
import { useSpectraMotion } from "./motion-level";

/**
 * Shared motion primitives (Phase 14.1). All components resolve the effective
 * motion level (preference + OS reduced-motion) so decoration disappears
 * while state transitions stay legible.
 */

/* ------------------------------------------------------------------ *
 * SpectraMotionConfig — the Spectra motion level for every framer tree.
 *
 * Framer-motion ignores prefers-reduced-motion unless told otherwise, and
 * knows nothing of the Spectra preference, so the live dock, progress
 * trace, command bar, context picker and embeds panel moved at full travel
 * for someone who had asked for less. Mounted once at the root: "reduced"
 * turns transform and layout travel off (opacity still fades); "none" skips
 * framer animations entirely, matching the CSS contract.
 * ------------------------------------------------------------------ */
export function SpectraMotionConfig({ children }: { children: ReactNode }) {
  const motionLevel = useSpectraMotion();
  return (
    <MotionConfig
      reducedMotion={motionLevel.reduced ? "always" : "never"}
      skipAnimations={motionLevel.disabled}
    >
      {children}
    </MotionConfig>
  );
}

/* ------------------------------------------------------------------ *
 * Reveal — content enters with a soft rise + fade.
 * ------------------------------------------------------------------ */
export function Reveal({
  children,
  className,
  primitive = "reveal",
  delay = 0,
  style,
}: {
  children: ReactNode;
  className?: string;
  primitive?: MotionPrimitive;
  delay?: number;
  style?: CSSProperties;
}) {
  const motionLevel = useSpectraMotion();
  const config = grammarFor(primitive, motionLevel.level);
  if (motionLevel.disabled)
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y: config.distance }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...transitionFor(primitive, motionLevel.level), delay }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ *
 * CrossfadeText — changing text crossfades instead of snapping.
 * Used for Live Dock semantic steps, titles and status copy.
 * ------------------------------------------------------------------ */
export function CrossfadeText({
  value,
  className,
  primitive = "reveal",
}: {
  value: string;
  className?: string;
  primitive?: MotionPrimitive;
}) {
  const motionLevel = useSpectraMotion();
  const config = grammarFor(primitive, motionLevel.level);
  const transition = transitionFor(primitive, motionLevel.level);
  if (motionLevel.disabled) return <span className={className}>{value}</span>;
  const shift = Math.max(1, Math.round(config.distance / 2));
  return (
    <span
      className={`inline-grid overflow-hidden align-baseline ${className ?? ""}`}
    >
      <AnimatePresence initial={false} mode="sync">
        <motion.span
          key={value}
          className="col-start-1 row-start-1 block min-w-0 truncate"
          initial={{ opacity: 0, y: shift }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -shift }}
          transition={transition}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * MorphShell — shared-layout morph between two geometries with the same
 * layoutId (reference collapsed→expanded, panel transfer).
 * ------------------------------------------------------------------ */
export function MorphShell({
  layoutId,
  children,
  className,
}: {
  layoutId: string;
  children: ReactNode;
  className?: string;
}) {
  const motionLevel = useSpectraMotion();
  const transition = useMemo(
    () => transitionFor("morph", motionLevel.level),
    [motionLevel.level],
  );
  if (motionLevel.disabled) return <div className={className}>{children}</div>;
  return (
    <motion.div
      layoutId={layoutId}
      className={className}
      transition={transition}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ *
 * FocusPulse — one restrained ring pulse to mark a navigated target,
 * then settles (inspector comment navigation, source reveal).
 * ------------------------------------------------------------------ */
export function FocusPulse({
  children,
  pulseKey,
  className,
}: {
  children: ReactNode;
  /** change this key to re-fire the pulse */
  pulseKey: string | number | null;
  className?: string;
}) {
  const motionLevel = useSpectraMotion();
  if (motionLevel.disabled) return <div className={className}>{children}</div>;
  return (
    <motion.div
      key={pulseKey ?? "settled"}
      className={className}
      initial={
        motionLevel.reduced
          ? { opacity: 0.72 }
          : { boxShadow: "0 0 0 3px var(--selection-bg)" }
      }
      animate={
        motionLevel.reduced
          ? { opacity: 1 }
          : { boxShadow: "0 0 0 0px transparent" }
      }
      transition={transitionFor("focus", motionLevel.level)}
    >
      {children}
    </motion.div>
  );
}
