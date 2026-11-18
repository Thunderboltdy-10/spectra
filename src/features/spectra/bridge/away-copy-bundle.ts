/*
 * The backup file Bridge writes (bridge-core works.rs, backup_bundle): gzip of
 * "SPECTRA1", then per work a big-endian u32 length and a JSON header, and a
 * u32 length and the work's Yjs (v1) state. The browser reads one work out of
 * it, and writes the same shape to hand edits back to the computer.
 */

const MAGIC = new TextEncoder().encode("SPECTRA1");

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const response = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

export type BundleEntry = { header: Record<string, unknown>; body: Uint8Array };

/** The one work's entry in a backup, or null when the backup doesn't hold it. */
export async function readBundleEntry(bundle: Uint8Array, artifactId: string): Promise<BundleEntry | null> {
  const bytes = await through(bundle, new DecompressionStream("gzip"));
  if (bytes.length < MAGIC.length || MAGIC.some((byte, at) => bytes[at] !== byte)) throw new Error("That isn't a Spectra backup.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let at = MAGIC.length;
  let found: BundleEntry | null = null;
  while (at + 4 <= bytes.length) {
    const headerLength = view.getUint32(at);
    at += 4;
    if (at + headerLength + 4 > bytes.length) throw new Error("This backup is incomplete.");
    const header = bytes.subarray(at, at + headerLength);
    at += headerLength;
    const bodyLength = view.getUint32(at);
    at += 4;
    if (at + bodyLength > bytes.length) throw new Error("This backup is incomplete.");
    const parsed = JSON.parse(decoder.decode(header)) as Record<string, unknown>;
    // A later entry for the same work is the newer one.
    if (parsed.artifactId === artifactId) found = { header: parsed, body: bytes.slice(at, at + bodyLength) };
    at += bodyLength;
  }
  return found;
}

/** A backup holding one work, in the shape Bridge restores from. */
export async function writeBundle(header: Record<string, unknown>, body: Uint8Array) {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const raw = new Uint8Array(MAGIC.length + 4 + json.length + 4 + body.length);
  const view = new DataView(raw.buffer);
  raw.set(MAGIC, 0);
  let at = MAGIC.length;
  view.setUint32(at, json.length);
  raw.set(json, at + 4);
  at += 4 + json.length;
  view.setUint32(at, body.length);
  raw.set(body, at + 4);
  return through(raw, new CompressionStream("gzip"));
}
