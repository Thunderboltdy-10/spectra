"use client";

import { useMemo, useState } from "react";

type TopicCloudProps = {
  topics: string[];
};

type TopicType = {
  key: string;
  label: string;
  patterns: RegExp[];
};

const TOPIC_TYPES: TopicType[] = [
  {
    key: "stem",
    label: "STEM",
    patterns: [/math|algebra|geometry|calculus|physics|chemistry|biology|statistics|equation|theorem/i],
  },
  {
    key: "coding",
    label: "Coding",
    patterns: [/code|debug|python|javascript|typescript|react|api|sql|algorithm|programming/i],
  },
  {
    key: "writing",
    label: "Writing",
    patterns: [/essay|writing|thesis|paragraph|grammar|citation|argument|outline|draft/i],
  },
  {
    key: "research",
    label: "Research",
    patterns: [/research|source|paper|journal|evidence|analysis|compare|review|study/i],
  },
  {
    key: "humanities",
    label: "Humanities",
    patterns: [/history|philosophy|ethics|geography|literature|politics|economics|sociology/i],
  },
  {
    key: "language",
    label: "Languages",
    patterns: [/spanish|french|german|italian|translation|vocabulary|language|pronunciation/i],
  },
  {
    key: "exam",
    label: "Exam Prep",
    patterns: [/exam|quiz|flashcard|test|practice|revision|mark scheme|rubric/i],
  },
];

function normalizeTopic(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s\-+/.]/g, "")
    .slice(0, 72);
}

function classifyTopic(value: string) {
  for (const type of TOPIC_TYPES) {
    if (type.patterns.some((pattern) => pattern.test(value))) {
      return type.key;
    }
  }
  return "general";
}

export function TopicCloud({ topics }: TopicCloudProps) {
  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState<string>("all");

  const grouped = useMemo(() => {
    const clean = query.trim().toLowerCase();
    const byType = new Map<string, Map<string, number>>();

    for (const raw of topics) {
      const normalized = normalizeTopic(raw);
      if (!normalized) continue;
      if (clean && !normalized.toLowerCase().includes(clean)) continue;

      const typeKey = classifyTopic(normalized);
      if (activeType !== "all" && typeKey !== activeType) continue;

      const bucket = byType.get(typeKey) ?? new Map<string, number>();
      bucket.set(normalized, (bucket.get(normalized) ?? 0) + 1);
      byType.set(typeKey, bucket);
    }

    const rows = [...byType.entries()].map(([key, topicMap]) => {
      const items = [...topicMap.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const total = items.reduce((sum, [, count]) => sum + count, 0);
      const label = TOPIC_TYPES.find((type) => type.key === key)?.label ?? "General";
      return { key, label, total, items };
    });

    return rows.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  }, [activeType, query, topics]);

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const topic of topics) {
      const type = classifyTopic(topic);
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return counts;
  }, [topics]);

  if (topics.length === 0) {
    return (
      <div className="journal-card border-dashed p-4 text-center text-sm text-[var(--text-secondary)]">
        No topics explored yet
      </div>
    );
  }

  return (
    <div className="journal-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Topics explored by type</p>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter topics"
          className="h-8 w-[220px] rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 text-xs"
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setActiveType("all")}
          className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs transition ${
            activeType === "all"
              ? "border-[var(--accent)] bg-[var(--bg-primary)] font-semibold text-[var(--text-primary)]"
              : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          }`}
        >
          All
        </button>
        {TOPIC_TYPES.map((type) => (
          <button
            key={type.key}
            type="button"
            onClick={() => setActiveType(type.key)}
            className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs transition ${
              activeType === type.key
                ? "border-[var(--accent)] bg-[var(--bg-primary)] font-semibold text-[var(--text-primary)]"
                : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            {type.label} ({typeCounts.get(type.key) ?? 0})
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {grouped.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">No matching topics found.</p>
        ) : (
          grouped.map((group) => (
            <div key={group.key} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-primary)]">
                  {group.label}
                </p>
                <p className="text-[11px] text-[var(--text-secondary)]">{group.total} mentions</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.items.slice(0, 20).map(([topic, count]) => (
                  <span
                    key={`${group.key}-${topic}`}
                    className="rounded-[var(--radius-pill)] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs"
                  >
                    {topic}
                    <span className="ml-1 text-[10px] text-[var(--text-secondary)]">x{count}</span>
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
