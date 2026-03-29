import { Suspense } from "react";
import { NotesWorkspace } from "@/components/notes/notes-workspace";

function ArtifactsLoader() {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center bg-[var(--bg-primary)]">
      <div className="flex flex-col items-center gap-3">
        <div
          className="h-8 w-8 rounded-full border-2 border-[var(--border-default)] border-t-[var(--accent-cyan)]"
          style={{ animation: "spin 800ms linear infinite" }}
        />
        <span className="text-xs text-[var(--text-tertiary)]">
          Loading artifacts...
        </span>
      </div>
    </div>
  );
}

export default function ArtifactsPage() {
  return (
    <Suspense fallback={<ArtifactsLoader />}>
      <NotesWorkspace />
    </Suspense>
  );
}
