"use client";

import { useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { toast } from "@/components/ui/toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { treeFailureMessage, useTreeActions, useTreeContainers } from "../organization/tree-client";
import { useLifeArrival, useLifeDeparture, useLifeJoin } from "../life/use-life";
import type { LocalDeviceRequest } from "./actions";
import { timeAgo, type DeviceTone, type DeviceView, type FolderView } from "./devices-model";

export const TONE_GLYPH: Record<DeviceTone, IconName> = {
  ok: "done",
  busy: "syncing",
  paused: "pause",
  attention: "problem",
  offline: "offline",
};

/** The folders on a computer take the desk's inks in turn, so each reads as its own. */
const FOLDER_INKS = ["--ink-blue", "--ink-green", "--ink-orange", "--ink-violet", "--ink-red", "--ink-yellow"];
const DEVICE_FIGURE = { bars: "[data-device-name], [data-device-meta]" };

/*
 * One computer, whole (DEVICES.md): its name and whether it is connected, the
 * folders it keeps in sync as folders on the page, the Office files open
 * there, and at its foot its health, its Bridge and removing it. Folder
 * actions run on this computer only; for another computer the card says so.
 */
export function DeviceCard({
  device,
  now,
  busy,
  fresh,
  lifeKey,
  onAction,
  onRemove,
  downloadUrl,
}: {
  device: DeviceView;
  now: number;
  busy: string | null;
  /** Paired just now: the card forms where the pairing code was. */
  fresh: boolean;
  lifeKey: string;
  onAction: (request: LocalDeviceRequest) => void;
  onRemove: () => void;
  /** Where to get Bridge, offered while this computer's Bridge is not running. */
  downloadUrl?: string | null;
}) {
  const ref = useRef<HTMLElement>(null);
  useLifeArrival(ref, lifeKey, fresh ? "human" : undefined, DEVICE_FIGURE);
  useLifeJoin(ref, lifeKey);
  useLifeDeparture(ref, true, DEVICE_FIGURE, lifeKey);
  const local = device.isThisComputer && device.live;
  const facts = [
    device.platformLabel,
    device.version ? `Spectra Bridge ${device.version}` : null,
    device.lastSyncAt ? `synced ${timeAgo(device.lastSyncAt, now)}` : null,
  ].filter(Boolean);

  return (
    <article
      ref={ref}
      data-device-row={device.isThisComputer ? "this" : "other"}
      data-tone={device.tone}
      aria-labelledby={`device-${lifeKey}`}
      className="device-card"
    >
      <header className="device-card-head">
        <span aria-hidden className="device-card-light" />
        <div className="min-w-0 flex-1">
          <h3 id={`device-${lifeKey}`} data-device-name className="device-card-name">
            {device.name}
          </h3>
          <p data-device-meta className="device-card-meta">
            <span className="font-medium text-[var(--text-primary)]">{device.label}.</span> {device.problem ?? device.detail}
          </p>
        </div>
        {device.isThisComputer ? <span className="device-card-here">This computer</span> : null}
      </header>

      <section aria-label={`Files and folders on ${device.name}`}>
        <ul className="device-folders">
          {device.folders.map((folder, index) => (
            <FolderTile key={folder.id} folder={folder} ink={FOLDER_INKS[index % FOLDER_INKS.length]} local={local} busy={busy} onAction={onAction} />
          ))}
          {local ? (
            <li>
              <button type="button" className="device-folder-add" disabled={busy === "add_folder" || busy === "add_files"} onClick={() => onAction({ action: "add_folder" })}>
                <Icon name="add" size={16} />
                Add a folder
              </button>
            </li>
          ) : null}
          {local ? (
            <li>
              <button type="button" className="device-folder-add" disabled={busy === "add_folder" || busy === "add_files"} onClick={() => onAction({ action: "add_files" })}>
                <Icon name="document" size={16} />
                Add files
              </button>
            </li>
          ) : null}
        </ul>
        {!device.folders.length && !local ? <p className="device-card-quiet">No files or folders yet.</p> : null}
        {!local ? (
          <p className="device-card-quiet">
            {device.isThisComputer ? "Connect this computer to change what syncs." : "Change what syncs in Spectra on that computer."}
          </p>
        ) : null}
      </section>

      {device.officeFiles.length ? (
        <section aria-label="Open in Office" className="mt-5">
          <h4 className="device-card-subhead">Open in Office now</h4>
          <ul className="space-y-1">
            {device.officeFiles.map((file) => (
              <li key={`${file.folder}/${file.name}`} className="flex items-center gap-2 text-caption text-[var(--text-secondary)]">
                <Icon name="document" size={14} />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="shrink-0 truncate text-micro text-[var(--text-tertiary)]">{file.folder}</span>
              </li>
            ))}
          </ul>
          <p className="device-card-quiet">Spectra syncs them when you save.</p>
        </section>
      ) : null}

      <footer className="device-card-foot">
        <span className="min-w-0 flex-1 truncate">
          {facts.join(", ")}
          {device.updateRequired ? ". This Bridge is out of date." : "."}
        </span>
        {local ? (
          <Button variant="ghost" size="sm" disabled={busy === "show_logs"} onClick={() => onAction({ action: "show_logs" })}>
            Show logs
          </Button>
        ) : null}
        {device.isThisComputer && (local || device.updateRequired) ? (
          <Button variant={device.updateRequired ? "primary" : "ghost"} size="sm" disabled={busy === "update"} onClick={() => onAction({ action: "update" })}>
            Update Bridge
          </Button>
        ) : null}
        {device.isThisComputer && !local && !device.updateRequired && downloadUrl ? (
          <Button asChild variant="ghost" size="sm">
            <a href={downloadUrl} rel="noopener">
              <Icon name="download" size={16} />
              Download Bridge
            </a>
          </Button>
        ) : null}
        {device.id ? (
          <Button variant="ghost" size="sm" className="text-[var(--danger)]" onClick={onRemove}>
            {device.isThisComputer ? "Remove this device" : `Remove ${device.name}`}
          </Button>
        ) : null}
      </footer>
    </article>
  );
}

/** One folder can stand in several workspaces; it still syncs once. */
function AddToWorkspaces({ nodeId, name }: { nodeId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const { nodes, status } = useTreeContainers(null, open);
  const { createReference } = useTreeActions();
  const workspaces = nodes.filter((node) => node.kind === "workspace" && node.nodeId !== nodeId);
  const add = async (workspaceNodeId: string, title: string) => {
    try {
      await createReference(nodeId, workspaceNodeId);
      setAdded((current) => new Set(current).add(workspaceNodeId));
      toast.success(`${name} is in ${title}.`);
    } catch (error) {
      toast.error(treeFailureMessage(error, `Couldn't add ${name} to ${title}.`));
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton icon="workspace" label={`Add ${name} to a workspace`} size="compact" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        {workspaces.length === 0 ? (
          <p className="px-2 py-1.5 text-caption text-[var(--text-secondary)]">
            {status === "LoadingFirstPage" ? "Loading workspaces" : "No workspaces yet."}
          </p>
        ) : (
          workspaces.map((workspace) => {
            const done = added.has(workspace.nodeId);
            return (
              <button
                key={workspace.nodeId}
                type="button"
                disabled={done}
                onClick={() => void add(workspace.nodeId, workspace.name)}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left text-ui text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-default"
              >
                <span className="min-w-0 truncate">{workspace.name}</span>
                {done ? <Icon name="done" size={14} /> : null}
              </button>
            );
          })
        )}
      </PopoverContent>
    </Popover>
  );
}

function FolderTile({
  folder,
  ink,
  local,
  busy,
  onAction,
}: {
  folder: FolderView;
  ink: string;
  local: boolean;
  busy: string | null;
  onAction: (request: LocalDeviceRequest) => void;
}) {
  const act = local && folder.actionable;
  const working = busy?.endsWith(`:${folder.id}`) ?? false;
  const progress = folder.progress && folder.progress.synced < folder.progress.total ? folder.progress : null;
  const where = folder.path === folder.name ? null : folder.path.slice(0, folder.path.length - folder.name.length).replace(/\s*›\s*$/, "");
  return (
    <li className="device-folder" data-tone={folder.tone} data-paused={folder.paused || undefined} style={{ "--folder-ink": `var(${ink})` } as CSSProperties}>
      <span aria-hidden className="device-folder-tab" />
      <span className="device-folder-name" title={folder.path}>
        {folder.kind === "file" ? <Icon name="document" size={14} className="mr-1 inline-block" /> : null}
        {folder.name}
      </span>
      {where ? <span className="device-folder-where">in {where}</span> : null}
      <span className="device-folder-state">
        <Icon name={TONE_GLYPH[folder.tone]} size={13} />
        <span className="min-w-0 truncate">
          {folder.label}
          {folder.detail ? `, ${folder.detail}` : ""}
        </span>
      </span>
      {progress ? (
        <span className="device-folder-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.synced} aria-label={`${progress.synced} of ${progress.total} files`}>
          <span style={{ width: `${(progress.synced / Math.max(1, progress.total)) * 100}%` }} />
        </span>
      ) : null}
      {act || folder.rootNodeId ? (
        <span className="device-folder-actions" data-visible={working || undefined}>
          {folder.rootNodeId ? <AddToWorkspaces nodeId={folder.rootNodeId} name={folder.name} /> : null}
          {act && folder.tone === "attention" ? (
            <IconButton icon="syncing" label={`Retry ${folder.name}`} size="compact" disabled={working} onClick={() => onAction({ action: "retry_folder", grantId: folder.id })} />
          ) : null}
          {act ? (
            <>
              <IconButton
                icon={folder.paused ? "play" : "pause"}
                label={folder.paused ? `Resume ${folder.name}` : `Pause ${folder.name}`}
                size="compact"
                pressed={folder.paused}
                disabled={working}
                onClick={() => onAction({ action: folder.paused ? "resume_folder" : "pause_folder", grantId: folder.id })}
              />
              <IconButton icon="trash" label={`Stop syncing ${folder.name}`} size="compact" disabled={working} onClick={() => onAction({ action: "remove_folder", grantId: folder.id })} />
            </>
          ) : null}
        </span>
      ) : null}
    </li>
  );
}
