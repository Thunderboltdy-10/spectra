import { accountStorageScope } from "@/lib/account-storage";
import { getAdministration, type AdministrationIdentity } from "./api";

const KEPT_MS = 10 * 60_000;
let kept: { at: number; scope: string | null; reading: Promise<AdministrationIdentity | null> } | null = null;

/** Who is signed in, shared by everything on the page that asks, and never across accounts. */
export function readIdentity() {
  const scope = accountStorageScope();
  if (kept && kept.scope === scope && Date.now() - kept.at < KEPT_MS) return kept.reading;
  const reading = getAdministration<AdministrationIdentity>("identity");
  const entry = { at: Date.now(), scope, reading };
  kept = entry;
  void reading.catch(() => {
    if (kept === entry) kept = null;
  });
  return reading;
}

export function forgetIdentityForTests() {
  kept = null;
}
