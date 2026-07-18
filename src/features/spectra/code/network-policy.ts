export const MAX_CODE_NETWORK_ORIGINS = 20;

export type NetworkOriginInspection =
  { ok: true; origin: string } | { ok: false; error: string };

function normalizedHost(hostname: string) {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function isPrivateIpv4(host: string) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((part) => part > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a! >= 224
  );
}

function isPrivateHost(hostname: string) {
  const host = normalizedHost(hostname);
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    isPrivateIpv4(host)
  ) {
    return true;
  }
  if (!host.includes(":")) return false;
  const compact = host.replace(/^0+/, "");
  return (
    compact === "" ||
    compact === "::" ||
    compact === "::1" ||
    compact.startsWith("fc") ||
    compact.startsWith("fd") ||
    /^fe[89ab]/.test(compact) ||
    compact.startsWith("2001:db8:") ||
    compact.startsWith("::ffff:0:") ||
    compact.startsWith("::ffff:")
  );
}

export function inspectCodeNetworkOrigin(
  value: string,
): NetworkOriginInspection {
  const candidate = value.trim();
  if (!candidate) return { ok: false, error: "Enter an HTTPS origin." };
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:") {
      return { ok: false, error: "Only HTTPS origins can be approved." };
    }
    if (url.username || url.password) {
      return {
        ok: false,
        error: "Credentials cannot appear in an approved origin.",
      };
    }
    if (isPrivateHost(url.hostname)) {
      return {
        ok: false,
        error:
          "Local, private-network, and reserved addresses cannot be approved.",
      };
    }
    return { ok: true, origin: url.origin };
  } catch {
    return {
      ok: false,
      error: "Enter a complete HTTPS origin, such as https://api.example.org.",
    };
  }
}

export function normalizeCodeNetworkOrigins(values: readonly string[] = []) {
  const origins = new Set<string>();
  for (const value of values.slice(0, MAX_CODE_NETWORK_ORIGINS)) {
    const inspected = inspectCodeNetworkOrigin(value);
    if (inspected.ok) origins.add(inspected.origin);
  }
  return [...origins];
}
