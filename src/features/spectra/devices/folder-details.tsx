"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { Switch } from "@/components/ui/switch";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { FolderView } from "./devices-model";

/*
 * One synced folder up close: where it is, and whether files added to it
 * later come into Spectra by themselves. The rule is the account's until it is
 * changed here; a folder can go back to following it. Read only while open,
 * so a closed card costs nothing.
 */
export function FolderDetails({ folder, computer }: { folder: FolderView; computer: string }) {
  const mountId = folder.mountId as Id<"bridgeMounts"> | undefined;
  const policy = useQuery(api.syncPolicy.effective, mountId ? { mountId } : "skip");
  const setNewFiles = useMutation(api.syncPolicy.setFolderNewFiles);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const isFile = folder.kind === "file";
  const own = policy?.source?.kind === "mount";
  // With no choice made anywhere, new files come in by themselves.
  const on = policy ? policy.source?.kind === "default" || policy.discovery === "auto" : true;

  const run = async (action: () => Promise<unknown>) => {
    setSaving(true);
    setFailed(false);
    try {
      await action();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  const key = () => `folder-new-files:${mountId}:${crypto.randomUUID()}`;

  return (
    <div className="device-folder-details">
      <dl className="device-folder-facts">
        <div>
          <dt>On {computer}</dt>
          <dd title={folder.path}>{folder.path}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>
            {folder.label}
            {folder.detail ? `, ${folder.detail}` : ""}
          </dd>
        </div>
      </dl>
      {!isFile && mountId ? (
        <div className="device-folder-rule">
          <div className="min-w-0">
            <p className="device-folder-rule-title">New files sync by themselves</p>
            <p className="device-folder-rule-about">
              {on
                ? "A file added to this folder comes into Spectra on its own."
                : "New files here wait until you pick them with Add files."}
              {own ? " Set for this folder only." : " Follows your choice for all folders."}
            </p>
            {own ? (
              <button
                type="button"
                className="device-folder-twin-action"
                disabled={saving}
                onClick={() => void run(() => setNewFiles({ mountId, newFiles: "follow", idempotencyKey: key() }))}
              >
                Follow my choice for all folders
              </button>
            ) : null}
            {failed ? <p className="device-folder-rule-about" role="alert">That didn&apos;t save. Try again.</p> : null}
          </div>
          <Switch
            aria-label={`New files in ${folder.name} sync by themselves`}
            checked={on}
            disabled={!policy || saving}
            onCheckedChange={(next) => {
              void run(() => setNewFiles({ mountId, newFiles: next ? "on" : "off", idempotencyKey: key() }));
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
