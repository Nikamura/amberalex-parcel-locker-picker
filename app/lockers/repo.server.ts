import { and, asc, eq, inArray, like, sql, type SQL } from "drizzle-orm";
import db from "../db.server";
import { lockers, shopSettings, syncRuns } from "../db/schema";
import { distanceKm, normalizeZip, type Point } from "./nearest";
import { fold, toResult, type LockerResult } from "./search";
import { defaultSettings, type Settings } from "./settings";
import type { Locker } from "./types";

export async function findLocker(source: string, externalId: string): Promise<Locker | undefined> {
  return db
    .select()
    .from(lockers)
    .where(and(eq(lockers.source, source), eq(lockers.externalId, externalId)))
    .get();
}

export async function networksInCountry(countryCode: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ network: lockers.network })
    .from(lockers)
    .where(eq(lockers.countryCode, countryCode))
    .all();
  return rows.map((r) => r.network).sort();
}

export async function networkCounts(countries: string[]) {
  if (countries.length === 0) return [];
  return db
    .select({ network: lockers.network, countryCode: lockers.countryCode, count: sql<number>`count(*)` })
    .from(lockers)
    .where(inArray(lockers.countryCode, countries))
    .groupBy(lockers.network, lockers.countryCode)
    .all();
}

/**
 * Approximate a postcode's position as the centre of lockers sharing the longest
 * postcode prefix (all networks; some carry non-postal zips).
 */
export async function locateZip(countryCode: string, zip: string | null | undefined): Promise<Point | null> {
  const z = normalizeZip(zip);
  for (let len = z.length; len >= 2; len--) {
    const row = await db
      .select({ lat: sql<number>`avg(${lockers.lat})`, lng: sql<number>`avg(${lockers.lng})`, n: sql<number>`count(*)` })
      .from(lockers)
      .where(and(eq(lockers.countryCode, countryCode), like(lockers.zip, `${z.slice(0, len)}%`)))
      .get();
    if (row && row.n > 0) return { lat: row.lat, lng: row.lng };
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
export async function searchLockers(options: SearchOptions): Promise<LockerResult[]> {
  const from = options.near ?? (options.zip ? await locateZip(options.country, options.zip) : null);
  const where: SQL[] = [eq(lockers.countryCode, options.country)];
  if (options.networks?.length) where.push(inArray(lockers.network, options.networks));
  for (const word of fold(options.q ?? "").split(/[\s,]+/).filter(Boolean)) {
    where.push(like(lockers.search, `%${word}%`));
  }

  const query = db.select().from(lockers).where(and(...where));
  const ordered = from
    ? query.orderBy(
        // Equirectangular approximation, good enough for ranking within a country.
        sql`(${lockers.lat} - ${from.lat}) * (${lockers.lat} - ${from.lat}) + ((${lockers.lng} - ${from.lng}) * ${Math.cos((from.lat * Math.PI) / 180)}) * ((${lockers.lng} - ${from.lng}) * ${Math.cos((from.lat * Math.PI) / 180)})`,
      )
    : query.orderBy(asc(lockers.city), asc(lockers.name));
  const rows = await ordered.limit(Math.min(50, options.limit ?? 30)).all();

  return rows.map((l) => {
    const result = toResult(l);
    if (from) result.distanceKm = Math.round(distanceKm(from, l) * 10) / 10;
    return result;
  });
}

export async function lastSyncs() {
  return db.select().from(syncRuns).all();
}

export async function getShopSettings(shop: string) {
  const row = await db.select().from(shopSettings).where(eq(shopSettings.shop, shop)).get();
  return {
    settings: { ...defaultSettings(), ...((row?.settings as Partial<Settings>) ?? {}) },
    carrierServiceId: row?.carrierServiceId ?? null,
    currency: row?.currency ?? null,
  };
}

export async function saveShopSettings(
  shop: string,
  values: { settings: Settings; carrierServiceId?: string | null; currency?: string | null },
) {
  const row = { shop, ...values, updatedAt: new Date().toISOString() };
  await db.insert(shopSettings).values(row).onConflictDoUpdate({ target: shopSettings.shop, set: row }).run();
}

export async function deleteShopSettings(shop: string) {
  await db.delete(shopSettings).where(eq(shopSettings.shop, shop)).run();
}

/** Every locker of the given networks as [id, lat, lng, networkIndex], for map markers. */
export async function lockerPoints(country: string, networks: string[]) {
  const rows = await db
    .select({ source: lockers.source, externalId: lockers.externalId, network: lockers.network, lat: lockers.lat, lng: lockers.lng })
    .from(lockers)
    .where(and(eq(lockers.countryCode, country), inArray(lockers.network, networks)))
    .all();
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  return rows.map((r) => [`${r.source}:${r.externalId}`, round(r.lat), round(r.lng), networks.indexOf(r.network)] as const);
}
