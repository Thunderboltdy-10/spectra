"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Row } from "@/components/ui/row";
import { SelectField } from "@/components/ui/select";
import { NATIVE_WRITES_OPTIONS, timeAgo, type DeviceTone, type DeviceView, type FolderView, type NativeWrites } from "./devices-model";
import type { LocalDeviceRequest } from "./actions";

export const TONE_GLYPH: Record<DeviceTone, IconName> = {
  ok: "done",
  busy: "syncing",
  paused: "pause",
  attention: "problem",
  offline: "offline",
};

/*
 * Details for one computer: its folders, the Office files open there, when
 * Spectra may write back, its health, updates, and removing it. Actions on a
 * folder run on this computer only; for another computer the panel says so.
 */
export function DeviceDetails({
  device,
  now,
  busy,
  nativeWrites,
  nativeWritesDisabled,
  onAction,
  onNativeWrites,
  onRemove,
  onClose,
}: {
  device: DeviceView;
  now: number;
  busy: string | null;
  nativeWrites: NativeWrites;
  nativeWritesDisabled: boolean;
  onAction: (request: LocalDeviceRequest) => void;
  onNativeWrites: (choice: NativeWrites) => void;
  onRemove: () => void;
  /** Only where Details is not its own panel. */
  onClose?: () => void;
}) {
  const local = device.isThisComputer && device.live;
  return (
    <div data-devices-details className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-ui font-semibold text-[var(--text-primary)]">{device.name}</h2>
        {onClose ? <IconButton icon="close" label="Hide details" size="compact" onClick={onClose} /> : null}
      </div>

      <Section title="Folders">
        {device.folders.length ? (
          <div className="-mx-2.5">
            {device.folders.map((folder) => (
              <FolderRow key={folder.id} folder={folder} local={local} busy={busy} onAction={onAction} />
            ))}
          </div>
        ) : (
          <Quiet>No folders yet.</Quiet>
        )}
        {local ? (
          <Button variant="secondary" size="sm" disabled={busy === "add_folder"} onClick={() => onAction({ action: "add_folder" })}>
            <Icon name="add" size={16} />
            Add folder
          </Button>
        ) : device.isThisComputer ? (
          <Quiet>Connect this computer to change its folders.</Quiet>
        ) : (
          <Quiet>Change these folders in Spectra on that computer.</Quiet>
        )}
      </Section>

      {device.officeFiles.length ? (
        <Section title="Office">
          <ul className="space-y-1">
            {device.officeFiles.map((file) => (
              <li key={`${file.folder}/${file.name}`} className="flex items-center gap-2 text-caption text-[var(--text-secondary)]">
                <Icon name="document" size={14} />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="shrink-0 truncate text-micro text-[var(--text-tertiary)]">{file.folder}</span>
              </li>
            ))}
          </ul>
          <Quiet>Open in Office now. Spectra syncs them when you save.</Quiet>
        </Section>
      ) : null}

      <Section title="Native writes" description="When Spectra may write back to desktop files. Applies to every device.">
        <SelectField
          ariaLabel="Native writes"
          value={nativeWrites}
          onChange={(value) => onNativeWrites(value as NativeWrites)}
          options={NATIVE_WRITES_OPTIONS.map(({ value, label }) => ({ value, label }))}
          disabled={nativeWritesDisabled}
          triggerClassName="min-w-[10rem]"
        />
        <Quiet>{NATIVE_WRITES_OPTIONS.find((option) => option.value === nativeWrites)?.description}</Quiet>
      </Section>

      <Section title="Health">
        <p className="flex items-center gap-2 text-caption text-[var(--text-primary)]">
          <Icon name={TONE_GLYPH[device.tone]} size={14} />
          {device.label}
        </p>
        <Quiet>{device.problem ?? device.detail}</Quiet>
        {device.lastSyncAt ? <Quiet>Last sync {timeAgo(device.lastSyncAt, now)}.</Quiet> : null}
        {local ? (
          <Button variant="ghost" size="sm" disabled={busy === "show_logs"} onClick={() => onAction({ action: "show_logs" })}>
            Show logs
          </Button>
        ) : null}
      </Section>

      <Section title="Updates">
        <Quiet>
          {device.version ? `Spectra Bridge ${device.version}.` : "Version not reported yet."}
          {device.updateRequired ? " This version is out of date." : ""}
        </Quiet>
        {device.isThisComputer && (local || device.updateRequired) ? (
          <Button variant={device.updateRequired ? "primary" : "secondary"} size="sm" disabled={busy === "update"} onClick={() => onAction({ action: "update" })}>
            Update Bridge
          </Button>
        ) : null}
      </Section>

      {device.id ? (
        <Section title={device.isThisComputer ? "Remove this device" : "Remove device"}>
          <Quiet>It stops syncing. Its files stay on the computer.</Quiet>
          <Button variant="destructive" size="sm" onClick={onRemove}>
            <Icon name="trash" size={16} />
            {device.isThisComputer ? "Remove this device" : `Remove ${device.name}`}
          </Button>
        </Section>
      ) : null}
    </div>
  );
}

function FolderRow({
  folder,
  local,
  busy,
  onAction,
}: {
  folder: FolderView;
  local: boolean;
  busy: string | null;
  onAction: (request: LocalDeviceRequest) => void;
}) {
  const act = local && folder.actionable;
  const progress = folder.progress && folder.progress.synced < folder.progress.total ? ` · ${folder.progress.synced} of ${folder.progress.total} files` : "";
  const working = busy?.endsWith(`:${folder.id}`) ?? false;
  return (
    <Row
      glyph="folder"
      lifeKey={`device-folder:${folder.id}`}
      title={folder.path}
      meta={`${folder.label}${progress}${folder.detail ? ` · ${folder.detail}` : ""}`}
      actionsVisible={working}
      actions={
        act ? (
          <>
            {folder.tone === "attention" ? (
              <IconButton icon="syncing" label={`Retry ${folder.name}`} size="compact" disabled={working} onClick={() => onAction({ action: "retry_folder", grantId: folder.id })} />
            ) : null}
            <IconButton
              icon={folder.paused ? "play" : "pause"}
              label={folder.paused ? `Resume ${folder.name}` : `Pause ${folder.name}`}
              size="compact"
              pressed={folder.paused}
              disabled={working}
              onClick={() => onAction({ action: folder.paused ? "resume_folder" : "pause_folder", grantId: folder.id })}
            />
            <IconButton icon="trash" label={`Remove ${folder.name}`} size="compact" disabled={working} onClick={() => onAction({ action: "remove_folder", grantId: folder.id })} />
          </>
        ) : undefined
      }
    />
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-micro font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{title}</h3>
      {description ? <p className="text-caption text-[var(--text-secondary)]">{description}</p> : null}
      {children}
    </section>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-caption text-[var(--text-tertiary)]">{children}</p>;
}
