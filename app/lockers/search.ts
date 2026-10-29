import { distanceKm, locateBuyer } from "./nearest";
import { formatLockerId } from "./service-code";
import type { Locker } from "./types";

export interface LockerResult {
  id: string;
  network: string;
  name: string;
  address: string;
  city: string;
  zip: string;
}

export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function toResult(l: Locker): LockerResult {
  return { id: formatLockerId(l), network: l.network, name: l.name, address: l.address, city: l.city, zip: l.zip };
}

/**
 * Lockers matching every word of `q` (name, address, city, postcode), nearest to
 * `zip` first when given, otherwise alphabetical. `locateIn` is the set used to
 * place the postcode (pass the whole country: some networks have unreliable zips).
 */
export function searchLockers(
  lockers: Locker[],
  options: { q?: string | null; zip?: string | null; limit?: number; locateIn?: Locker[] },
): LockerResult[] {
  const words = fold(options.q ?? "").split(/[\s,]+/).filter(Boolean);
  let matches = words.length
    ? lockers.filter((l) => {
        const hay = fold(`${l.name} ${l.address} ${l.city} ${l.zip}`);
        return words.every((w) => hay.includes(w));
      })
    : lockers;

  const from = options.zip ? locateBuyer(options.locateIn ?? lockers, { zip: options.zip }) : null;
  if (from) {
    matches = [...matches].sort((a, b) => distanceKm(from, a) - distanceKm(from, b));
  } else {
    matches = [...matches].sort((a, b) => a.city.localeCompare(b.city, "lt") || a.name.localeCompare(b.name, "lt"));
  }
  return matches.slice(0, options.limit ?? 30).map(toResult);
}
