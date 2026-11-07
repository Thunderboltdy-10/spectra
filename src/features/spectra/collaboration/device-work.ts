import * as Y from "yjs";
import {
  initializeNativeArtifactDocument,
  nativeArtifactProjection,
} from "../../../../scripts/collaboration-native-projection.mjs";

/*
 * Work kept on a computer has no gateway to write its first version or to say
 * what it holds now, so whoever opens it does: the same native model a cloud
 * room would build, handed to Bridge, and the same projection read back out.
 */

export const DEVICE_ROOM_URL = "ws://127.0.0.1:47615/v1/rooms";

export type DeviceSeed = {
  typeKey: string;
  title: string;
  summary?: string;
  tags: string[];
  schemaVersion: number;
  content: unknown;
};

export type DeviceProjection = {
  title: string;
  summary?: string;
  tags: string[];
  blueprintKey: string;
  schemaVersion: number;
  content: unknown;
  /** The work's words, for search on this computer. */
  text: string;
};

const NOT_WORDS = new Set([
  "id", "type", "kind", "variant", "status", "color", "colour", "fill", "stroke",
  "src", "url", "href", "marks", "style", "language", "fontFamily",
]);
const MAX_TEXT = 200_000;

/** Every word in a work, without its ids and settings. */
export function wordsOf(content: unknown): string {
  const words: string[] = [];
  let length = 0;
  const walk = (value: unknown, key?: string) => {
    if (length >= MAX_TEXT || (key && NOT_WORDS.has(key))) return;
    if (typeof value === "string") {
      if (value.trim()) {
        words.push(value);
        length += value.length + 1;
      }
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (value && typeof value === "object") {
      for (const [name, item] of Object.entries(value)) walk(item, name);
    }
  };
  walk(content);
  return words.join(" ").slice(0, MAX_TEXT);
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(text: string) {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}

export function deviceProjectionOf(document: Y.Doc, schemaVersion: number): DeviceProjection | null {
  const projection = nativeArtifactProjection(document, schemaVersion);
  if (!projection) return null;
  return {
    title: projection.title,
    ...(projection.summary ? { summary: projection.summary } : {}),
    tags: projection.tags,
    blueprintKey: projection.typeKey,
    schemaVersion: projection.schemaVersion,
    content: projection.content,
    text: wordsOf(projection.content),
  };
}

/** A new work's first version, and what it says about itself. */
export function deviceBaseline(seed: DeviceSeed) {
  const document = new Y.Doc();
  try {
    initializeNativeArtifactDocument(document, seed);
    return {
      stateBase64: bytesToBase64(Y.encodeStateAsUpdate(document)),
      projection: deviceProjectionOf(document, seed.schemaVersion),
    };
  } finally {
    document.destroy();
  }
}
