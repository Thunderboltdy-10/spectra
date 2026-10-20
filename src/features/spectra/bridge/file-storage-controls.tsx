"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuthedArgs } from "../data/use-authed-args";
import { humanizePublicFailure } from "./humanize";
import { mountsForConnectedDevice } from "./mount-selection";
import { useBridgeHealth } from "./use-bridge";
import { StorageToggleGroup } from "./storage-toggle-group";
import { SelectField } from "@/components/ui/select";
import {
  isProtectedOriginalPreset,
  policyPresetFromToggles,
  storageChoiceFromPreset,
  type StorageChoice,
} from "./sync-toggles";
import { readConvexError } from "../../../../shared/convex-error.mjs";

/**
 * Item-level storage and the Read-don't-change switch. Resource files and
 * native Office studios share this so a linked Word/Excel/PowerPoint surface
 * can turn the original read-only the same way a resource file can.
 */
export function FileStorageControls({
  artifactId,
  artifactTitle,
  embedded = false,
}: {
  artifactId: string;
  artifactTitle: string;
  embedded?: boolean;
}) {
  const truth = useQuery(
    api.replicas.forWork,
    useAuthedArgs({
      workId: artifactId as never,
    }),
  );
  const effectivePolicy = useQuery(
    api.syncPolicy.effective,
    useAuthedArgs({
      itemId: artifactId,
    }),
  );
  const strategyTransition = useQuery(
    api.replicas.strategyTransitionForWork,
    useAuthedArgs({
      workId: artifactId as never,
    }),
  );
  const activeMounts = useQuery(api.bridge.activeMounts, useAuthedArgs({}));
  const bridge = useBridgeHealth();
  const currentDeviceMounts = mountsForConnectedDevice(
    activeMounts,
    bridge.status,
    bridge.state === "connected",
  );
  const transitionStorageStrategy = useMutation(
    api.replicas.transitionStorageStrategy,
  );
  const revertPolicy = useMutation(api.syncPolicy.revert);
  const [strategyBusy, setStrategyBusy] = useState(false);
  const [openError, setOpenError] = useState<string>();
  const [selectedMountId, setSelectedMountId] = useState("");
  const hasLocalCopy = Boolean(
    truth?.replicas.some((replica) => replica.kind === "local"),
  );
  const currentPreset =
    effectivePolicy?.preset ?? (hasLocalCopy ? "both" : "spectra");
  const strategyPending =
    strategyBusy || strategyTransition?.state === "pending";

  useEffect(() => {
    if (currentDeviceMounts.some((mount) => mount._id === selectedMountId))
      return;
    setSelectedMountId(
      currentDeviceMounts.length === 1 ? currentDeviceMounts[0]!._id : "",
    );
  }, [currentDeviceMounts, selectedMountId]);

  if (!truth || truth.replicas.length === 0) return null;

  const transitionPreview = strategyTransition?.preview as
    | {
        pendingWork?: {
          state?: string;
          localResourceId?: string;
          relativePath?: string;
        };
        current?: {
          cloud?: { state?: string; contentHash?: string };
          locals?: Array<{
            copyRole?: string;
            localResourceId?: string;
            path?: string;
            state?: string;
            availability?: string;
            unavailableReason?: string;
          }>;
        };
      }
    | undefined;

  async function changeStorageStrategy(
    choice: StorageChoice,
    protectedOriginal = isProtectedOriginalPreset(
      effectivePolicy?.preset ?? currentPreset,
    ),
  ) {
    const toPreset = policyPresetFromToggles(choice, protectedOriginal);
    if (toPreset === currentPreset) return;
    const targetMount =
      currentDeviceMounts.find((mount) => mount._id === selectedMountId) ??
      (currentDeviceMounts.length === 1 ? currentDeviceMounts[0] : undefined);
    if (toPreset !== "spectra" && !hasLocalCopy && !targetMount) {
      setOpenError(
        currentDeviceMounts.length > 1
          ? "Choose the folder for this computer below before keeping a local copy."
          : "Connect Spectra Bridge and add a folder in Spectra Settings before keeping a local copy.",
      );
      return;
    }
    setStrategyBusy(true);
    setOpenError(undefined);
    try {
      await transitionStorageStrategy({
        workId: artifactId as never,
        toPreset,
        ...(toPreset !== "spectra" &&
        !truth?.replicas.some((replica) => replica.kind === "local") &&
        targetMount
          ? { mountId: targetMount._id, relativePath: artifactTitle }
          : {}),
      });
    } catch (error) {
      setOpenError(
        readConvexError(error).message ||
          "The storage strategy could not be changed. No file was removed.",
      );
    } finally {
      setStrategyBusy(false);
    }
  }

  return (
    <div
      {...(embedded
        ? {
            "data-spectra-card": "side",
            "data-side-card-title": "how-this-file-is-stored",
            className: "p-4",
          }
        : {})}
    >
      <h2
        className={
          embedded
            ? "mb-3 text-micro font-semibold text-[var(--text-tertiary)]"
            : "text-caption font-semibold text-[var(--text-primary)]"
        }
      >
        How this file is stored
      </h2>
      <p className="mt-1 text-micro leading-5 text-[var(--text-secondary)]">
        Changing this keeps the same Spectra item. If Spectra stops using a copy
        on this computer, the file stays on disk.
      </p>
      <div className="mt-3">
        <StorageToggleGroup
          value={storageChoiceFromPreset(currentPreset)}
          hasLocalCopy={hasLocalCopy}
          protectedOriginal={isProtectedOriginalPreset(currentPreset)}
          showProtected
          disabled={strategyPending}
          onChange={(choice) => void changeStorageStrategy(choice)}
          onProtectedChange={(next) =>
            void changeStorageStrategy(
              storageChoiceFromPreset(currentPreset),
              next,
            )
          }
        />
      </div>
      {!hasLocalCopy && currentDeviceMounts.length > 1 ? (
        <div className="mt-3">
          <SelectField
            label="Folder on this computer"
            value={selectedMountId}
            onChange={setSelectedMountId}
            options={currentDeviceMounts.map((mount) => ({
              value: mount._id,
              label: mount.rootLabel,
            }))}
            placeholder="Choose a folder"
          />
        </div>
      ) : null}
      {effectivePolicy?.source.kind &&
      effectivePolicy.source.kind !== "default" ? (
        <button
          type="button"
          className="mt-2 text-micro font-medium text-[var(--text-primary)]"
          onClick={() =>
            void revertPolicy({
              scopeKind: "item",
              scopeId: artifactId,
              idempotencyKey: `revert:${artifactId}:${Date.now()}`,
            })
          }
        >
          Use the account default
        </button>
      ) : null}
      {strategyTransition?.state === "pending" ? (
        <div className="mt-2 space-y-1 text-micro text-[var(--text-secondary)]">
          <p>
            {transitionPreview?.pendingWork?.relativePath
              ? `Writing the retained work to ${transitionPreview.pendingWork.relativePath}.`
              : "Moving this work between Spectra and this computer."}{" "}
            The item stays open while Spectra Bridge verifies the file.
          </p>
          {transitionPreview?.pendingWork?.localResourceId ? (
            <p className="text-[var(--text-tertiary)]">
              Existing file identity: {transitionPreview.pendingWork.localResourceId}
            </p>
          ) : null}
        </div>
      ) : strategyTransition?.state === "failed" ? (
        <p
          className="mt-2 text-micro text-[var(--danger)]"
          role="alert"
        >
          {humanizePublicFailure(
            strategyTransition.errorCode ?? "strategy-transition-failed",
          )}
        </p>
      ) : strategyTransition?.state === "conflicted" ? (
        <p className="mt-2 text-micro text-[var(--danger)]" role="alert">
          The original file changed during this transition. Review the current
          file before trying again; nothing was deleted.
        </p>
      ) : null}
      {openError ? (
        <p className="mt-2 text-micro text-[var(--danger)]" role="alert">
          {humanizePublicFailure(openError)}
        </p>
      ) : null}
    </div>
  );
}
