// Rate service codes carry the locker identity onto the order's shipping line.
// Format: PLP1:<source>:<externalId>. Bump the version if the format changes.
const PREFIX = "PLP1";

export interface LockerRef {
  source: string;
  externalId: string;
}

export function encodeServiceCode(ref: LockerRef): string {
  return [PREFIX, ref.source, ref.externalId].join(":");
}

export function decodeServiceCode(code: string | null | undefined): LockerRef | null {
  if (!code) return null;
  const [prefix, source, ...rest] = code.split(":");
  const externalId = rest.join(":");
  if (prefix !== PREFIX || !source || !externalId) return null;
  return { source, externalId };
}
