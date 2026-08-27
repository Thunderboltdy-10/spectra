/**
 * Semantic Yjs agreement is not a native Office write.
 *
 * Collaborative Word/Excel/PowerPoint editors bind the live body, so a local
 * keystroke is echoed back as the incoming snapshot. React baseline then
 * matches the draft and the dirty bit would clear before the lens
 * materializer runs. Keep the native draft pending until a real save clears
 * the human-edit flag.
 */
export function nativeOfficeDraftPending(input: {
  nativeOfficeDocument: boolean;
  userHasEdited: boolean;
  snapshotsDiffer: boolean;
}): boolean {
  if (input.nativeOfficeDocument) return input.userHasEdited;
  return input.userHasEdited && input.snapshotsDiffer;
}

/**
 * Pair the React dirty bit with its ref. Splitting them left native saves
 * looking unsaved to the incoming-Yjs effect, which re-dirtied and nested
 * updates past React's cap.
 */
export function writeStudioDirty(
  dirtyRef: { current: boolean },
  setDirty: (dirty: boolean) => void,
  dirty: boolean,
) {
  if (dirtyRef.current === dirty) return;
  dirtyRef.current = dirty;
  setDirty(dirty);
}
