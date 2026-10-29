import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { choiceFromShippingCodes, type OrderSnapshot } from "../lockers/order-update";
import { saveChosenLocker } from "../lockers/order-sync.server";
import { findLocker, getShopSettings, networksInCountry, searchLockers } from "../lockers/repo.server";
import { toResult } from "../lockers/search";
import { parseLockerId } from "../lockers/service-code";
import { carrierLogoKey } from "../lockers/brands";
import { ANY_NETWORK, combinedPrice, networkSettings, networkShort, type Settings } from "../lockers/settings";

// Lets the buyer choose the locker on the thank-you page if the order has none yet.
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

/** Session token `dest` may be a bare host or a URL. */
function shopFromDest(dest: string) {
  return dest.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

/** The thank-you page exposes OrderIdentity gids; the Admin API wants Order gids. */
function toAdminOrderId(id: string) {
  return id.replace(/^gid:\/\/shopify\/OrderIdentity\//, "gid://shopify/Order/");
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function loadOrder(shop: string, orderId: string, number: string) {
  const { admin } = await unauthenticated.admin(shop);
  const res = await admin.graphql(ORDER_QUERY, { variables: { id: toAdminOrderId(orderId) } });
  const body = await res.json();
  const order = body.data?.order as AdminOrder | null;
  // Same answer for "no such order" and "wrong number" so ids can't be probed.
  if (!order || !number || order.confirmationNumber !== number) throw new HttpError(404, "order not found");
  return { admin, order };
}

/** Locker types the buyer may switch to: any enabled type that costs the same or less than what they paid. */
async function allowedNetworks(settings: Settings, country: string, paidNetwork: string) {
  const enabled = (await networksInCountry(country)).filter((n) => networkSettings(settings, n).enabled);
  const paidPrice =
    paidNetwork === ANY_NETWORK ? combinedPrice(settings, enabled) : networkSettings(settings, paidNetwork).price;
  return enabled
    .filter((n) => networkSettings(settings, n).price <= paidPrice)
    .sort()
    .map((network) => ({ network, label: networkSettings(settings, network).label, short: networkShort(network), carrierLogo: carrierLogoKey(network) }));
}

async function describe(shop: string, order: AdminOrder) {
  const { settings } = await getShopSettings(shop);
  const choice = choiceFromShippingCodes([order.shippingLine?.code]);
  if (!choice) return null;

  const currentId = order.customAttributes.find((a) => a.key === "Parcel locker ID")?.value;
  const currentRef = parseLockerId(currentId ?? null);
  // The orders/create webhook may not have saved the locker yet when the thank-you
  // page loads; a locker picked before checkout is already in the shipping line.
  const current = currentRef
    ? await findLocker(currentRef.source, currentRef.externalId)
    : choice.kind === "locker"
      ? await findLocker(choice.source, choice.externalId)
      : undefined;
  const paidNetwork =
    choice.kind === "network"
      ? choice.network
      : current?.network ?? (await findLocker(choice.source, choice.externalId))?.network;
  const country = order.shippingAddress?.countryCodeV2 ?? settings.countries[0];
  const ageDays = (Date.now() - Date.parse(order.createdAt)) / 86_400_000;
  // The buyer can only fill in a missing locker (draft orders, or skipped the
  // cart picker). A chosen locker is final here; changes go through the shop.
  const editable =
    !order.cancelledAt && order.displayFulfillmentStatus === "UNFULFILLED" && ageDays <= EDIT_WINDOW_DAYS &&
    !current;

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
      networks: paidNetwork ? await allowedNetworks(settings, country, paidNetwork) : [],
      paidNetwork: paidNetwork ?? null,
    },
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.public.checkout(request);
  const shop = shopFromDest(sessionToken.dest);
  const url = new URL(request.url);
  try {
    const { order } = await loadOrder(shop, url.searchParams.get("orderId") ?? "", url.searchParams.get("number") ?? "");
    const info = await describe(shop, order);
    if (!info) return cors(Response.json({ applicable: false }));
    const suggestNetwork =
      info.response.current?.network ??
      (info.paidNetwork === ANY_NETWORK ? info.response.networks[0]?.network : info.paidNetwork);
    const suggestions = suggestNetwork
      ? await searchLockers({ country: info.country, networks: [suggestNetwork], zip: info.response.zip, limit: 10 })
      : [];
    return cors(Response.json({ ...info.response, suggestions }));
  } catch (error) {
    if (error instanceof HttpError) return cors(Response.json({ error: error.message }, { status: error.status }));
    console.error("[order-locker] load failed", error);
    return cors(Response.json({ error: "could not load" }, { status: 500 }));
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.public.checkout(request);
  const shop = shopFromDest(sessionToken.dest);
  try {
    const body = (await request.json()) as { orderId?: string; number?: string; lockerId?: string };
    const { admin, order } = await loadOrder(shop, body.orderId ?? "", body.number ?? "");
    const info = await describe(shop, order);
    if (!info) throw new HttpError(400, "order has no parcel locker delivery");
    if (!info.response.editable) throw new HttpError(409, "order can no longer be changed");

    const ref = parseLockerId(body.lockerId ?? null);
    const locker = ref ? await findLocker(ref.source, ref.externalId) : undefined;
    if (!locker || locker.countryCode !== info.country) throw new HttpError(400, "unknown locker");
    if (!info.response.networks.some((n) => n.network === locker.network)) throw new HttpError(400, "locker type not allowed");

    const snapshot: OrderSnapshot = {
      id: order.id,
      attributes: order.customAttributes.map((a) => ({ name: a.key, value: a.value ?? "" })),
    };
    await saveChosenLocker(admin, snapshot, locker, info.settings);
    return cors(Response.json({ ok: true, current: toResult(locker) }));
  } catch (error) {
    if (error instanceof HttpError) return cors(Response.json({ error: error.message }, { status: error.status }));
    console.error("[order-locker] save failed", error);
    return cors(Response.json({ error: "could not save" }, { status: 500 }));
  }
};
