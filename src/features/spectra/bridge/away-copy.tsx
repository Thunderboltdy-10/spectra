"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Y from "yjs";
import { useMutation } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AwayCopyContext, AwayCopyTransport, type AwayCopyScope } from "../collaboration/away-copy-transport";
import { deviceProjectionOf } from "../collaboration/device-work";
import { isArtifactTypeKey, requireArtifactTypeManifest } from "../artifacts/registry";
import { timeAgo } from "../devices/devices-model";
import { readBundleEntry, writeBundle, type BundleEntry } from "./away-copy-bundle";

/*
 * Editing a work whose computer is away (off, asleep, Bridge not running): the
 * copy in its backups opens here, and what changes goes back to the computer
 * as a hand-over it merges when it is next on with Spectra open. Yjs merges
 * both sides' edits; neither replaces the other, as with Office's co-authoring.
 */

const SEND_AFTER_MS = 30_000;
const PENDING_KEY = "spectra:away-pending:";
const BROWSER_KEY = "spectra:browser-store-id";

type Placed = { _id: string; blueprintKey: string; storageHome?: "device"; storageStoreId?: string; storageEpoch?: number };

export type AwaySend = "idle" | "waiting" | "sending" | "sent" | "failed";

export type AwayCopy =
  | { state: "off" }
  | { state: "loading" }
  | { state: "none" }
  | { state: "ready"; scope: AwayCopyScope; computerName: string | null; at: number | null; send: AwaySend };

const entries = new Map<string, Promise<BundleEntry | null>>();

function entryFrom(url: string, artifactId: string) {
  const key = `${artifactId}|${url}`;
  let found = entries.get(key);
  if (!found) {
    found = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error("A backup could not be downloaded.");
        return response.arrayBuffer();
      })
      .then((bytes) => readBundleEntry(new Uint8Array(bytes), artifactId));
    found.catch(() => entries.delete(key));
    entries.set(key, found);
  }
  return found;
}

function browserStoreId() {
  try {
    const known = window.localStorage.getItem(BROWSER_KEY);
    if (known) return known;
    const id = crypto.randomUUID();
    window.localStorage.setItem(BROWSER_KEY, id);
    return id;
  } catch {
    return "session";
  }
}

function pending(artifactId: string, value?: boolean) {
  try {
    if (value === true) window.localStorage.setItem(PENDING_KEY + artifactId, "1");
    else if (value === false) window.localStorage.removeItem(PENDING_KEY + artifactId);
    return window.localStorage.getItem(PENDING_KEY + artifactId) === "1";
  } catch {
    return false;
  }
}

type Loaded = { key: string; seeds: Uint8Array[]; storeId: string; computerName: string | null; at: number | null };

export function useAwayCopy(artifact: Placed, away: string | null): AwayCopy {
  const enabled = artifact.storageHome === "device" && Boolean(away) && away !== "checking";
  const copy = useQuery(api.deviceWorks.awayCopy, enabled ? { artifactId: artifact._id as Id<"spectraArtifacts"> } : "skip");
  const uploadUrl = useMutation(api.deviceWorks.backupUploadUrl);
  const record = useMutation(api.deviceWorks.recordBackup);
  const touch = useMutation(api.deviceWorks.touch);
  const [loaded, setLoaded] = useState<Loaded | "none" | null>(null);
  const [send, setSend] = useState<AwaySend>("idle");
  const key = `${artifact._id}:${artifact.storageEpoch ?? 0}`;
  const kept = loaded && loaded !== "none" && loaded.key === key ? loaded : null;
  const backups = copy?.backups.map((backup) => backup.url ?? "").join("|") ?? "";
  useEffect(() => {
    // Once open, the copy stays as it is: a hand-over sent from here must not reopen it.
    if (!enabled || copy === undefined || kept) return;
    if (copy === null) {
      setLoaded("none");
      return;
    }
    let live = true;
    void Promise.all(copy.backups.map((backup) => (backup.url ? entryFrom(backup.url, artifact._id).catch(() => null) : null))).then((found) => {
      if (!live) return;
      const seeds = found.flatMap((entry) => (entry?.body.length ? [entry.body] : []));
      setLoaded(seeds.length ? { key, seeds, storeId: copy.storeId, computerName: copy.computerName, at: copy.at } : "none");
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the backup list, by its urls.
  }, [artifact._id, backups, enabled, key, kept]);

  const sender = useRef<{ document: Y.Doc | null; timer: number; sending: Promise<void> | null }>({ document: null, timer: 0, sending: null });
  const sendNow = useRef<() => Promise<void>>(async () => undefined);
  sendNow.current = async () => {
    const state = sender.current;
    window.clearTimeout(state.timer);
    state.timer = 0;
    const document = state.document;
    if (!kept || !document || document.isDestroyed || !pending(artifact._id)) return;
    if (state.sending) return state.sending;
    const schemaVersion = isArtifactTypeKey(artifact.blueprintKey) ? requireArtifactTypeManifest(artifact.blueprintKey).schemas.currentVersion : 1;
    state.sending = (async () => {
      setSend("sending");
      try {
        const projection = deviceProjectionOf(document, schemaVersion);
        if (!projection) throw new Error("The copy isn't readable yet.");
        const bundle = await writeBundle({ artifactId: artifact._id, ...projection, updatedAt: Date.now() }, Y.encodeStateAsUpdate(document));
        const url = await uploadUrl({});
        const upload = await fetch(url, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bundle as BodyInit });
        if (!upload.ok) throw new Error(`The changes could not be uploaded (${upload.status}).`);
        const { storageId } = (await upload.json()) as { storageId: string };
        await record({
          storeId: `web:${browserStoreId()}:${artifact._id}`,
          storageId: storageId as Id<"_storage">,
          bytes: bundle.byteLength,
          works: 1,
          full: false,
          handOverTo: [kept.storeId],
        });
        pending(artifact._id, false);
        setSend("sent");
        // Lists show its name and summary without opening it.
        await touch({
          artifactId: artifact._id as Id<"spectraArtifacts">,
          title: projection.title,
          ...(projection.summary ? { summary: projection.summary } : {}),
          tags: projection.tags,
          edited: true,
        }).catch(() => undefined);
      } catch {
        setSend("failed");
      } finally {
        state.sending = null;
      }
    })();
    return state.sending;
  };

  const scope = useMemo<AwayCopyScope | null>(() => {
    if (!kept) return null;
    return {
      artifactId: artifact._id,
      create: () => {
        const transport = new AwayCopyTransport(kept.seeds, (document) => {
          const state = sender.current;
          state.document = document;
          pending(artifact._id, true);
          setSend((current) => (current === "sending" ? current : "waiting"));
          window.clearTimeout(state.timer);
          state.timer = window.setTimeout(() => void sendNow.current(), SEND_AFTER_MS);
        }, () => void sendNow.current());
        sender.current.document = transport.document;
        // Edits kept here from an earlier visit that never went.
        if (pending(artifact._id)) sender.current.timer = window.setTimeout(() => void sendNow.current(), SEND_AFTER_MS);
        return transport;
      },
    };
  }, [artifact._id, kept]);

  useEffect(() => {
    if (!scope) return;
    const leave = () => void sendNow.current();
    const hidden = () => {
      if (document.visibilityState === "hidden") leave();
    };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hidden);
      leave();
    };
  }, [scope]);

  if (!enabled) return { state: "off" };
  if (scope && kept) return { state: "ready", scope, computerName: kept.computerName, at: kept.at, send };
  if (copy === null || loaded === "none") return { state: "none" };
  return { state: "loading" };
}

export function AwayCopyProvider({ copy, children }: { copy: AwayCopy; children: ReactNode }) {
  return <AwayCopyContext.Provider value={copy.state === "ready" ? copy.scope : null}>{children}</AwayCopyContext.Provider>;
}

export function AwayCopyBanner({ copy }: { copy: Extract<AwayCopy, { state: "ready" }> }) {
  const computer = copy.computerName || "your computer";
  const status =
    copy.send === "sending"
      ? "Sending your changes…"
      : copy.send === "sent"
        ? `Changes sent. ${computer} merges them the next time it's on with Spectra open.`
        : copy.send === "failed"
          ? "Your changes couldn't be sent yet. They're kept in this browser and go when they can."
          : `Changes go to ${computer} and merge with it the next time it's on with Spectra open.`;
  return (
    <div role="status" className="flex items-start gap-2 border-b border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-2 text-caption text-[var(--text-secondary)]">
      <span className="min-w-0">
        <span className="font-medium text-[var(--text-primary)]">
          {computer} is away, so you&apos;re editing its backup{copy.at ? ` from ${timeAgo(copy.at, Date.now())}` : ""}.
        </span>{" "}
        {status}
      </span>
    </div>
  );
}
