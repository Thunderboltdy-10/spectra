"use client";

import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";
import { Switch } from "@/components/ui/switch";

/*
 * Whether new files and folders follow on their own between a computer's
 * synced folders and Spectra. Off, a new file waits to be brought in by hand,
 * which is what lets someone keep a single file out of Spectra.
 */
export function NewFilesChoice({
  on,
  disabled,
  onChange,
}: {
  on: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <section aria-labelledby="new-files" className="device-slip">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="new-files" className="device-slip-heading">
            New files sync both ways
          </h2>
          <p className="device-slip-about">
            {on
              ? "A file or folder added to a synced folder comes into Spectra by itself, and moving or renaming one on either side does the same on the other. A folder's Details can set it differently."
              : "New files in a synced folder wait for you to pick them with Add files, so you choose each one. Moves and renames stay on their own side. A folder's Details can set it differently."}
          </p>
        </div>
        <Switch aria-label="New files sync both ways" checked={on} disabled={disabled} onCheckedChange={onChange} />
      </div>
    </section>
  );
}

type EffectivePolicy = NonNullable<FunctionReturnType<typeof api.syncPolicy.effective>>;

/** The account policy with the new-files choice applied, everything else kept. */
export function newFilesPolicy(policy: EffectivePolicy, on: boolean) {
  return {
    preset: policy.preset,
    contentDirection: policy.contentDirection,
    cloudContent: policy.cloudContent,
    includeGlobs: policy.includeGlobs,
    excludeGlobs: policy.excludeGlobs,
    timing: policy.timing,
    protectedOriginal: policy.protectedOriginal,
    ...(policy.localMirrorGrantId ? { localMirrorGrantId: policy.localMirrorGrantId } : {}),
    discovery: on ? ("auto" as const) : ("explicit" as const),
    structure: on ? ("mirror-both" as const) : ("independent" as const),
  };
}
