import { Skeleton } from "@/components/ui/skeleton";
import type { OfficeViewKind } from "./file-kind";

/** The ghost of what is coming, at the real content's places (LIFE.md, "Load"). */
export function OfficeGhost({ kind, filename }: { kind: OfficeViewKind | "file"; filename: string }) {
  return (
    <div role="status" aria-label={`Opening ${filename}`} data-life-ghost className="file-viewer-ghost" data-kind={kind}>
      {kind === "slides" ? (
        <>
          <span className="file-viewer-ghost-rail">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} bar className="aspect-video w-full" />)}
          </span>
          <Skeleton bar className="file-viewer-ghost-stage" />
        </>
      ) : kind === "sheet" ? (
        <span className="file-viewer-ghost-grid">
          {Array.from({ length: 12 }, (_, index) => <Skeleton key={index} bar className="h-5" style={{ width: `${92 - ((index * 13) % 28)}%` }} />)}
        </span>
      ) : kind === "document" ? (
        <span className="file-viewer-ghost-page">
          <Skeleton bar className="mb-5 h-7 w-1/2" />
          {Array.from({ length: 9 }, (_, index) => <Skeleton key={index} bar className="mb-2.5 h-3.5" style={{ width: `${96 - ((index * 17) % 34)}%` }} />)}
        </span>
      ) : (
        <Skeleton className="h-full w-full" />
      )}
    </div>
  );
}
