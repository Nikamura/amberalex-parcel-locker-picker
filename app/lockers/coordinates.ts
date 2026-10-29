import type { Locker } from "./types";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Detects networks whose lat/lng are swapped by comparing each network's median
 * position with the median of the whole country, and swaps them back.
 * Assumes most lockers in a country are correct.
 */
export function fixSwappedCoordinates(lockers: Locker[]): Locker[] {
  const groups = new Map<string, Locker[]>();
  for (const l of lockers) {
    const key = `${l.countryCode}\u0000${l.network}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const byCountry = new Map<string, Locker[]>();
  for (const l of lockers) byCountry.set(l.countryCode, [...(byCountry.get(l.countryCode) ?? []), l]);
  const reference = new Map(
    [...byCountry].map(([country, list]) => [
      country,
      { lat: median(list.map((l) => l.lat)), lng: median(list.map((l) => l.lng)) },
    ]),
  );

  const swapped = new Set<string>();
  for (const [key, list] of groups) {
    const ref = reference.get(list[0].countryCode)!;
    const lat = median(list.map((l) => l.lat));
    const lng = median(list.map((l) => l.lng));
    const asIs = Math.abs(lat - ref.lat) + Math.abs(lng - ref.lng);
    const flipped = Math.abs(lng - ref.lat) + Math.abs(lat - ref.lng);
    if (flipped < asIs && Math.abs(lng) <= 90) swapped.add(key);
  }
  if (swapped.size === 0) return lockers;
  return lockers.map((l) =>
    swapped.has(`${l.countryCode}\u0000${l.network}`) ? { ...l, lat: l.lng, lng: l.lat } : l,
  );
}
