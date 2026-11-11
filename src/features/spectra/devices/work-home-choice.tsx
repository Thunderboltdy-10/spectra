"use client";

import Link from "next/link";
import { useState } from "react";
import { useConvex, useConvexAuth, useMutation } from "convex/react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SelectField } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { usePathname } from "next/navigation";
import { bridgeUnavailableHere, bridgeUnavailableReason, useBridgeAvailability } from "../bridge/availability";
import { DEVICES_HREF } from "../bridge/client";
import { backUpNow, restoreBackups } from "../bridge/device-backup";
import { deviceStoreSummary, moveWorkToCloud, moveWorkToDevice, useDeviceState, type WorkStorage } from "../bridge/device-works";
import { getSpectraArtifact } from "../data/api";
import { accountStorageMatches, accountStorageRevision } from "@/lib/account-storage-scope";

/*
 * Where someone's work lives, told as what it means for them: what happens
 * offline, on another computer, and if this one is lost. The pictures carry
 * most of it; the rest is three short lines per choice.
 */

type Impact = { good: boolean; text: string };

const CHOICES: ReadonlyArray<{ value: WorkStorage; label: string; impacts: Impact[] }> = [
  {
    value: "device_backup",
    label: "This computer, with a backup",
    impacts: [
      { good: true, text: "Opens and saves instantly, even offline" },
      { good: true, text: "A copy is saved online with Spectra once a day, so a lost computer costs a day at most" },
      { good: false, text: "Another computer needs the backup brought across" },
    ],
  },
  {
    value: "device_only",
    label: "Only this computer",
    impacts: [
      { good: true, text: "Your writing never leaves this computer on its own" },
      { good: true, text: "Opens and saves instantly, even offline" },
      { good: false, text: "If this computer is lost, so is the artifact" },
    ],
  },
  {
    value: "cloud",
    label: "Online, for every computer",
    impacts: [
      { good: true, text: "Opens on any computer you sign in on" },
      { good: true, text: "Nothing to keep running" },
      { good: false, text: "Slower, and needs a connection to save" },
    ],
  },
];

const BACKUP_TIMES = [
  { value: "6", label: "Every 6 hours" },
  { value: "24", label: "Every day" },
  { value: "72", label: "Every 3 days" },
  { value: "168", label: "Every week" },
];

function when(at: number) {
  const date = new Date(at);
  const today = new Date();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) return `today at ${time}`;
  return `${date.toLocaleDateString([], { day: "numeric", month: "short" })} at ${time}`;
}

/** Where the work sits, what travels, and how often. */
function WorkHomePicture({ value }: { value: WorkStorage }) {
  const here = value !== "cloud";
  const held = "var(--brand-primary)";
  const idle = "var(--border-strong)";
  return (
    <svg viewBox="0 0 132 52" width="132" height="52" aria-hidden className="shrink-0">
      <rect x="6" y="9" width="40" height="27" rx="4" fill={here ? `color-mix(in oklab, ${held} 16%, transparent)` : "none"} stroke={here ? held : idle} strokeWidth="1.6" />
      <path d="M1 41h50" stroke={here ? held : idle} strokeWidth="2" strokeLinecap="round" />
      {here ? (
        <g fill={held}>
          <rect x="17" y="15" width="18" height="2.4" rx="1.2" />
          <rect x="17" y="20" width="18" height="2.4" rx="1.2" opacity="0.7" />
          <rect x="17" y="25" width="12" height="2.4" rx="1.2" opacity="0.45" />
        </g>
      ) : null}
      {value === "device_only" ? (
        <path d="M58 26h20M88 18l18 18M106 18L88 36" stroke={idle} strokeWidth="1.6" strokeLinecap="round" strokeDasharray="0" opacity="0.8" />
      ) : (
        <path
          d="M52 26h28"
          stroke={held}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray={value === "device_backup" ? "2 5" : undefined}
          fill="none"
        />
      )}
      <path
        d="M92 38a9 9 0 0 1-1.5-17.9A12 12 0 0 1 113.6 22 8 8 0 0 1 113 38z"
        fill={value === "cloud" ? `color-mix(in oklab, ${held} 16%, transparent)` : "none"}
        stroke={value === "cloud" ? held : value === "device_only" ? "none" : idle}
        strokeWidth="1.6"
      />
      {value === "cloud" ? (
        <g fill={held}>
          <rect x="95" y="25" width="16" height="2.2" rx="1.1" />
          <rect x="95" y="30" width="10" height="2.2" rx="1.1" opacity="0.6" />
        </g>
      ) : null}
    </svg>
  );
}

function ChoiceCard({
  choice,
  selected,
  recommended,
  unavailable,
  onChoose,
}: {
  choice: (typeof CHOICES)[number];
  selected: boolean;
  recommended: string | null;
  unavailable: string | null;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={Boolean(unavailable)}
      title={unavailable ?? undefined}
      onClick={onChoose}
      className="work-home-card"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-ui font-medium text-[var(--text-primary)]">{choice.label}</span>
          {recommended ? <span className="work-home-recommended">{recommended}</span> : null}
        </span>
        <WorkHomePicture value={choice.value} />
      </span>
      <span className="mt-2 block space-y-1">
        {choice.impacts.map((impact) => (
          <span key={impact.text} className="work-home-impact" data-good={impact.good}>
            <span aria-hidden className="work-home-impact-mark" />
            {impact.text}
          </span>
        ))}
      </span>
    </button>
  );
}

/** Moves whatever is on the other side, a work at a time, so it can stop anywhere safely. */
function MoveWorks({ storage }: { storage: WorkStorage }) {
  const convex = useConvex();
  const { storeId } = useDeviceState();
  const counts = useQuery(api.deviceWorks.counts, storeId ? { storeId } : "skip");
  const [moving, setMoving] = useState<{ done: number; total: number } | null>(null);
  if (!storeId || !counts) return null;
  const toCloud = storage === "cloud";
  const total = toCloud ? counts.here : counts.cloud;
  if (!total && !moving) return null;
  const move = async () => {
    const revision = accountStorageRevision();
    if (!accountStorageMatches(revision)) return;
    setMoving({ done: 0, total });
    let done = 0;
    let failed = 0;
    try {
      for (;;) {
        const ids = toCloud
          ? await convex.query(api.deviceWorks.onThisComputer, { storeId, limit: 20 })
          : await convex.query(api.deviceWorks.movable, { limit: 20 });
        if (!accountStorageMatches(revision)) return;
        const left = ids.slice(failed);
        if (!left.length) break;
        for (const id of left) {
          try {
            if (toCloud) await moveWorkToCloud(id);
            else {
              const work = await getSpectraArtifact(id);
              if (!accountStorageMatches(revision)) return;
              await moveWorkToDevice(work.artifact, storeId);
            }
            if (!accountStorageMatches(revision)) return;
            done += 1;
          } catch {
            if (!accountStorageMatches(revision)) return;
            failed += 1;
          }
          setMoving({ done: done + failed, total: Math.max(total, done + failed) });
        }
      }
      if (failed) toast.warning(`${failed === 1 ? "One artifact" : `${failed} works`} stayed where they were, usually because they're shared.`);
      else toast.success(toCloud ? "Your artifact is online now." : "Your artifact is on this computer now.");
    } finally {
      if (accountStorageMatches(revision)) setMoving(null);
    }
  };
  return (
    <div className="work-home-footer">
      <span className="min-w-0 text-caption text-[var(--text-secondary)]">
        {moving
          ? `Moving ${moving.done} of ${moving.total}…`
          : toCloud
            ? `${total === 1 ? "One artifact is" : `${total} artifacts are`} on this computer.`
            : `${total === 1 ? "One artifact is" : `${total} artifacts are`} still online.`}
      </span>
      <Button size="sm" variant="secondary" disabled={Boolean(moving)} onClick={() => void move()}>
        {toCloud ? "Move them online" : "Move them here"}
      </Button>
    </div>
  );
}

function BackupControls({ settings }: { settings: { backupEveryHours: number; lastBackupAt: number | null; lastFullBackupAt: number | null; storage: string | null } }) {
  const choose = useMutation(api.deviceWorks.choose);
  const uploadUrl = useMutation(api.deviceWorks.backupUploadUrl);
  const record = useMutation(api.deviceWorks.recordBackup);
  const [busy, setBusy] = useState(false);
  const backup = async () => {
    const revision = accountStorageRevision();
    if (!accountStorageMatches(revision)) return;
    setBusy(true);
    try {
      const result = await backUpNow(
        settings,
        {
          uploadUrl: () => uploadUrl({}),
          record: (input) => record({ ...input, storageId: input.storageId as Id<"_storage"> }),
        },
        { force: true },
      );
      if (!accountStorageMatches(revision)) return;
      if (result.state === "saved") toast.success("Backed up.");
      else if (result.state === "empty") toast.info("There's nothing on this computer to back up yet.");
      else toast.info("Nothing has changed since the last backup.");
    } catch (error) {
      if (!accountStorageMatches(revision)) return;
      toast.error(error instanceof Error ? error.message : "The backup didn't finish. It will try again later.");
    } finally {
      if (accountStorageMatches(revision)) setBusy(false);
    }
  };
  return (
    <div className="work-home-footer">
      <span className="min-w-0 text-caption text-[var(--text-secondary)]">
        {settings.lastBackupAt ? `Last backed up ${when(settings.lastBackupAt)}.` : "Not backed up yet."}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <SelectField
          ariaLabel="How often to back up"
          value={String(settings.backupEveryHours)}
          options={BACKUP_TIMES}
          onChange={(value: string) => void choose({ storage: "device_backup", backupEveryHours: Number(value) })}
        />
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void backup()}>
          Back up now
        </Button>
      </span>
    </div>
  );
}

type BackupChain = {
  storeId: string;
  computerName: string | null;
  at: number;
  backups: Array<{ url: string | null }>;
};

function copyAge(at: number) {
  return new Date(at).toLocaleString(undefined, { weekday: "long", hour: "2-digit", minute: "2-digit" });
}

/** A new or emptied computer can take the backed-up work back, from the computer it names. */
function BringBackBackup() {
  const { storeId } = useDeviceState();
  const convex = useConvex();
  const adopt = useMutation(api.deviceWorks.adoptRestored);
  const counts = useQuery(api.deviceWorks.counts, storeId ? { storeId } : "skip");
  const [busy, setBusy] = useState(false);
  const [offer, setOffer] = useState<BackupChain | null>(null);
  if (!storeId || !counts?.elsewhere) return null;
  const choose = async () => {
    const revision = accountStorageRevision();
    if (!accountStorageMatches(revision)) return;
    setBusy(true);
    try {
      const chains = await convex.query(api.deviceWorks.backupsToRestore, { storeId });
      if (!accountStorageMatches(revision)) return;
      // The computer backed up most recently is the one most likely meant.
      const newest = [...chains].sort((left, right) => right.at - left.at)[0];
      if (!newest) {
        toast.info("There's no backup to bring back. Open Spectra on the computer that holds this artifact.");
        return;
      }
      setOffer(newest);
    } catch (error) {
      if (!accountStorageMatches(revision)) return;
      toast.error(error instanceof Error ? error.message : "The backup couldn't be found.");
    } finally {
      if (accountStorageMatches(revision)) setBusy(false);
    }
  };
  const bring = async (chain: BackupChain) => {
    const revision = accountStorageRevision();
    if (!accountStorageMatches(revision)) return;
    setOffer(null);
    setBusy(true);
    try {
      const restored = await restoreBackups(chain.backups);
      if (!accountStorageMatches(revision)) return;
      await deviceStoreSummary();
      if (!accountStorageMatches(revision)) return;
      let adopted = 0;
      for (let at = 0; at < restored.length; at += 200)
        adopted += (await adopt({ storeId, artifactIds: restored.slice(at, at + 200) })).adopted;
      if (!accountStorageMatches(revision)) return;
      toast.success(`${adopted === 1 ? "One artifact is" : `${adopted} artifacts are`} on this computer now.`);
    } catch (error) {
      if (!accountStorageMatches(revision)) return;
      toast.error(error instanceof Error ? error.message : "The backup couldn't be brought back.");
    } finally {
      if (accountStorageMatches(revision)) setBusy(false);
    }
  };
  const source = offer?.computerName || "your other computer";
  return (
    <div className="work-home-footer">
      <span className="min-w-0 text-caption text-[var(--text-secondary)]">
        {counts.elsewhere === 1 ? "One artifact is" : `${counts.elsewhere} artifacts are`} on another computer.
      </span>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void choose()}>
        Bring it here
      </Button>
      <ConfirmDialog
        open={Boolean(offer)}
        pending={busy}
        title={offer?.computerName ? `Bring the backup from ${offer.computerName}?` : "Bring the backup here?"}
        detail={
          offer
            ? `This copy is from ${copyAge(offer.at)}. Anything written on ${source} after that is merged in when that computer next opens Spectra.`
            : ""
        }
        confirmLabel="Bring it here"
        onCancel={() => setOffer(null)}
        onConfirm={() => {
          if (offer) void bring(offer);
        }}
      />
    </div>
  );
}

export function WorkHomeChoice({ compact = false }: { compact?: boolean }) {
  const { isAuthenticated } = useConvexAuth();
  const { storeId } = useDeviceState();
  const settings = useQuery(api.deviceWorks.settings, isAuthenticated ? (storeId ? { storeId } : {}) : "skip");
  const overview = useQuery(api.bridge.overview, isAuthenticated ? {} : "skip") as { devices?: unknown[] } | null | undefined;
  const availability = useBridgeAvailability();
  const choose = useMutation(api.deviceWorks.choose);
  const deleteBackups = useMutation(api.deviceWorks.deleteBackups);
  const [confirmOnly, setConfirmOnly] = useState(false);
  const onDevices = usePathname()?.startsWith(DEVICES_HREF) ?? false;
  const unavailable = onDevices ? bridgeUnavailableHere(availability) : bridgeUnavailableReason(availability);
  const several = (overview?.devices?.length ?? 0) > 1;
  const value: WorkStorage = (settings?.storage as WorkStorage | null) ?? (unavailable ? "cloud" : "device_backup");
  const pick = (next: WorkStorage) => {
    if (next === value && settings?.storage) return;
    if (next === "device_only" && settings?.lastBackupAt) return setConfirmOnly(true);
    void choose({ storage: next });
  };
  return (
    <section aria-labelledby="work-home" className={compact ? undefined : "device-slip"} data-work-home>
      {compact ? null : (
        <>
          <h2 id="work-home" className="device-slip-heading">
            Where your artifacts are kept
          </h2>
          <p className="device-slip-about">It looks and works the same either way. You can change this whenever you like.</p>
        </>
      )}
      <div role="radiogroup" aria-label="Where your artifacts are kept" className={compact ? "space-y-2" : "mt-4 space-y-2"}>
        {CHOICES.map((choice) => (
          <ChoiceCard
            key={choice.value}
            choice={choice}
            selected={value === choice.value}
            recommended={
              choice.value === "device_backup" && !several
                ? "Best if you mostly use one computer"
                : choice.value === "cloud" && several
                  ? "Best if you use several computers"
                  : null
            }
            unavailable={choice.value === "cloud" ? null : unavailable}
            onChoose={() => pick(choice.value)}
          />
        ))}
      </div>
      {unavailable && !compact ? (
        <p className="mt-3 text-caption leading-5 text-[var(--text-secondary)]">
          {unavailable}
          {onDevices ? null : (
            <>
              {" "}
              <Link href={DEVICES_HREF} className="underline underline-offset-2">
                Open Devices
              </Link>
            </>
          )}
        </p>
      ) : null}
      {value === "device_only" && !compact ? (
        <p className="mt-3 text-caption leading-5 text-[var(--text-secondary)]">
          An artifact&apos;s name stays in your account so your Library can list it, and anything you ask the AI about still goes to the AI.
        </p>
      ) : null}
      {compact ? null : (
        <>
          {value === "device_backup" && settings && !unavailable ? <BackupControls settings={settings} /> : null}
          {!unavailable ? <MoveWorks storage={value} /> : null}
          {!unavailable ? <BringBackBackup /> : null}
        </>
      )}
      <ConfirmDialog
        open={confirmOnly}
        pending={false}
        destructive
        title="Delete your online backups?"
        detail="Keeping artifacts only on this computer removes the backups already saved online. If this computer is lost after that, those artifacts are gone."
        confirmLabel="Delete backups"
        onCancel={() => setConfirmOnly(false)}
        onConfirm={() => {
          setConfirmOnly(false);
          void choose({ storage: "device_only" }).then(() => deleteBackups({}));
        }}
      />
    </section>
  );
}
