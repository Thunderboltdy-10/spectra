/**
 * The realtime room is the only authority allowed to create a native Yjs
 * baseline. A synchronized client must therefore receive an initialized model;
 * it never manufactures equivalent content with unrelated Yjs identities.
 */
export function nativeRoomBaselineExpected(state: string) {
  return state === "synchronized";
}
