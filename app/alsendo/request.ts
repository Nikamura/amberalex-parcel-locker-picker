import type { AlsendoSettings } from "../lockers/settings";
import type { Locker } from "../lockers/types";

// Builds the body of Alsendo's POST /api/v1/orders for a locker order.
// Docs: https://www.alsendo.lt/api-docs (OpenAPI at /api-docs/openapi).

/** Alsendo country ids (GET /countries). */
export const ALSENDO_COUNTRY_IDS: Record<string, number> = { LT: 122, LV: 115, EE: 51 };
const SENDER_COUNTRY = "LT";

export interface ShipmentOrder {
  name: string;
  email: string | null;
  phone: string | null;
  receiverName: string | null;
  receiverPhone: string | null;
  /** Grams, from the order. */
  totalWeight: number | null;
}

export interface AlsendoAddress {
  country_id: number;
  shipping_type: "courier" | "terminal";
  company_name?: string;
  contact_name: string;
  street?: string;
  city?: string;
  zipcode?: string;
  phone: string;
  email?: string;
  terminal_id?: string;
}

export interface AlsendoOrderRequest {
  service_code: string;
  reference: string;
  sender: AlsendoAddress;
  receiver: AlsendoAddress;
  parcels: Array<{ x: number; y: number; z: number; weight: number; amount: number }>;
}

/** Strips formatting and turns Lithuanian 8-6xx / 370… numbers into +370…. */
export function normalizePhone(raw: string | null | undefined, countryCode: string): string | null {
  if (!raw) return null;
  let phone = raw.replace(/[\s()./-]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  if (countryCode === "LT") {
    if (/^8\d{8}$/.test(phone)) phone = `+370${phone.slice(1)}`;
    else if (/^370\d{8}$/.test(phone)) phone = `+${phone}`;
    else if (/^6\d{7}$/.test(phone)) phone = `+370${phone}`;
  }
  return phone || null;
}

const SENDER_REQUIRED: Array<[keyof AlsendoSettings["sender"], string]> = [
  ["contactName", "contact name"],
  ["street", "street"],
  ["city", "city"],
  ["zip", "postcode"],
  ["phone", "phone"],
];

/** What is missing before shipments can be created, as short phrases; empty when ready. */
export function missingSenderFields(settings: AlsendoSettings): string[] {
  return SENDER_REQUIRED.filter(([key]) => !settings.sender[key].trim()).map(([, label]) => label);
}

export function serviceCodeFor(settings: AlsendoSettings, network: string): string | null {
  return settings.services[network]?.trim() || null;
}

export type BuildResult = { ok: true; body: AlsendoOrderRequest } | { ok: false; error: string };

export function buildOrderRequest(settings: AlsendoSettings, locker: Locker, order: ShipmentOrder): BuildResult {
  if (locker.source !== "alsendo") return { ok: false, error: `Locker ${locker.source}:${locker.externalId} is not an Alsendo terminal` };
  const serviceCode = serviceCodeFor(settings, locker.network);
  if (!serviceCode) return { ok: false, error: `No Alsendo service set for ${locker.network} lockers` };
  const countryId = ALSENDO_COUNTRY_IDS[locker.countryCode];
  if (!countryId) return { ok: false, error: `Alsendo shipments to ${locker.countryCode} are not supported` };
  const missing = missingSenderFields(settings);
  if (missing.length) return { ok: false, error: `Sender ${missing.join(", ")} missing in settings` };

  const receiverPhone = normalizePhone(order.receiverPhone ?? order.phone, locker.countryCode);
  if (!receiverPhone) return { ok: false, error: "The order has no phone number for the locker SMS" };
  const receiverName = order.receiverName?.trim() || order.email || order.name;

  const { sender, parcel } = settings;
  const orderKg = order.totalWeight && order.totalWeight > 0 ? order.totalWeight / 1000 : null;
  const weight = Math.max(0.1, Math.round((orderKg ?? parcel.weight) * 100) / 100);

  return {
    ok: true,
    body: {
      service_code: serviceCode,
      reference: order.name,
      sender: {
        country_id: ALSENDO_COUNTRY_IDS[SENDER_COUNTRY],
        shipping_type: "courier",
        ...(sender.companyName.trim() ? { company_name: sender.companyName.trim() } : {}),
        contact_name: sender.contactName.trim(),
        street: sender.street.trim(),
        city: sender.city.trim(),
        zipcode: sender.zip.trim(),
        phone: normalizePhone(sender.phone, SENDER_COUNTRY) ?? sender.phone.trim(),
        ...(sender.email.trim() ? { email: sender.email.trim() } : {}),
      },
      receiver: {
        country_id: countryId,
        shipping_type: "terminal",
        terminal_id: locker.externalId,
        contact_name: receiverName,
        phone: receiverPhone,
        ...(order.email ? { email: order.email } : {}),
      },
      parcels: [{ x: parcel.x, y: parcel.y, z: parcel.z, weight, amount: 1 }],
    },
  };
}
