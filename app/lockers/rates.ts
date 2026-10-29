import { encodeNetworkCode, encodeServiceCode } from "./service-code";
import { ANY_NETWORK, combinedPrice, networkSettings, type Settings } from "./settings";
import type { Locker } from "./types";

/** Hidden cart line property set by the cart-page picker. */
export const CART_LOCKER_PROPERTY = "_plp_locker";

// Shapes of Shopify's carrier service callback.
export interface RateRequest {
  rate: {
    destination: {
      country: string;
      postal_code?: string | null;
      city?: string | null;
      name?: string | null;
      company_name?: string | null;
      address1?: string | null;
      address2?: string | null;
    };
    items: Array<{
      price: number;
      quantity: number;
      requires_shipping?: boolean;
      properties?: Record<string, string> | null;
    }>;
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

function matchesTestMarker(destination: RateRequest["rate"]["destination"], marker: string) {
  const needle = marker.trim().toLowerCase();
  return [destination.name, destination.company_name, destination.address1, destination.address2].some((v) =>
    v?.toLowerCase().includes(needle),
  );
}

export function cartLockerId(items: RateRequest["rate"]["items"]): string | null {
  for (const item of items) {
    const id = item.properties?.[CART_LOCKER_PROPERTY];
    if (id) return id;
  }
  return null;
}

export interface RateInputs {
  /** Locker networks present in the destination country. */
  networks: string[];
  /** The locker picked on the cart page, if it exists in the destination country. */
  chosen?: Locker | null;
}

/**
 * The locker picked on the cart page alone, or otherwise one rate per enabled
 * locker type (or one combined rate) with the locker picked after payment.
 */
export function buildRates(
  request: RateRequest,
  settings: Settings,
  inputs: RateInputs,
  currency: string,
): Rate[] {
  const { destination, items } = request.rate;
  if (!settings.enabled || !settings.countries.includes(destination.country)) return [];
  if (settings.testMarker && !matchesTestMarker(destination, settings.testMarker)) return [];

  const subtotalMinor = items
    .filter((i) => i.requires_shipping !== false)
    .reduce((sum, i) => sum + i.price * i.quantity, 0);
  const free =
    settings.freeShippingOver !== null && subtotalMinor >= Math.round(settings.freeShippingOver * 100);
  const minor = (amount: number) => String(free ? 0 : Math.round(amount * 100));
  const price = (network: string) => minor(networkSettings(settings, network).price);

  const networks = [...new Set(inputs.networks)].filter((n) => networkSettings(settings, n).enabled).sort();
  const rates: Rate[] = [];

  const chosen = inputs.chosen;
  if (chosen && chosen.countryCode === destination.country && networks.includes(chosen.network)) {
    rates.push({
      service_name: `${networkSettings(settings, chosen.network).label} – ${chosen.name}`,
      service_code: encodeServiceCode(chosen),
      total_price: price(chosen.network),
      currency,
      description: [chosen.address, chosen.city].filter(Boolean).join(", "),
    });
    // Only the picked locker: it is then the cheapest option, so checkout selects it.
    return rates;
  }

  if (settings.combineNetworks && networks.length > 0) {
    rates.push({
      service_name: settings.combinedLabel,
      service_code: encodeNetworkCode(ANY_NETWORK),
      total_price: minor(combinedPrice(settings, networks)),
      currency,
      description: settings.chooseLaterText,
    });
    return rates;
  }

  for (const network of networks) {
    rates.push({
      service_name: networkSettings(settings, network).label,
      service_code: encodeNetworkCode(network),
      total_price: price(network),
      currency,
      description: settings.chooseLaterText,
    });
  }
  return rates;
}
