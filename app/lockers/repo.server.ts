import { and, eq, sql } from "drizzle-orm";
import db from "../db.server";
import { lockerSnapshot, lockers, shopSettings, syncRuns } from "../db/schema";
import * as cat from "./catalogue";
import { parseSnapshot, toCountry, type Country, type SearchOptions } from "./catalogue";
import type { LockerResult } from "./search";
import { defaultSettings, type Settings } from "./settings";
import type { Locker } from "./types";

const CHECK_EVERY_MS = 5 * 60 * 1000;

let version: string | null | undefined;
let checkedAt = 0;
let checking: Promise<void> | null = null;
const countries = new Map<string, Promise<Country>>();

/** Drops cached countries once a newer sync has landed; costs one tiny query every few minutes. */
async function checkVersion() {
  if (version !== undefined && Date.now() - checkedAt < CHECK_EVERY_MS) return;
  checking ??= db
    .select({ version: sql<string | null>`max(${lockerSnapshot.version})` })
    .from(lockerSnapshot)
    .get()
    .then((row) => {
      const latest = row?.version ?? null;
      if (latest !== version) countries.clear();
      version = latest;
      checkedAt = Date.now();
    })
    .finally(() => {
      checking = null;
    });
  return checking;
}

async function loadCountry(code: string): Promise<Country> {
  if (version) {
    const row = await db.select({ data: lockerSnapshot.data }).from(lockerSnapshot).where(eq(lockerSnapshot.countryCode, code)).get();
    return row ? parseSnapshot(code, row.data) : [];
  }
  // No snapshot yet (before the first sync after this table appeared).
  return toCountry(await db.select().from(lockers).where(eq(lockers.countryCode, code)).all());
}

/** A country's lockers from Worker memory, loaded from D1 on first use. */
async function country(code: string): Promise<Country> {
  await checkVersion();
  let pending = countries.get(code);
  if (!pending) {
    pending = loadCountry(code);
    countries.set(code, pending);
    pending.catch(() => countries.delete(code));
  }
  return pending;
}

/** Primary-key lookup: one row read, no need to load the country. */
export async function findLocker(source: string, externalId: string): Promise<Locker | undefined> {
  return db
    .select()
    .from(lockers)
    .where(and(eq(lockers.source, source), eq(lockers.externalId, externalId)))
    .get();
}

export async function networksInCountry(countryCode: string): Promise<string[]> {
  return cat.networksInCountry(await country(countryCode));
}

export async function networkCounts(countryCodes: string[]) {
  const unique = [...new Set(countryCodes)];
  const lists = await Promise.all(unique.map(country));
  return unique.flatMap((countryCode, i) => cat.networkCounts(lists[i]).map((c) => ({ ...c, countryCode })));
}

/** Lockers matching every word of `q`, nearest to `near`/`zip` first, else alphabetical. */
export async function searchLockers(options: SearchOptions & { country: string }): Promise<LockerResult[]> {
  return cat.searchLockers(await country(options.country), options);
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
export async function lockerPoints(countryCode: string, networks: string[]) {
  return cat.lockerPoints(await country(countryCode), networks);
}
