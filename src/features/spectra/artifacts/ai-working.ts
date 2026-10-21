/*
 * Whether Spectra is writing a work right now. A run marks the work while it
 * writes and clears the mark when it ends; a run that died without clearing it
 * leaves the mark behind, so a mark with no run, or one not renewed for a
 * while, is taken as over. Cards then show the work as it is, never a
 * skeleton or a moving mark that stays for good.
 */

/** How long a run may go without touching its work before its mark is taken as stale. */
const STALE_AFTER_MS = 45_000;

export type AiMarked = { aiState?: string | null; aiRunId?: string | null; updatedAt?: number | null };

export function aiWorking(work: AiMarked | null | undefined, now = Date.now()) {
  if (!work || (work.aiState !== "creating" && work.aiState !== "updating")) return false;
  return Boolean(work.aiRunId) && (!work.updatedAt || now - work.updatedAt <= STALE_AFTER_MS);
}
