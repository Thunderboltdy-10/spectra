/** A loading placeholder. With the field on, it becomes a ghost: light breathing along its lines (LIFE.md, "Load"). */
export function Skeleton({ className = "", style, bar = false }: { className?: string; style?: React.CSSProperties; bar?: boolean }) {
  return (
    <div
      {...(bar ? { "data-life-ghost-bar": "" } : { "data-life-ghost": "" })}
      className={`animate-pulse rounded-control bg-[var(--bg-secondary)] ${className}`}
      style={style}
    />
  );
}

export function SkeletonCard() {
  return (
    <div data-life-ghost className="rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
      <Skeleton bar className="mb-3 h-5 w-3/4" />
      <Skeleton bar className="mb-2 h-4 w-full" />
      <Skeleton bar className="h-4 w-2/3" />
    </div>
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div data-life-ghost className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} bar className="h-12 w-full" />
      ))}
    </div>
  );
}

/** Ragged widths, so a few lines read as a paragraph still being written. */
const GHOST_WIDTHS = [92, 78, 54, 86, 63];

/**
 * Lines of what is still coming (a reply being written, a step's result):
 * the skeleton's bars with its band of light passing along them. They work
 * with the field off too, and stay still under reduced motion.
 */
export function GhostLines({ count = 3, className = "" }: { count?: number; className?: string }) {
  return (
    <span aria-hidden className={`block space-y-2 ${className}`}>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="life-ghost-line" style={{ width: `${GHOST_WIDTHS[index % GHOST_WIDTHS.length]}%` }} />
      ))}
    </span>
  );
}

/** Spectra is working in this (a thread, a work): two short lines being written, crossed by the band. */
export function WorkingMark({ className = "", label }: { className?: string; label?: string }) {
  return <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={`life-working-mark ${className}`} />;
}
