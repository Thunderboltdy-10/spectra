export const ACCOUNT_SCOPE_KEY = "spectra:account-storage-scope:v1";

let requestRevision = 0;
let preparedScope: string | undefined;

/** Retire pending work immediately, even before the next account query resolves. */
export function retireAccountStorageRequests() { requestRevision += 1; }

export function accountStorageScope() {
  try {
    return window.localStorage.getItem(ACCOUNT_SCOPE_KEY);
  } catch {
    return null;
  }
}

export function prepareAccountStorageScope(scope: string) { preparedScope = scope; }

export function accountStorageRevision() {
  return JSON.stringify([requestRevision, accountStorageScope()]);
}

export function accountStorageMatches(revision: string) {
  const scope = accountStorageScope();
  return revision === JSON.stringify([requestRevision, scope]) && (preparedScope === undefined || preparedScope === scope);
}

export function assertAccountStorageRevision(revision: string) {
  if (!accountStorageMatches(revision)) throw new DOMException("The account changed.", "AbortError");
}
