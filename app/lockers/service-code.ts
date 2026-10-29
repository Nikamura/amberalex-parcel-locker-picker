// Rate service codes carry the buyer's choice onto the order's shipping line.
//   PLP1:<source>:<externalId>  a specific locker
//   PLP1N:<network>             a locker type; the locker is chosen after payment
// Bump the prefix if a format changes.
const LOCKER = "PLP1";
const NETWORK = "PLP1N";

export interface LockerRef {
  source: string;
  externalId: string;
}

export type ServiceChoice =
  | ({ kind: "locker" } & LockerRef)
  | { kind: "network"; network: string };

export function encodeServiceCode(ref: LockerRef): string {
  return [LOCKER, ref.source, ref.externalId].join(":");
}

export function encodeNetworkCode(network: string): string {
  return [NETWORK, network].join(":");
}

export function decodeServiceCode(code: string | null | undefined): ServiceChoice | null {
  if (!code) return null;
  const [prefix, first, ...rest] = code.split(":");
  if (prefix === NETWORK && first && rest.length === 0) return { kind: "network", network: first };
  const externalId = rest.join(":");
  if (prefix === LOCKER && first && externalId) return { kind: "locker", source: first, externalId };
  return null;
}

/** Locker ids exchanged with the storefront and extensions: "<source>:<externalId>". */
export function formatLockerId(ref: LockerRef): string {
  return `${ref.source}:${ref.externalId}`;
}

export function parseLockerId(id: string | null | undefined): LockerRef | null {
  if (!id) return null;
  const [source, ...rest] = id.split(":");
  const externalId = rest.join(":");
  return source && externalId ? { source, externalId } : null;
}
