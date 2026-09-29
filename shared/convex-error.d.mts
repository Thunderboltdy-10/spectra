/** A Spectra-authored failure, as it crosses the Convex boundary. */
export type WordedError = {
  /** The leading machine code (`CALENDAR_GESTURE_CONFLICT`), if the text has one. */
  code: string | null;
  /** The text as thrown, code included: `CODE: sentence`, `CODE`, or a sentence. */
  message: string;
};
export function toWordedConvexError(thrown: unknown): unknown;
export function readConvexError(error: unknown): WordedError;
export function rethrowWorded(error: unknown): never;
