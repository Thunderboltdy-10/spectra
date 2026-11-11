"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/features/spectra/data/use-session";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSpectraPreferences } from "../settings/preference-store";
import { bridgeDownloadUrl, bridgePlatform } from "../bridge/client";
import { WorkHomeChoice } from "../devices/work-home-choice";
import type { TourAsk } from "./tour-steps";

/*
 * The choices the tour asks for while it is on the page they belong to: when
 * the brief and the reminders arrive, whether to get Bridge on this computer,
 * and where work is kept. All can be changed later (Settings, Devices).
 */

function TimeChoice({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-caption text-[var(--text-secondary)]">
      <span>{label}</span>
      <Input
        type="time"
        aria-label={label}
        className="h-8 w-[112px]"
        value={value}
        onChange={(event) => event.target.value && onChange(event.target.value)}
      />
    </label>
  );
}

function ReminderTimes() {
  const { preferences, update } = useSpectraPreferences();
  const { dailyBrief, dailyBriefTime, reminderTime } = preferences.notifications;
  return (
    <div className="grid gap-2">
      {dailyBrief ? (
        <TimeChoice label="Morning brief ready by" value={dailyBriefTime} onChange={(value) => update("notifications", { dailyBriefTime: value })} />
      ) : null}
      <TimeChoice label="Remind me of the day's work at" value={reminderTime} onChange={(value) => update("notifications", { reminderTime: value })} />
    </div>
  );
}

function BridgeChoice() {
  const connected = useSession()?.hasDevice;
  // Read after mount: the server cannot tell which computer this is.
  const [download, setDownload] = useState<string | null>(null);
  useEffect(() => setDownload(bridgeDownloadUrl(bridgePlatform())), []);
  if (connected === undefined) return null;
  if (connected)
    return <p className="text-caption text-[var(--text-secondary)]">Bridge is already set up on one of your computers.</p>;
  if (!download)
    return <p className="text-caption text-[var(--text-secondary)]">Bridge runs on Windows and macOS. Open Devices there to set it up.</p>;
  return (
    <div className="flex items-center gap-3">
      <Button asChild size="sm" variant="secondary">
        <a href={download}>Download Bridge</a>
      </Button>
      <span className="text-micro text-[var(--text-tertiary)]">Or later, from Devices.</span>
    </div>
  );
}

export function TourAskControl({ ask }: { ask: TourAsk }) {
  if (ask === "storage") return <WorkHomeChoice compact />;
  return ask === "reminders" ? <ReminderTimes /> : <BridgeChoice />;
}
