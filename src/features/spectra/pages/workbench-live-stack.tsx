import type { ReactNode } from "react";

/** Shared bottom interaction layer for every workbench route. */
export function WorkbenchLiveStack({
  children,
  zIndex,
}: {
  children: ReactNode;
  zIndex: number;
}) {
  return (
    <div
      className="spectra-workbench-live-stack pointer-events-none absolute inset-x-0 bottom-0 bg-transparent px-2 pb-4 pt-2 sm:px-5 sm:pb-5 lg:px-8"
      style={{ zIndex }}
    >
      <div className="spectra-live-stack pointer-events-auto mx-auto max-w-[880px]">{children}</div>
    </div>
  );
}
