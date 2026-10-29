import { carrierLogoKey, detectBrand } from "./brands";
import { formatLockerId } from "./service-code";
import type { Locker } from "./types";

export interface LockerResult {
  id: string;
  network: string;
  name: string;
  address: string;
  city: string;
  zip: string;
  lat: number;
  lng: number;
  /** Shop chain hosting the locker, e.g. "maxima"; logo at /logos/brand-<brand>.png. */
  brand?: string;
  /** Carrier logo key; logo at /logos/carrier-<carrierLogo>.png. */
  carrierLogo?: string;
  /** Kilometres from the searched postcode or point, when one was given. */
  distanceKm?: number;
}

export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Text stored in lockers.search for word matching. */
export function searchText(l: Pick<Locker, "name" | "address" | "city" | "zip">): string {
  return fold(`${l.name} ${l.address} ${l.city} ${l.zip}`);
}

export function toResult(l: Locker): LockerResult {
  const result: LockerResult = {
    id: formatLockerId(l),
    network: l.network,
    name: l.name,
    address: l.address,
    city: l.city,
    zip: l.zip,
    lat: l.lat,
    lng: l.lng,
  };
  const brand = detectBrand(l.name);
  if (brand) result.brand = brand;
  const carrierLogo = carrierLogoKey(l.network);
  if (carrierLogo) result.carrierLogo = carrierLogo;
  return result;
}
