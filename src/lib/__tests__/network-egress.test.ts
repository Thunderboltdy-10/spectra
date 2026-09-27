import { describe, expect, it } from "vitest";
import { isNonPublicAddress } from "../network-egress";

describe("isNonPublicAddress", () => {
  it.each([
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "0.0.0.0",
    "100.100.100.200", // carrier-grade NAT, used by some cloud metadata services
    "192.0.0.192",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:169.254.169.254", // IPv4-mapped metadata endpoint from an AAAA record
    "::ffff:a9fe:a9fe",
    "::ffff:127.0.0.1",
    "::127.0.0.1",
    "64:ff9b::a9fe:a9fe", // NAT64 translation of the metadata endpoint
    "2002:a9fe:a9fe::1", // 6to4 wrapping a link-local IPv4 host
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "not-an-address",
  ])("refuses %s", (address) => {
    expect(isNonPublicAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "93.184.216.34", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "2002:808:808::1"])(
    "allows public %s",
    (address) => {
      expect(isNonPublicAddress(address)).toBe(false);
    },
  );
});
