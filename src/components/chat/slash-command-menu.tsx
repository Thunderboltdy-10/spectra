"use client";

import { SLASH_COMMANDS } from "@/lib/slash-commands";

type SlashCommandMenuProps = {
  query: string;
  onSelect: (command: string) => void;
};

export function SlashCommandMenu({ query, onSelect }: SlashCommandMenuProps) {
  const normalized = query.toLowerCase().replace(/^\//, "");
  const filtered = SLASH_COMMANDS.filter((item) =>
    item.trigger.slice(1).includes(normalized),
  ).slice(0, 6);

  if (filtered.length === 0) return null;

  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-soft)]">
      {filtered.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(`${item.trigger} `)}
          className="block w-full border-b border-[var(--border-default)] px-3 py-2 text-left transition last:border-b-0 hover:bg-[var(--bg-hover)]"
        >
          <p className="text-sm font-medium text-[var(--text-primary)]">{item.trigger}</p>
          <p className="text-xs text-[var(--text-secondary)]">{item.description}</p>
        </button>
      ))}
    </div>
  );
}
