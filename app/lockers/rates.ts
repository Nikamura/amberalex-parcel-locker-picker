import { locateBuyer, nearestPerNetwork } from "./nearest";
import { encodeServiceCode } from "./service-code";
import { networkSettings, type Settings } from "./settings";
import type { Locker } from "./types";

// Shapes of Shopify's carrier service callback.
export interface RateRequest {
  rate: {
    destination: {
      country: string;
      postal_code?: string | null;
      city?: string | null;
    };
    items: Array<{ price: number; quantity: number; requires_shipping?: boolean }>;
    currency: string;
  };
}

export interface Rate {
  service_name: string;
  service_code: string;
  total_price: string;
  currency: string;
  description: string;
}

/** `lockers` must already be limited to the destination country. */
export function buildRates(
  request: RateRequest,
  settings: Settings,
  lockers: Locker[],
  currency: string,
): Rate[] {
  const { destination, items } = request.rate;
  if (!settings.enabled || !settings.countries.includes(destination.country)) return [];

  const enabled = lockers.filter((l) => networkSettings(settings, l.network).enabled);
  const from = locateBuyer(lockers, { zip: destination.postal_code, city: destination.city });
  if (!from || enabled.length === 0) return [];

  const subtotalMinor = items
    .filter((i) => i.requires_shipping !== false)
    .reduce((sum, i) => sum + i.price * i.quantity, 0);
  const free =
    settings.freeShippingOver !== null && subtotalMinor >= Math.round(settings.freeShippingOver * 100);

  return nearestPerNetwork(enabled, from, Math.max(1, settings.perNetwork)).map((l) => {
    const network = networkSettings(settings, l.network);
    return {
      service_name: `${network.label} – ${l.name}`,
      service_code: encodeServiceCode(l),
      total_price: String(free ? 0 : Math.round(network.price * 100)),
      currency,
      description: `${l.address}, ${l.city}`,
    };
  });
}
