import type { ActionFunctionArgs } from "react-router";
import { verifyShopifyHmac } from "../carrier/hmac";
import { buildRates, cartLockerId, type RateRequest } from "../lockers/rates";
import { findLocker, getShopSettings, networksInCountry } from "../lockers/repo.server";
import { parseLockerId } from "../lockers/service-code";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Shopify's carrier-calculated shipping callback. Must answer fast; an empty
// list simply means no locker options for this address.
export const action = async ({ request }: ActionFunctionArgs) => {
  const raw = await request.text();
  if (!verifyShopifyHmac(raw, request.headers.get("x-shopify-hmac-sha256"), process.env.SHOPIFY_API_SECRET || "")) {
    return json({ error: "unauthorized" }, 401);
  }
  const shop = request.headers.get("x-shopify-shop-domain");
  if (!shop) return json({ rates: [] });

  try {
    const body = JSON.parse(raw) as RateRequest;
    const country = body.rate.destination.country;
    const ref = parseLockerId(cartLockerId(body.rate.items));
    const [{ settings, currency }, networks, chosen] = await Promise.all([
      getShopSettings(shop),
      networksInCountry(country),
      ref ? findLocker(ref.source, ref.externalId) : Promise.resolve(undefined),
    ]);
    return json({ rates: buildRates(body, settings, { networks, chosen }, currency ?? body.rate.currency) });
  } catch (error) {
    console.error("[carrier] rate request failed", error);
    return json({ rates: [] });
  }
};
