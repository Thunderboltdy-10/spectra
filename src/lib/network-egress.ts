import { isIP } from "node:net";

/** [first octet, second-octet floor, second-octet ceiling, third octet?] */
const NON_PUBLIC_IPV4: ReadonlyArray<readonly [number, number, number, number?]> = [
  [0, 0, 255], // "this" network
  [10, 0, 255], // private
  [100, 64, 127], // carrier-grade NAT (also some cloud metadata endpoints)
  [127, 0, 255], // loopback
  [169, 254, 254], // link-local, including cloud instance metadata
  [172, 16, 31], // private
  [192, 0, 0, 0], // IETF protocol assignments
  [192, 0, 0, 2], // TEST-NET-1
  [192, 88, 88, 99], // 6to4 relay anycast
  [192, 168, 168], // private
  [198, 18, 19], // benchmarking
  [198, 51, 51, 100], // TEST-NET-2
  [203, 0, 0, 113], // TEST-NET-3
];

function ipv4Octets(address: string) {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function isNonPublicIpv4(address: string) {
  const octets = ipv4Octets(address);
  if (!octets) return true;
  const [a, b, c] = octets as [number, number, number, number];
  if (a >= 224) return true; // multicast, reserved and broadcast
  return NON_PUBLIC_IPV4.some(
    ([first, low, high, third]) => a === first && b >= low && b <= high && (third === undefined || c === third),
  );
}

/** Expand an IPv6 literal to eight 16-bit groups (embedded dotted quads too). */
function ipv6Groups(address: string) {
  let text = address.toLowerCase().split("%")[0]!;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const octets = ipv4Octets(dotted[1]!);
    if (!octets) return null;
    text = `${text.slice(0, dotted.index)}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((group) =>
    /^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : Number.NaN,
  );
  return groups.some(Number.isNaN) ? null : groups;
}

function embeddedIpv4(high: number, low: number) {
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isNonPublicIpv6(address: string) {
  const g = ipv6Groups(address);
  if (!g) return true;
  const leadingZero = (count: number) => g.slice(0, count).every((group) => group === 0);
  // Unspecified/loopback, IPv4-compatible and IPv4-mapped/translated forms
  // reach the embedded IPv4 host, so judge that host instead.
  if (leadingZero(6)) return g[6] === 0 && g[7]! <= 1 ? true : isNonPublicIpv4(embeddedIpv4(g[6]!, g[7]!));
  if (leadingZero(5) && (g[5] === 0xffff || g[5] === 0)) return isNonPublicIpv4(embeddedIpv4(g[6]!, g[7]!));
  if (leadingZero(4) && g[4] === 0xffff && g[5] === 0) return isNonPublicIpv4(embeddedIpv4(g[6]!, g[7]!));
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64 (well-known and local-use)
  if (g[0] === 0x2002) return isNonPublicIpv4(embeddedIpv4(g[1]!, g[2]!)); // 6to4
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true; // Teredo, documentation
  if (g[0] === 0x100 && leadingZero(4)) return true; // discard-only
  const first = g[0]!;
  return (
    (first & 0xfe00) === 0xfc00 || // unique local
    (first & 0xffc0) === 0xfe80 || // link-local
    (first & 0xffc0) === 0xfec0 || // deprecated site-local
    (first & 0xff00) === 0xff00 // multicast
  );
}

/**
 * True when a resolved address is not a routable public unicast host. Server
 * egress to school-configured endpoints must refuse these so a tenant setting
 * cannot reach cloud metadata, loopback services or the private network,
 * including through IPv4-mapped, NAT64 and 6to4 IPv6 spellings.
 */
export function isNonPublicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return isNonPublicIpv4(address);
  if (family === 6) return isNonPublicIpv6(address);
  return true;
}
