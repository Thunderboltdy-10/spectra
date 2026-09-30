import { getSpectraArtifactForDeepLink, type SpectraArtifact } from "../data/api";

type DetailReader = (id: string, options?: { signal?: AbortSignal }) => Promise<{ artifact: SpectraArtifact | null }>;

export function isUnavailableShellArtifact(artifact: SpectraArtifact) {
  return artifact.accessLevel === null || artifact.status === "deleted";
}

/** Order overlapping authoritative reads without caching completed bodies. */
export function createShellArtifactAccess(readDetail: DetailReader = getSpectraArtifactForDeepLink) {
  let sequence = 0;
  // A list can report revocation for any id, but only an older detail read of
  // the same id needs a newer body for its navigation handoff.
  const pendingDetails = new Map<string, Set<number>>();
  const pendingLists = new Set<number>();
  const decisions = new Map<string, {
    sequence: number;
    result?: { artifact: SpectraArtifact | null };
  }>();
  const listeners = new Set<(id: string) => void>();
  // Monotonic requests are inserted in order, so the first remaining entry
  // is the oldest. Finishing one detail never scans unrelated decisions.
  const oldest = (requests?: Set<number>): number => requests?.values().next().value ?? Infinity;
  const releaseSettled = (id: string) => {
    const decision = decisions.get(id);
    if (!decision) return;
    const needsBody = oldest(pendingDetails.get(id)) < decision.sequence;
    if (!needsBody && oldest(pendingLists) >= decision.sequence) decisions.delete(id);
    else if (!needsBody) delete decision.result;
  };
  const begin = (id: string | null) => {
    const request = ++sequence;
    const requests = id === null ? pendingLists : (pendingDetails.get(id) ?? new Set<number>());
    requests.add(request);
    if (id !== null) pendingDetails.set(id, requests);
    return {
      accept(id: string, artifact: SpectraArtifact | null) {
        if ((decisions.get(id)?.sequence ?? 0) > request) return false;
        decisions.set(id, { sequence: request, result: { artifact } });
        return true;
      },
      finish() {
        if (!requests.delete(request)) return;
        if (id === null) {
          for (const artifactId of decisions.keys()) releaseSettled(artifactId);
        } else {
          if (requests.size === 0) pendingDetails.delete(id);
          releaseSettled(id);
        }
      },
    };
  };
  const unavailable = (id: string) => listeners.forEach((listener) => listener(id));
  return {
    subscribe(listener: (id: string) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    // A completed reactive read is also an authoritative availability decision.
    observeUnavailable(id: string) {
      const observation = begin(id);
      try {
        if (observation.accept(id, null)) unavailable(id);
      } finally {
        observation.finish();
      }
    },
    async read(id: string, options?: { signal?: AbortSignal }) {
      const signal = options?.signal;
      if (signal?.aborted) throw new DOMException("Artifact read was superseded.", "AbortError");
      const request = begin(id);
      // Even a reader that ignores abort must not keep newer bodies pinned.
      signal?.addEventListener("abort", request.finish, { once: true });
      try {
        const result = await readDetail(id, options);
        if (signal?.aborted) {
          throw new DOMException("Artifact read was superseded.", "AbortError");
        }
        const artifact = result.artifact && !isUnavailableShellArtifact(result.artifact) ? result.artifact : null;
        // An open still needs its navigation handoff when a later refresh wins.
        // Give it that newer complete decision, never its stale response.
        // This still-pending detail keeps the newer result alive until finally.
        if (!request.accept(id, artifact)) return decisions.get(id)!.result!;
        if (!artifact) {
          unavailable(id);
          return { artifact: null };
        }
        return result;
      } finally {
        signal?.removeEventListener("abort", request.finish);
        request.finish();
      }
    },
    // Call only before a forced network refresh. Cached lists and missing rows
    // never establish revocation; updatedAt is not a permission revision.
    beginListRefresh() {
      const request = begin(null);
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
