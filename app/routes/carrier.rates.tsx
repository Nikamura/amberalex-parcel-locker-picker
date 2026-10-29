import type { ActionFunctionArgs } from "react-router";
import { verifyShopifyHmac } from "../carrier/hmac";
import { buildRates, type RateRequest } from "../lockers/rates";
import { getShopSettings, lockersForCountry } from "../lockers/repo.server";

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
    // TEMP: check that cart line properties reach the rate request.
    const plpProps = body.rate.items.map((i) => Object.keys(i.properties ?? {}).filter((k) => k.startsWith("_plp")));
    if (plpProps.some((k) => k.length)) console.log("[carrier] line properties", JSON.stringify(body.rate.items.map((i) => i.properties)));
    const { settings, currency } = getShopSettings(shop);
    const lockers = lockersForCountry(body.rate.destination.country);
    return json({ rates: buildRates(body, settings, lockers, currency ?? body.rate.currency) });
  } catch (error) {
    console.error("[carrier] rate request failed", error);
    return json({ rates: [] });
  }
};
