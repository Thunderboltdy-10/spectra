"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { LoadingRows } from "@/components/ui/page-state";
import { fetchMyClassCandidates, type ClassShelfCandidate } from "../components/class-shelf-picker";
import { selectSpectraManageBacClasses } from "../data/api";
import { classIdentity } from "../../../../shared/class-identity";
import { sentenceOf } from "./school-model";
import { inkStyle, useClassBook } from "./use-class-book";

/*
 * Which classes sync: every class ManageBac lists for the student, pressed in
 * or out, subjects first. A class left out keeps what Spectra already has and
 * brings in nothing more; its workspace stays in the Library.
 */

type Candidates = { classes: ClassShelfCandidate[]; revision?: number };

export function ClassChoice({ onNotice }: { onNotice: (message: string) => void }) {
  const book = useClassBook();
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchMyClassCandidates()
      .then((result) => {
        if (!live) return;
        setCandidates({ classes: result.classes, revision: result.selectionRevision });
        setChosen(new Set(result.classes.filter((entry) => entry.selected).map((entry) => entry.recordId)));
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const placed = useMemo(() => {
    const list = (candidates?.classes ?? []).map((candidate) => {
      const known = book.classes.find((cls) => cls.recordId === candidate.recordId);
      const identity = known ? book.of(known.providerClassId, known.title)! : classIdentity({ providerClassId: candidate.recordId, title: candidate.title });
      return { candidate, identity };
    });
    return list.sort((a, b) => Number(b.identity.subject) - Number(a.identity.subject) || a.identity.name.localeCompare(b.identity.name));
  }, [book, candidates]);

  if (failed) return null;
  if (!candidates) return <LoadingRows label="Loading your classes" count={2} />;
  if (!candidates.classes.length) return null;

  const saved = new Set(candidates.classes.filter((entry) => entry.selected).map((entry) => entry.recordId));
  const changed = chosen.size !== saved.size || [...chosen].some((id) => !saved.has(id));

  function toggle(recordId: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }

  async function save() {
    if (!candidates || typeof candidates.revision !== "number") return;
    setSaving(true);
    try {
      const result = await selectSpectraManageBacClasses({ recordIds: [...chosen], expectedRevision: candidates.revision, retention: "keep_in_spectra" });
      setCandidates({
        revision: result.selectionRevision,
        classes: candidates.classes.map((entry) => ({ ...entry, selected: result.selectedRecordIds.includes(entry.recordId) })),
      });
      setChosen(new Set(result.selectedRecordIds));
      const count = result.selectedRecordIds.length;
      onNotice(
        count === candidates.classes.length
          ? `All ${count} classes sync.`
          : `${count} of ${candidates.classes.length} classes sync. The others keep what's already here.`,
      );
    } catch (error) {
      onNotice(/SELECTION_CONFLICT/.test(String(error)) ? "Your classes changed elsewhere. Open Sync again, then choose." : sentenceOf(error, "That didn't save. Try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="school-class-choice" className="mt-10">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h3 id="school-class-choice" className="school-heading !my-0">
            Which classes sync <span className="school-heading-count">{chosen.size} of {candidates.classes.length}</span>
          </h3>
          <p className="mt-1.5 max-w-2xl text-ui text-[var(--text-secondary)]">
            A class left out stops bringing in more; what’s already here stays, and so does its workspace.
          </p>
        </div>
        {changed ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => setChosen(saved)}>
              Undo
            </Button>
            <Button size="sm" variant="primary" disabled={saving || typeof candidates.revision !== "number"} onClick={() => void save()}>
              {saving ? "Saving" : "Save classes"}
            </Button>
          </div>
        ) : null}
      </div>
      <ul className="school-choice">
        {placed.map(({ candidate, identity }) => {
          const on = chosen.has(candidate.recordId);
          return (
            <li key={candidate.recordId}>
              <button type="button" aria-pressed={on} title={identity.code ?? undefined} onClick={() => toggle(candidate.recordId)} style={inkStyle(identity)} className="school-choice-item">
                <span aria-hidden className="school-choice-box">
                  {on ? <Icon name="check" size={12} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{identity.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
