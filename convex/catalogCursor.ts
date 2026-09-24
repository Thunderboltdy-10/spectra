const encoder = new TextEncoder();

function base64(bytes: Uint8Array) {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function bytes(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(
    atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
    (char) => char.charCodeAt(0),
  );
}

async function keys() {
  const secret = process.env.SPECTRA_SECRET_BRIDGE_KEY;
  if (!secret || secret.length < 32)
    throw new Error("CATALOG_CURSOR_CONFIG_REQUIRED");
  const root = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const derived = await crypto.subtle.sign(
    "HMAC",
    root,
    encoder.encode("spectra.catalog.cursor.encryption.v1"),
  );
  const encryption = await crypto.subtle.importKey(
    "raw",
    derived,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return { root, encryption };
}

/** Scanned private IDs must stay confidential. Derive the nonce from the full
 * plaintext instead of query RNG (which may replay its seed during retries).
 * Equal plaintext yields equal ciphertext; distinct plaintext gets a separate
 * 128-bit HMAC nonce. Encryption keys and nonce inputs are domain separated.
 */
export async function sealCatalogCursor(value: object, scope: string) {
  const { root, encryption } = await keys();
  const json = JSON.stringify(value);
  const plaintext = encoder.encode(json);
  const digest = await crypto.subtle.sign(
    "HMAC",
    root,
    encoder.encode(`spectra.catalog.cursor.nonce.v1\n${scope}\n${json}`),
  );
  const nonce = new Uint8Array(digest).slice(0, 16);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: encoder.encode(scope) },
      encryption,
      plaintext,
    ),
  );
  const envelope = new Uint8Array(nonce.length + ciphertext.length);
  envelope.set(nonce);
  envelope.set(ciphertext, nonce.length);
  return `c1.${base64(envelope)}`;
}

export async function openCatalogCursor(
  value: string,
  scope: string,
): Promise<unknown> {
  const { encryption } = await keys();
  try {
    if (!value.startsWith("c1.") || value.length > 16_384) throw new Error();
    const envelope = bytes(value.slice(3));
    if (envelope.length < 33) throw new Error();
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: envelope.slice(0, 16),
        additionalData: encoder.encode(scope),
      },
      encryption,
      envelope.slice(16),
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("CATALOG_CURSOR_INVALID: Restart this search.");
  }
}
