/** A byte-stable SHA-256 used by every lens and interchange boundary. */
export async function sha256Payload(payload: Uint8Array) {
  const stable = Uint8Array.from(payload);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", stable.buffer)),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
