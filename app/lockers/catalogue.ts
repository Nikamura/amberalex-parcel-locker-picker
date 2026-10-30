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
];

interface Entry {
  locker: Locker;
  search: string;
  zip: string;
}

export interface Catalogue {
  byCountry: Map<string, Entry[]>;
  byId: Map<string, Locker>;
}

const key = (source: string, externalId: string) => `${source}:${externalId}`;

export function fromSnapshot(rows: Array<{ countryCode: string; data: string }>): Locker[] {
  return rows.flatMap(({ countryCode, data }) =>
    (JSON.parse(data) as SnapshotRow[]).map(([source, externalId, network, name, address, city, zip, lat, lng, comment]) => ({
      source,
      externalId,
      network,
      countryCode,
      name,
      address,
      city,
      zip,
      lat,
      lng,
      comment,
    })),
  );
}

export function buildCatalogue(lockers: Locker[]): Catalogue {
  const byCountry = new Map<string, Entry[]>();
  const byId = new Map<string, Locker>();
  for (const locker of lockers) {
    byId.set(key(locker.source, locker.externalId), locker);
    let list = byCountry.get(locker.countryCode);
    if (!list) byCountry.set(locker.countryCode, (list = []));
    list.push({ locker, search: searchText(locker), zip: normalizeZip(locker.zip) });
  }
  return { byCountry, byId };
}

export function findLocker(c: Catalogue, source: string, externalId: string): Locker | undefined {
  return c.byId.get(key(source, externalId));
}

export function networksInCountry(c: Catalogue, countryCode: string): string[] {
  return [...new Set((c.byCountry.get(countryCode) ?? []).map((e) => e.locker.network))].sort();
}

export function networkCounts(c: Catalogue, countries: string[]) {
  const counts = new Map<string, { network: string; countryCode: string; count: number }>();
  for (const countryCode of new Set(countries)) {
    for (const { locker } of c.byCountry.get(countryCode) ?? []) {
      const k = `${countryCode}:${locker.network}`;
      const row = counts.get(k) ?? { network: locker.network, countryCode, count: 0 };
      row.count++;
      counts.set(k, row);
    }
  }
  return [...counts.values()];
}

/**
 * Approximate a postcode's position as the centre of lockers sharing the longest
 * postcode prefix (all networks; some carry non-postal zips).
 */
export function locateZip(c: Catalogue, countryCode: string, zip: string | null | undefined): Point | null {
  const z = normalizeZip(zip);
  const entries = c.byCountry.get(countryCode) ?? [];
  for (let len = z.length; len >= 2; len--) {
    const prefix = z.slice(0, len);
    let lat = 0;
    let lng = 0;
    let n = 0;
    for (const e of entries) {
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
  country: string;
  networks?: string[];
  q?: string | null;
  zip?: string | null;
  near?: Point | null;
  limit?: number;
}

/** Lockers matching every word of `q`, nearest to `near`/`zip` first, else alphabetical. */
export function searchLockers(c: Catalogue, options: SearchOptions): LockerResult[] {
  const from = options.near ?? (options.zip ? locateZip(c, options.country, options.zip) : null);
  const networks = options.networks?.length ? new Set(options.networks) : null;
  const words = fold(options.q ?? "").split(/[\s,]+/).filter(Boolean);
  const matches = (c.byCountry.get(options.country) ?? []).filter(
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
export function lockerPoints(c: Catalogue, country: string, networks: string[]) {
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  return (c.byCountry.get(country) ?? [])
    .filter((e) => networks.includes(e.locker.network))
    .map(({ locker: l }) => [key(l.source, l.externalId), round(l.lat), round(l.lng), networks.indexOf(l.network)] as const);
}
