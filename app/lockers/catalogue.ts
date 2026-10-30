import { distanceKm, normalizeZip, type Point } from "./nearest";
import { fold, searchText, toResult, type LockerResult } from "./search";
import type { Locker } from "./types";

// The whole locker catalogue (~5k rows) lives in Worker memory. D1 bills every
// scanned row, and searching it there cost a full country scan per request.

/** One country's lockers as stored in locker_snapshot.data (see scripts/sync-lockers.ts). */
export type SnapshotRow = [
  source: string,
  externalId: string,
  network: string,
  name: string,
  address: string,
  city: string,
  zip: string,
  lat: number,
  lng: number,
  comment: string | null,
  search: string,
];

export interface Entry {
  locker: Locker;
  /** searchText(locker), precomputed by the sync so a cold Worker skips Unicode folding. */
  search: string;
  zip: string;
}

/** Lockers of one country; loaded per country so a cold start parses only what it needs. */
export type Country = Entry[];

export function parseSnapshot(countryCode: string, data: string): Country {
  return (JSON.parse(data) as SnapshotRow[]).map(([source, externalId, network, name, address, city, zip, lat, lng, comment, search]) => {
    const locker = { source, externalId, network, countryCode, name, address, city, zip, lat, lng, comment };
    return { locker, search: search || searchText(locker), zip: normalizeZip(zip) };
  });
}

export function toCountry(lockers: Locker[]): Country {
  return lockers.map((locker) => ({ locker, search: searchText(locker), zip: normalizeZip(locker.zip) }));
}

export function networksInCountry(c: Country): string[] {
  return [...new Set(c.map((e) => e.locker.network))].sort();
}

export function networkCounts(c: Country) {
  const counts = new Map<string, number>();
  for (const { locker } of c) counts.set(locker.network, (counts.get(locker.network) ?? 0) + 1);
  return [...counts].map(([network, count]) => ({ network, count }));
}

/**
 * Approximate a postcode's position as the centre of lockers sharing the longest
 * postcode prefix (all networks; some carry non-postal zips).
 */
export function locateZip(c: Country, zip: string | null | undefined): Point | null {
  const z = normalizeZip(zip);
  for (let len = z.length; len >= 2; len--) {
    const prefix = z.slice(0, len);
    let lat = 0;
    let lng = 0;
    let n = 0;
    for (const e of c) {
      if (!e.zip.startsWith(prefix)) continue;
      lat += e.locker.lat;
      lng += e.locker.lng;
      n++;
    }
    if (n > 0) return { lat: lat / n, lng: lng / n };
  }
  return null;
}

export interface SearchOptions {
  networks?: string[];
  q?: string | null;
  zip?: string | null;
  near?: Point | null;
  limit?: number;
}

/** Lockers matching every word of `q`, nearest to `near`/`zip` first, else alphabetical. */
export function searchLockers(c: Country, options: SearchOptions): LockerResult[] {
  const from = options.near ?? (options.zip ? locateZip(c, options.zip) : null);
  const networks = options.networks?.length ? new Set(options.networks) : null;
  const words = fold(options.q ?? "").split(/[\s,]+/).filter(Boolean);
  const matches = c.filter(
    (e) => (!networks || networks.has(e.locker.network)) && words.every((w) => e.search.includes(w)),
  );

  let ordered: Locker[];
  if (from) {
    // Equirectangular approximation, good enough for ranking within a country.
    const cos = Math.cos((from.lat * Math.PI) / 180);
    ordered = matches
      .map((e) => {
        const dLat = e.locker.lat - from.lat;
        const dLng = (e.locker.lng - from.lng) * cos;
        return { locker: e.locker, d: dLat * dLat + dLng * dLng };
      })
      .sort((a, b) => a.d - b.d)
      .map((x) => x.locker);
  } else {
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    ordered = matches.map((e) => e.locker).sort((a, b) => cmp(a.city, b.city) || cmp(a.name, b.name));
  }

  return ordered.slice(0, Math.min(50, options.limit ?? 30)).map((l) => {
    const result = toResult(l);
    if (from) result.distanceKm = Math.round(distanceKm(from, l) * 10) / 10;
    return result;
  });
}

/** Every locker of the given networks as [id, lat, lng, networkIndex], for map markers. */
export function lockerPoints(c: Country, networks: string[]) {
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  return c
    .filter((e) => networks.includes(e.locker.network))
    .map(({ locker: l }) => [`${l.source}:${l.externalId}`, round(l.lat), round(l.lng), networks.indexOf(l.network)] as const);
}
