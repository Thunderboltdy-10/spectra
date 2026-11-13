"use client";

import { useMutation } from "convex/react";
import { Button } from "@/components/ui/button";
import { LoadingRows } from "@/components/ui/page-state";
import { Segmented } from "@/components/ui/segmented";
import { api } from "../../../../convex/_generated/api";
import { SCHOOL_SYNC_KIND_INFO, type SchoolSyncKind, type SchoolSyncMode } from "../../../../shared/school-sync";
import { sendInto } from "../life/use-life";
import { ClassChoice } from "./school-class-choice";
import { MODE_HINT, MODE_LABEL, kindLine, sentenceOf, type SchoolPreferences, type SchoolSyncStatus } from "./school-model";

/*
 * Sync: what comes in from ManageBac, a card for each kind of data. The card
 * says what the data is, how it is kept (a light in its corner: green kept
 * up to date, blue only when asked, grey off, red a problem), when it last
 * came in, and holds its own choice and Sync now. Kinds ManageBac's API does
 * not serve are not a choice and are not shown.
 */

const MODE_OPTIONS = (["auto", "manual", "off"] as const).map((value) => ({ value, label: MODE_LABEL[value] }));

/** How often Auto runs, in words. */
function listOf(items: string[]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function cadence(minutes: number) {
  if (minutes >= 60 * 24) return "Kept up to date once a day";
  if (minutes >= 120) return `Kept up to date every ${Math.round(minutes / 60)} hours`;
  if (minutes >= 60) return "Kept up to date every hour";
  return `Kept up to date every ${minutes} minutes`;
}

export function SyncSection({
  now,
  preferences,
  status,
  syncingKind,
  onSync,
  onNotice,
}: {
  now: number;
  preferences: SchoolPreferences | undefined;
  status: SchoolSyncStatus | undefined;
  syncingKind: SchoolSyncKind | "all" | null;
  onSync: (kind?: SchoolSyncKind) => void;
  onNotice: (message: string) => void;
}) {
  const setMode = useMutation(api.school.setMode);
  if (preferences === undefined || status === undefined) return <LoadingRows label="Loading sync" count={8} />;

  async function choose(kind: SchoolSyncKind, mode: SchoolSyncMode, card: HTMLElement | null) {
    try {
      await setMode({ kind, mode });
      if (mode === "off") onNotice(`${SCHOOL_SYNC_KIND_INFO[kind].label} is off. What was synced is removed.`);
      else sendInto(card);
    } catch (error) {
      onNotice(sentenceOf(error, "That didn't save. Try again."));
    }
  }

  // Kinds Spectra can sync but this school's ManageBac refused on trying: they
  // leave the list, and say why here rather than vanishing without a word.
  const refused = preferences.kinds.filter((kind) => !kind.available && kind.choice !== false && SCHOOL_SYNC_KIND_INFO[kind.kind].availability === "available");

  return (
    <section aria-label="Sync" className="min-w-0">
      <p className="mb-5 max-w-2xl text-ui leading-6 text-[var(--text-secondary)]">
        Choose what comes in from ManageBac. {MODE_LABEL.auto} keeps it up to date in the background, {MODE_LABEL.manual} brings it in only when you press Sync now, and{" "}
        {MODE_LABEL.off} never brings it in and removes what was.
      </p>
      <ul className="school-kinds">
        {preferences.kinds.filter((kind) => kind.available && kind.choice !== false).map((kind) => {
          const info = SCHOOL_SYNC_KIND_INFO[kind.kind];
          const state = status.kinds.find((entry) => entry.kind === kind.kind);
          const problem = state?.problem && (state.state === "failed" || state.state === "blocked") ? state.problem : null;
          const running = syncingKind === kind.kind || syncingKind === "all" || state?.state === "running" || state?.state === "queued";
          const id = `school-sync-${kind.kind}`;
          return (
            <li
              key={kind.kind}
              id={id}
              data-life-receive
              data-mode={kind.mode}
              data-running={running || undefined}
              data-problem={problem ? true : undefined}
              aria-labelledby={`${id}-name`}
              className="school-kind"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h3 id={`${id}-name`} className="school-kind-name">
                    {kind.label}
                  </h3>
                  <p className="school-kind-about">{info.description}</p>
                </div>
                <span aria-hidden className="school-kind-light mt-2" />
              </div>
              <p className="school-kind-state">
                {problem ? (
                  <span className="text-[var(--danger)]">
                    {problem.message} {problem.fixHint}
                  </span>
                ) : (
                  <span>
                    {state ? kindLine(state, now) : MODE_HINT[kind.mode]}
                    {kind.mode === "auto" && !running && !state?.nextRunAt ? `. ${cadence(info.autoEveryMinutes)}.` : null}
                  </span>
                )}
              </p>
              <div className="school-kind-foot">
                <Segmented
                  size="compact"
                  label={`${kind.label} sync`}
                  value={kind.mode}
                  onChange={(mode) => void choose(kind.kind, mode, document.getElementById(id))}
                  options={MODE_OPTIONS}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  disabled={kind.mode === "off" || running || !preferences.connected}
                  onClick={() => onSync(kind.kind)}
                >
                  {running ? "Syncing" : "Sync now"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {refused.length > 0 ? (
        <p className="mt-3 max-w-2xl text-caption leading-5 text-[var(--text-tertiary)]">
          Your school&apos;s ManageBac doesn&apos;t share {listOf(refused.map((kind) => kind.label.toLowerCase()))} with Spectra, so{" "}
          {refused.length === 1 ? "it isn't" : "they aren't"} synced. If your school grants it, it comes back here.
        </p>
      ) : null}
      <ClassChoice onNotice={onNotice} />
    </section>
  );
}
