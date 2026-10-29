import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { choiceFromShippingCodes, type OrderSnapshot } from "../lockers/order-update";
import { saveChosenLocker } from "../lockers/order-sync.server";
import { findLocker, getShopSettings, lockersForCountry } from "../lockers/repo.server";
import { searchLockers, toResult } from "../lockers/search";
import { parseLockerId } from "../lockers/service-code";
import { networkSettings, type Settings } from "../lockers/settings";

// Lets the buyer choose or change the locker on the thank-you page.
// Auth: checkout session token (dest = shop) plus the order's confirmation number.
// The buyer may switch to any locker type that costs the same or less than the one paid for.

const EDIT_WINDOW_DAYS = 14;

const ORDER_QUERY = `#graphql
  query OrderLocker($id: ID!) {
    order(id: $id) {
      id
      confirmationNumber
      createdAt
      cancelledAt
      displayFulfillmentStatus
      shippingLine { code }
      shippingAddress { firstName lastName phone zip countryCodeV2 }
      customAttributes { key value }
    }
  }`;

interface AdminOrder {
  id: string;
  confirmationNumber: string | null;
  createdAt: string;
  cancelledAt: string | null;
  displayFulfillmentStatus: string;
  shippingLine: { code: string | null } | null;
  shippingAddress: { firstName: string | null; lastName: string | null; phone: string | null; zip: string | null; countryCodeV2: string } | null;
  customAttributes: Array<{ key: string; value: string | null }>;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function loadOrder(shop: string, orderId: string, number: string) {
  const { admin } = await unauthenticated.admin(shop);
  const res = await admin.graphql(ORDER_QUERY, { variables: { id: orderId } });
  const body = await res.json();
  const order = body.data?.order as AdminOrder | null;
  // Same answer for "no such order" and "wrong number" so ids can't be probed.
  if (!order || !number || order.confirmationNumber !== number) throw new HttpError(404, "order not found");
  return { admin, order };
}

/** Locker types the buyer may switch to: any enabled type that costs the same or less than what they paid. */
function allowedNetworks(settings: Settings, country: string, paidNetwork: string) {
  const present = new Set(lockersForCountry(country).map((l) => l.network));
  const paidPrice = networkSettings(settings, paidNetwork).price;
  return [...present]
    .filter((n) => networkSettings(settings, n).enabled && networkSettings(settings, n).price <= paidPrice)
    .sort()
    .map((network) => ({ network, label: networkSettings(settings, network).label }));
}

function describe(shop: string, order: AdminOrder) {
  const { settings } = getShopSettings(shop);
  const choice = choiceFromShippingCodes([order.shippingLine?.code]);
  if (!choice) return null;

  const currentId = order.customAttributes.find((a) => a.key === "Parcel locker ID")?.value;
  const currentRef = parseLockerId(currentId ?? null);
  const current = currentRef ? findLocker(currentRef.source, currentRef.externalId) : undefined;
  const paidNetwork = choice.kind === "network" ? choice.network : current?.network ?? findLocker(choice.source, choice.externalId)?.network;
  const country = order.shippingAddress?.countryCodeV2 ?? settings.countries[0];
  const ageDays = (Date.now() - Date.parse(order.createdAt)) / 86_400_000;
  const editable =
    !order.cancelledAt && order.displayFulfillmentStatus === "UNFULFILLED" && ageDays <= EDIT_WINDOW_DAYS;

  return {
    settings,
    country,
    paidNetwork,
    current,
    response: {
      applicable: true,
      editable,
      country,
      zip: order.shippingAddress?.zip ?? null,
      current: current ? toResult(current) : null,
      networks: paidNetwork ? allowedNetworks(settings, country, paidNetwork) : [],
      paidNetwork: paidNetwork ?? null,
    },
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.public.checkout(request);
  const shop = new URL(sessionToken.dest).hostname;
  const url = new URL(request.url);
  try {
    const { order } = await loadOrder(shop, url.searchParams.get("orderId") ?? "", url.searchParams.get("number") ?? "");
    const info = describe(shop, order);
    if (!info) return cors(Response.json({ applicable: false }));
    const suggestions = info.paidNetwork
      ? searchLockers(
          lockersForCountry(info.country).filter((l) => info.response.networks.some((n) => n.network === l.network)),
          { zip: info.response.zip, limit: 10 },
        )
      : [];
    return cors(Response.json({ ...info.response, suggestions }));
  } catch (error) {
    if (error instanceof HttpError) return cors(Response.json({ error: error.message }, { status: error.status }));
    throw error;
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.public.checkout(request);
  const shop = new URL(sessionToken.dest).hostname;
  try {
    const body = (await request.json()) as { orderId?: string; number?: string; lockerId?: string };
    const { admin, order } = await loadOrder(shop, body.orderId ?? "", body.number ?? "");
    const info = describe(shop, order);
    if (!info) throw new HttpError(400, "order has no parcel locker delivery");
    if (!info.response.editable) throw new HttpError(409, "order can no longer be changed");

    const ref = parseLockerId(body.lockerId ?? null);
    const locker = ref ? findLocker(ref.source, ref.externalId) : undefined;
    if (!locker || locker.countryCode !== info.country) throw new HttpError(400, "unknown locker");
    if (!info.response.networks.some((n) => n.network === locker.network)) throw new HttpError(400, "locker type not allowed");

    const snapshot: OrderSnapshot = {
      id: order.id,
      attributes: order.customAttributes.map((a) => ({ name: a.key, value: a.value ?? "" })),
      buyer: {
        firstName: order.shippingAddress?.firstName,
        lastName: order.shippingAddress?.lastName,
        phone: order.shippingAddress?.phone,
      },
    };
    await saveChosenLocker(admin, snapshot, locker, info.settings);
    return cors(Response.json({ ok: true, current: toResult(locker) }));
  } catch (error) {
    if (error instanceof HttpError) return cors(Response.json({ error: error.message }, { status: error.status }));
    console.error("[order-locker] save failed", error);
    return cors(Response.json({ error: "could not save" }, { status: 500 }));
  }
};
