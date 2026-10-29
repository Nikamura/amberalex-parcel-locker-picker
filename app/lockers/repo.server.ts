import { and, eq, sql } from "drizzle-orm";
import db from "../db.server";
import { lockers, shopSettings, syncRuns } from "../db/schema";
import { defaultSettings, type Settings } from "./settings";
import type { Locker, LockerSource } from "./types";
import { alsendoSource } from "./sources/alsendo";

export const sources: LockerSource[] = [alsendoSource];

export async function syncSource(source: LockerSource) {
  const finishedAt = () => new Date().toISOString();
  try {
    const list = await source.fetchLockers();
    const now = finishedAt();
    db.transaction((tx) => {
      tx.delete(lockers).where(eq(lockers.source, source.id)).run();
      for (let i = 0; i < list.length; i += 500) {
        tx.insert(lockers)
          .values(list.slice(i, i + 500).map((l) => ({ ...l, updatedAt: now })))
          .run();
      }
      tx.insert(syncRuns)
        .values({ source: source.id, finishedAt: now, count: list.length, error: null })
        .onConflictDoUpdate({ target: syncRuns.source, set: { finishedAt: now, count: list.length, error: null } })
        .run();
    });
    return list.length;
  } catch (error) {
    // Keep the previous catalogue; just record the failure.
    const message = error instanceof Error ? error.message : String(error);
    db.insert(syncRuns)
      .values({ source: source.id, finishedAt: finishedAt(), count: 0, error: message })
      .onConflictDoUpdate({ target: syncRuns.source, set: { finishedAt: finishedAt(), error: message } })
      .run();
    throw error;
  }
}

export function lockersForCountry(countryCode: string): Locker[] {
  return db.select().from(lockers).where(eq(lockers.countryCode, countryCode)).all();
}

export function findLocker(source: string, externalId: string): Locker | undefined {
  return db
    .select()
    .from(lockers)
    .where(and(eq(lockers.source, source), eq(lockers.externalId, externalId)))
    .get();
}

export function networkCounts(countries: string[]) {
  if (countries.length === 0) return [];
  return db
    .select({ network: lockers.network, countryCode: lockers.countryCode, count: sql<number>`count(*)` })
    .from(lockers)
    .where(sql`${lockers.countryCode} in ${countries}`)
    .groupBy(lockers.network, lockers.countryCode)
    .all();
}

export function lastSyncs() {
  return db.select().from(syncRuns).all();
}

export function getShopSettings(shop: string) {
  const row = db.select().from(shopSettings).where(eq(shopSettings.shop, shop)).get();
  return {
    settings: { ...defaultSettings(), ...((row?.settings as Partial<Settings>) ?? {}) },
    carrierServiceId: row?.carrierServiceId ?? null,
    currency: row?.currency ?? null,
  };
}

export function saveShopSettings(
  shop: string,
  values: { settings: Settings; carrierServiceId?: string | null; currency?: string | null },
) {
  const row = { shop, ...values, updatedAt: new Date().toISOString() };
  db.insert(shopSettings).values(row).onConflictDoUpdate({ target: shopSettings.shop, set: row }).run();
}

export function deleteShopSettings(shop: string) {
  db.delete(shopSettings).where(eq(shopSettings.shop, shop)).run();
}
