import { decodeServiceCode, type LockerRef } from "./service-code";
import { networkSettings, type Settings } from "./settings";
import type { Locker } from "./types";

// Subset of the orders/create webhook payload we use.
export interface OrderPayload {
  admin_graphql_api_id: string;
  shipping_lines?: Array<{ code?: string | null }>;
  note_attributes?: Array<{ name: string; value: string }>;
  shipping_address?: {
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    country_code?: string | null;
  } | null;
}

export const ATTR_LOCKER = "Parcel locker";
export const ATTR_LOCKER_ID = "Parcel locker ID";

export function lockerRefFromOrder(order: OrderPayload): LockerRef | null {
  for (const line of order.shipping_lines ?? []) {
    const ref = decodeServiceCode(line.code);
    if (ref) return ref;
  }
  return null;
}

/** Builds the OrderInput for orderUpdate. */
export function buildOrderInput(order: OrderPayload, locker: Locker, settings: Settings) {
  const label = networkSettings(settings, locker.network).label;
  const attributes = (order.note_attributes ?? []).filter(
    (a) => a.name !== ATTR_LOCKER && a.name !== ATTR_LOCKER_ID,
  );
  attributes.push(
    { name: ATTR_LOCKER, value: `${label} – ${locker.name}, ${locker.address}, ${locker.city} ${locker.zip}` },
    { name: ATTR_LOCKER_ID, value: `${locker.source}:${locker.externalId}` },
  );

  const input: Record<string, unknown> = {
    id: order.admin_graphql_api_id,
    customAttributes: attributes.map(({ name, value }) => ({ key: name, value })),
    metafields: [
      {
        namespace: "$app",
        key: "parcel_locker",
        type: "json",
        value: JSON.stringify({
          source: locker.source,
          id: locker.externalId,
          network: locker.network,
          label,
          name: locker.name,
          address: locker.address,
          city: locker.city,
          zip: locker.zip,
          countryCode: locker.countryCode,
        }),
      },
    ],
  };

  if (settings.overwriteShippingAddress) {
    const buyer = order.shipping_address ?? {};
    input.shippingAddress = {
      firstName: buyer.first_name ?? undefined,
      lastName: buyer.last_name ?? undefined,
      phone: buyer.phone ?? undefined,
      company: `${label} ${locker.externalId}`,
      address1: locker.name,
      address2: locker.address,
      city: locker.city,
      zip: locker.zip,
      countryCode: locker.countryCode,
    };
  }
  return input;
}
