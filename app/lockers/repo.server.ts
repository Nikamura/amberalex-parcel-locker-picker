import { eq, sql } from "drizzle-orm";
import db from "../db.server";
import { lockerSnapshot, lockers, shopSettings, syncRuns } from "../db/schema";
import * as cat from "./catalogue";
import { buildCatalogue, fromSnapshot, type Catalogue, type SearchOptions } from "./catalogue";
import type { LockerResult } from "./search";
import { defaultSettings, type Settings } from "./settings";
import type { Locker } from "./types";

const CHECK_EVERY_MS = 5 * 60 * 1000;

let cached: { version: string; catalogue: Catalogue } | null = null;
let checkedAt = 0;
let pending: Promise<Catalogue> | null = null;

async function load(): Promise<Catalogue> {
  const head = await db.select({ version: sql<string | null>`max(${lockerSnapshot.version})` }).from(lockerSnapshot).get();
  const version = head?.version ?? null;
  if (cached && cached.version === version) return cached.catalogue;
  // No snapshot yet (before the first sync after this table appeared): read the table once.
  const list = version
    ? fromSnapshot(await db.select({ countryCode: lockerSnapshot.countryCode, data: lockerSnapshot.data }).from(lockerSnapshot).all())
    : await db.select().from(lockers).all();
  cached = { version: version ?? "", catalogue: buildCatalogue(list) };
  return cached.catalogue;
}

/** The in-memory catalogue, re-checked against D1 at most every few minutes. */
async function catalogue(): Promise<Catalogue> {
  if (cached && Date.now() - checkedAt < CHECK_EVERY_MS) return cached.catalogue;
  pending ??= load()
    .then((c) => {
      checkedAt = Date.now();
      return c;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export async function findLocker(source: string, externalId: string): Promise<Locker | undefined> {
  return cat.findLocker(await catalogue(), source, externalId);
}

export async function networksInCountry(countryCode: string): Promise<string[]> {
  return cat.networksInCountry(await catalogue(), countryCode);
}

export async function networkCounts(countries: string[]) {
  return cat.networkCounts(await catalogue(), countries);
}

/** Lockers matching every word of `q`, nearest to `near`/`zip` first, else alphabetical. */
export async function searchLockers(options: SearchOptions): Promise<LockerResult[]> {
  return cat.searchLockers(await catalogue(), options);
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
  return cat.lockerPoints(await catalogue(), country, networks);
}
