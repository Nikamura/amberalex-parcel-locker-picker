import { decodeServiceCode, formatLockerId, type ServiceChoice } from "./service-code";
import { ANY_NETWORK, networkSettings, type Settings } from "./settings";
import type { Locker } from "./types";

export const ATTR_LOCKER = "Parcel locker";
export const ATTR_LOCKER_ID = "Parcel locker ID";
export const PENDING_TAG = "locker-pending";

/** The parts of an order needed to record a locker, from a webhook or the Admin API. */
export interface OrderSnapshot {
  id: string;
  attributes: Array<{ name: string; value: string }>;
  buyer: { firstName?: string | null; lastName?: string | null; phone?: string | null };
}

// Subset of the orders/create webhook payload we use.
export interface OrderPayload {
  admin_graphql_api_id: string;
  shipping_lines?: Array<{ code?: string | null }>;
  note_attributes?: Array<{ name: string; value: string }>;
  shipping_address?: { first_name?: string | null; last_name?: string | null; phone?: string | null } | null;
}

export function snapshotFromWebhook(order: OrderPayload): OrderSnapshot {
  return {
    id: order.admin_graphql_api_id,
    attributes: order.note_attributes ?? [],
    buyer: {
      firstName: order.shipping_address?.first_name,
      lastName: order.shipping_address?.last_name,
      phone: order.shipping_address?.phone,
    },
  };
}

export function choiceFromShippingCodes(codes: Array<string | null | undefined>): ServiceChoice | null {
  for (const code of codes) {
    const choice = decodeServiceCode(code);
    if (choice) return choice;
  }
  return null;
}

function attributesWith(order: OrderSnapshot, extra: Array<{ name: string; value: string }>) {
  return [
    ...order.attributes.filter((a) => a.name !== ATTR_LOCKER && a.name !== ATTR_LOCKER_ID),
    ...extra,
  ].map(({ name, value }) => ({ key: name, value }));
}

function metafield(value: object) {
  return [{ namespace: "$app", key: "parcel_locker", type: "json", value: JSON.stringify(value) }];
}

/** OrderInput for orderUpdate once a specific locker is known. */
export function buildOrderInput(order: OrderSnapshot, locker: Locker, settings: Settings) {
  const label = networkSettings(settings, locker.network).label;
  const input: Record<string, unknown> = {
    id: order.id,
    customAttributes: attributesWith(order, [
      { name: ATTR_LOCKER, value: `${label} – ${locker.name}, ${locker.address}, ${locker.city} ${locker.zip}` },
      { name: ATTR_LOCKER_ID, value: formatLockerId(locker) },
    ]),
    metafields: metafield({
      status: "chosen",
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
  };

  if (settings.overwriteShippingAddress) {
    input.shippingAddress = {
      firstName: order.buyer.firstName ?? undefined,
      lastName: order.buyer.lastName ?? undefined,
      phone: order.buyer.phone ?? undefined,
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

/** OrderInput for an order whose buyer will choose the locker after payment. */
export function buildPendingOrderInput(order: OrderSnapshot, network: string, settings: Settings) {
  const label = network === ANY_NETWORK ? settings.combinedLabel : networkSettings(settings, network).label;
  return {
    id: order.id,
    customAttributes: attributesWith(order, [{ name: ATTR_LOCKER, value: `${label}: not chosen yet` }]),
    metafields: metafield({ status: "pending", network, label }),
  };
}
