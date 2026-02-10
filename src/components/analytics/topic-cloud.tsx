"use client";

type TopicCloudProps = {
  topics: string[];
};

export function TopicCloud({ topics }: TopicCloudProps) {
  if (topics.length === 0) {
    return (
      <div className="rounded-[var(--radius-container)] border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 text-center text-sm text-[var(--text-secondary)]">
        No topics explored yet
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-card)]">
      <p className="mb-3 text-xs uppercase tracking-wide text-[var(--text-secondary)]">Topics explored</p>
      <div className="flex flex-wrap gap-1.5">
        {topics.map((topic) => (
          <span
            key={topic}
            className="rounded-[var(--radius-pill)] border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-1 text-xs"
          >
            {topic}
          </span>
        ))}
      </div>
    </div>
  );
}
