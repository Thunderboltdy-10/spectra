"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { MEMORY_CAPS, type MemoryChange, type MemoryHead } from "../../../../../shared/memory-files";
import { getSpectraMemoryFiles, getSpectraMemoryTopic, updateSpectraMemoryFile } from "../../data/api";

/*
 * Spectra's notes about the user, open to read and change. What is here is what
 * the agent sees, so nothing about the user's memory is hidden from them.
 */

function NoteFile({
  label,
  description,
  placeholder,
  value,
  cap,
  onSave,
}: {
  label: string;
  description: string;
  placeholder: string;
  value: string;
  cap: number;
  onSave: (text: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const changed = draft.trim() !== value.trim();
  const over = draft.length > cap;
  return (
    <div className="rounded-card px-3.5 py-3">
      <label className="block">
        <span className="text-ui font-medium text-[var(--text-primary)]">{label}</span>
        <span className="mt-0.5 block max-w-2xl text-micro leading-[18px] text-[var(--text-secondary)]">{description}</span>
        <Textarea
          className="mt-2.5 min-h-[120px] resize-y text-ui leading-6"
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <div className="mt-2 flex min-h-8 items-center justify-between gap-3">
        <span className={`text-micro tabular-nums ${over ? "text-[var(--state-error)]" : "text-[var(--text-tertiary)]"}`}>
          {draft.length} of {cap} characters
        </span>
        {changed ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={saving || over}
            onClick={async () => {
              setSaving(true);
              await onSave(draft);
              setSaving(false);
            }}
          >
            {saving ? "Saving" : "Save"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function TopicRow({ topic, onErase }: { topic: MemoryHead["topics"][number]; onErase: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-card px-3.5 py-3 transition-colors hover:bg-[var(--bg-secondary)]">
      <div className="flex items-start gap-4">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          aria-expanded={open}
          onClick={async () => {
            setOpen((value) => !value);
            if (content === null) {
              const loaded = await getSpectraMemoryTopic(topic.slug).catch(() => null);
              setContent(loaded?.content ?? "");
            }
          }}
        >
          <span className="block text-ui font-medium text-[var(--text-primary)]">{topic.title}</span>
          <span className="mt-0.5 block text-micro leading-[18px] text-[var(--text-secondary)]">{topic.summary}</span>
        </button>
        <Button size="sm" variant="ghost" onClick={onErase}>
          Forget
        </Button>
      </div>
      {open ? (
        <p className="mt-2.5 whitespace-pre-wrap text-caption leading-5 text-[var(--text-secondary)]">
          {content === null ? "Opening" : content || "This note is empty."}
        </p>
      ) : null}
    </div>
  );
}

export function MemoryFilesSettings() {
  const [head, setHead] = useState<MemoryHead | null>(null);
  const load = () => getSpectraMemoryFiles().then(setHead).catch(() => setHead(null));
  useEffect(() => {
    void load();
  }, []);
  const change = async (next: MemoryChange) => {
    const result = await updateSpectraMemoryFile(next).catch((error: unknown) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : "That could not be saved.",
    }));
    if (result.ok) await load();
    else toast.error(result.message);
    return result.ok;
  };
  if (!head) return null;
  if (!head.enabled)
    return <p className="px-3.5 py-3 text-caption text-[var(--text-secondary)]">Memory is turned off, so Spectra is not keeping notes.</p>;
  return (
    <>
      <NoteFile
        label="About you"
        description="Who you are and what you are working on. Spectra reads this in every conversation."
        placeholder="Spectra adds to this as it learns about you."
        value={head.about}
        cap={MEMORY_CAPS.about}
        onSave={(rewrite) => change({ file: "about", rewrite })}
      />
      <NoteFile
        label="How Spectra works with you"
        description="Each line says where it applies, so a preference for one class stays with that class. These stay the same on any model."
        placeholder="Everywhere: short answers first. Word documents: keep my headings."
        value={head.preferences}
        cap={MEMORY_CAPS.preferences}
        onSave={(rewrite) => change({ file: "preferences", rewrite })}
      />
      {head.topics.map((topic) => (
        <TopicRow key={topic.slug} topic={topic} onErase={() => void change({ file: "topic", slug: topic.slug, remove: true })} />
      ))}
    </>
  );
}
