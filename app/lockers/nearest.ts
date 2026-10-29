import type { Locker } from "./types";

export interface Point {
  lat: number;
  lng: number;
}

export function normalizeZip(zip: string | null | undefined): string {
  return (zip ?? "").toUpperCase().replace(/^[A-Z]{2}-?/, "").replace(/\s+/g, "");
}

export function distanceKm(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function centroid(points: Locker[]): Point | null {
  if (points.length === 0) return null;
  const sum = points.reduce((s, l) => ({ lat: s.lat + l.lat, lng: s.lng + l.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

/**
 * Approximates the buyer's position without an external geocoder: the centroid of
 * lockers sharing the longest postcode prefix, falling back to a city-name match.
 */
export function locateBuyer(
  lockers: Locker[],
  address: { zip?: string | null; city?: string | null },
): Point | null {
  const zip = normalizeZip(address.zip);
  for (let len = zip.length; len >= 2; len--) {
    const prefix = zip.slice(0, len);
    const point = centroid(lockers.filter((l) => normalizeZip(l.zip).startsWith(prefix)));
    if (point) return point;
  }
  const city = address.city?.trim().toLowerCase();
  if (city) {
    const point = centroid(
      lockers.filter((l) => l.city.toLowerCase().includes(city) || l.address.toLowerCase().includes(city)),
    );
    if (point) return point;
  }
  return null;
}

export function nearestPerNetwork(
  lockers: Locker[],
  from: Point,
  perNetwork: number,
): Array<Locker & { distanceKm: number }> {
  const byNetwork = new Map<string, Array<Locker & { distanceKm: number }>>();
  for (const l of lockers) {
    const list = byNetwork.get(l.network) ?? [];
    list.push({ ...l, distanceKm: distanceKm(from, l) });
    byNetwork.set(l.network, list);
  }
  return [...byNetwork.values()]
    .flatMap((list) => list.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, perNetwork))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
