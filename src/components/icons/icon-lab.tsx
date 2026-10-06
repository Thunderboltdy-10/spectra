"use client";

import { useState } from "react";
import { Icon } from "./icon";
import { ICON_FAMILIES, type IconName } from "./glyphs";

/** Accents the lab shows each family in: type hues for types, state hues for status. */
const ACCENTS: Partial<Record<IconName, string>> = {
  document: "var(--mode-document)",
  slides: "var(--accent-coral)",
  sheet: "var(--success)",
  quiz: "var(--mode-quiz)",
  flashcards: "var(--mode-document)",
  whiteboard: "var(--accent-gold)",
  code: "var(--accent-cyan)",
  task: "var(--warning)",
  timetable: "var(--accent-mint)",
  pdf: "var(--danger)",
  folder: "var(--text-secondary)",
  agent: "var(--accent-cyan)",
  conversations: "var(--brand-primary)",
  saved: "var(--success)",
  saving: "var(--accent-cyan)",
  offline: "var(--text-tertiary)",
  syncing: "var(--accent-cyan)",
  locked: "var(--warning)",
  readOnly: "var(--accent-cyan)",
  versions: "var(--warning)",
  problem: "var(--danger)",
  info: "var(--accent-cyan)",
  done: "var(--success)",
  bell: "var(--danger)",
  cas: "var(--accent-mint)",
  grade: "var(--success)",
  live: "var(--danger)",
  blocked: "var(--danger)",
  health: "var(--danger)",
  memory: "var(--brand-primary)",
};

function Panel({ dark, animate, colour }: { dark: boolean; animate: boolean; colour: boolean }) {
  return (
    <section className={`${dark ? "dark" : ""} min-w-0 flex-1 rounded-surface border border-[var(--border-default)] bg-[var(--bg-primary)] p-5 text-[var(--text-primary)]`}>
      <h2 className="text-caption font-medium text-[var(--text-tertiary)]">{dark ? "Dark" : "Light"}</h2>
      {ICON_FAMILIES.map(({ family, names }) => (
        <div key={family} className="mt-4">
          <h3 className="text-micro font-medium text-[var(--text-secondary)]">{family}</h3>
          <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-1">
            {names.map((name) => (
              <button
                key={name}
                type="button"
                title={name}
                className="flex flex-col items-center gap-1.5 rounded-control px-1 py-2 text-[var(--text-primary)] transition hover:bg-[var(--bg-elevated)]"
              >
                <span className="flex items-end gap-2">
                  <Icon name={name} size={16} accent={colour ? ACCENTS[name] : undefined} animate={animate} />
                  <Icon name={name} size={20} accent={colour ? ACCENTS[name] : undefined} animate={animate} />
                  <Icon name={name} size={40} accent={colour ? ACCENTS[name] : undefined} animate={animate} />
                </span>
                <span className="max-w-full truncate text-micro text-[var(--text-tertiary)]">{name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export function IconLab() {
  const [animate, setAnimate] = useState(false);
  const [colour, setColour] = useState(true);
  return (
    <main className="min-h-dvh px-6 pb-16 pt-6 text-[var(--text-primary)]">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-ui font-semibold">Icon lab</h1>
        <span className="text-caption text-[var(--text-tertiary)]">16, 20 and 40 px. Hover a glyph to play its animation.</span>
        <label className="ml-auto flex items-center gap-1.5 text-caption">
          <input type="checkbox" checked={animate} onChange={(event) => setAnimate(event.target.checked)} /> Animating
        </label>
        <label className="flex items-center gap-1.5 text-caption">
          <input type="checkbox" checked={colour} onChange={(event) => setColour(event.target.checked)} /> Accents
        </label>
      </header>
      <div className="mt-5 flex flex-col gap-5 xl:flex-row">
        <Panel dark={false} animate={animate} colour={colour} />
        <Panel dark animate={animate} colour={colour} />
      </div>
    </main>
  );
}
