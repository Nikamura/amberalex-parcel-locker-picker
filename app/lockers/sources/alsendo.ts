import { fixSwappedCoordinates } from "../coordinates";
import type { Locker, LockerSource } from "../types";

// Public, unauthenticated list served by Alsendo (formerly Siusk24).
// Its `id` is the terminal id expected by Alsendo's POST /orders.
const URL = "https://www.alsendo.lt/api/v1/parcel_machines";

interface AlsendoMachine {
  id: number;
  name: string;
  city: string | null;
  country_code: string;
  address: string | null;
  zip: string | null;
  x_cord: string | null;
  y_cord: string | null;
  comment: string | null;
  deleted_at: string | null;
  identifier: string;
  updated_at: string;
}

// "LpPost" is a stale copy of the LP Express list (last updated August 2025);
// 322 of its 332 lockers duplicate the maintained "lp_post" list.
const STALE_NETWORKS = new Set(["LpPost"]);

export function parseAlsendo(body: unknown): Locker[] {
  const machines = (body as { result?: { parcel_machines?: AlsendoMachine[] } })?.result
    ?.parcel_machines;
  if (!Array.isArray(machines)) throw new Error("Unexpected Alsendo response shape");
  const lockers = machines
    .filter((m) => !m.deleted_at && m.x_cord && m.y_cord && !STALE_NETWORKS.has(m.identifier))
    .map((m) => ({
      source: "alsendo",
      externalId: String(m.id),
      network: m.identifier,
      countryCode: m.country_code,
      name: m.name.trim(),
      address: (m.address ?? "").trim(),
      city: (m.city ?? "").trim(),
      zip: (m.zip ?? "").trim(),
      // Alsendo normally stores latitude in x_cord and longitude in y_cord.
      lat: Number(m.x_cord),
      lng: Number(m.y_cord),
      comment: m.comment?.trim() || null,
    }))
    .filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng));
  // Some networks (e.g. lp_post) arrive with the two coordinates swapped.
  return fixSwappedCoordinates(lockers);
}

export const alsendoSource: LockerSource = {
  id: "alsendo",
  async fetchLockers() {
    const res = await fetch(URL, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Alsendo responded ${res.status}`);
    return parseAlsendo(await res.json());
  },
};
