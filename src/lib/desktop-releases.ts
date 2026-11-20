/**
 * Where Spectra for desktop is published: a public GitHub repository that
 * .github/workflows/bridge-release.yml releases to. It was called
 * spectra-bridge before the app took its name; GitHub forwards the old name to
 * the new one, and the old name is tried second in case the rename has not
 * happened yet.
 */
export const DEFAULT_RELEASES_REPO = "Thunderboltdy-10/spectra-desktop";
export const LEGACY_RELEASES_REPO = "Thunderboltdy-10/spectra-bridge";

export function releasesRepos(env: Record<string, string | undefined> = process.env): string[] {
  const configured = env.SPECTRA_DESKTOP_RELEASES_REPO || env.SPECTRA_BRIDGE_RELEASES_REPO;
  return [...new Set([configured || DEFAULT_RELEASES_REPO, LEGACY_RELEASES_REPO])];
}

export type Release = { repo: string; tag_name?: string; assets?: Array<{ name: string; browser_download_url: string }> };

/** The latest release, from the first repository that has one; kept for ten minutes. */
export async function latestRelease(repos = releasesRepos()): Promise<Release | null> {
  for (const repo of repos) {
    try {
      const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { accept: "application/vnd.github+json" },
        next: { revalidate: 600 },
      });
      if (response.ok) return { repo, ...((await response.json()) as Omit<Release, "repo">) };
    } catch {
      // The next repository, or the release page, still answers.
    }
  }
  return null;
}

export function releasePage(repo = releasesRepos()[0]!) {
  return `https://github.com/${repo}/releases/latest`;
}
