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
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
