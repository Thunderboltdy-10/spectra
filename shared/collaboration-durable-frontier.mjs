// A vector alone misses deletes. This compact causal frontier includes both,
// without hashing the document body. Unresolved updates need their dependencies
// before an integrated frontier can prove the complete local recovery state.
export function encodeDurableFrontier(Y, document) {
  if (document.store.pendingStructs || document.store.pendingDs) return null;
  return Y.encodeSnapshot(Y.snapshot(document));
}
