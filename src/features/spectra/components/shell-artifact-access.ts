import { getSpectraArtifactForDeepLink, type SpectraArtifact } from "../data/api";

type DetailReader = (id: string, options?: { signal?: AbortSignal }) => Promise<{ artifact: SpectraArtifact | null }>;

export function isUnavailableShellArtifact(artifact: SpectraArtifact) {
  return artifact.accessLevel === null || artifact.status === "deleted";
}

/** Order overlapping authoritative reads; release their results when all settle. */
export function createShellArtifactAccess(readDetail: DetailReader = getSpectraArtifactForDeepLink) {
  let sequence = 0;
  let pending = 0;
  const decisions = new Map<string, { sequence: number; artifact: SpectraArtifact | null }>();
  const listeners = new Set<(id: string) => void>();
  const begin = () => {
    const request = ++sequence;
    pending += 1;
    return {
      accept(id: string, artifact: SpectraArtifact | null) {
        if ((decisions.get(id)?.sequence ?? 0) > request) return false;
        decisions.set(id, { sequence: request, artifact });
        return true;
      },
      finish() {
        pending -= 1;
        // Only concurrent requests need the latest decision. Nothing survives
        // after they settle, even if many closed works have been visited.
        if (pending === 0) decisions.clear();
      },
    };
  };
  const unavailable = (id: string) => listeners.forEach((listener) => listener(id));
  return {
    subscribe(listener: (id: string) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async read(id: string, options?: { signal?: AbortSignal }) {
      const request = begin();
      try {
        const result = await readDetail(id, options);
        if (options?.signal?.aborted) {
          throw new DOMException("Artifact read was superseded.", "AbortError");
        }
        const artifact = result.artifact && !isUnavailableShellArtifact(result.artifact) ? result.artifact : null;
        // An open still needs its navigation handoff when a later refresh wins.
        // Give it that newer complete decision, never its stale response.
        if (!request.accept(id, artifact)) return { artifact: decisions.get(id)!.artifact };
        if (!artifact) {
          unavailable(id);
          return { artifact: null };
        }
        return result;
      } finally {
        request.finish();
      }
    },
    // Call only before a forced network refresh. Cached lists and missing rows
    // never establish revocation; updatedAt is not a permission revision.
    beginListRefresh() {
      const request = begin();
      return {
        reconcile(artifacts: readonly SpectraArtifact[]) {
          for (const artifact of artifacts) {
            if (isUnavailableShellArtifact(artifact) && request.accept(artifact._id, null)) unavailable(artifact._id);
          }
        },
        finish: request.finish,
      };
    },
  };
}
