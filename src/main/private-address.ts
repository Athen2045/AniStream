import { BlockList, isIP } from "node:net";

const PRIVATE_RANGES = (() => {
  const list = new BlockList();
  for (const [network, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ] as const)
    list.addSubnet(network, prefix, "ipv4");
  for (const [network, prefix] of [
    // Unspecified, loopback and the old IPv4-compatible form.
    ["::", 96],
    ["100::", 64],
    ["2001:db8::", 32],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ] as const)
    list.addSubnet(network, prefix, "ipv6");
  return list;
})();

/** Loopback, private, link-local, shared, documentation, multicast or reserved addresses. */
export function isPrivateAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "").toLowerCase();
  const family = isIP(bare);
  if (family === 4) return PRIVATE_RANGES.check(bare, "ipv4");
  // IPv4-mapped literals (::ffff:a.b.c.d) can name any IPv4 host; none is needed for streaming.
  // They are refused here rather than in the list, which would also match every plain IPv4 address.
  if (family === 6) return /^::ffff:/.test(bare) || PRIVATE_RANGES.check(bare, "ipv6");
  return false;
}
