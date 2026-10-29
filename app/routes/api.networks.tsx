import type { LoaderFunctionArgs } from "react-router";
import { getShopSettings, networkCounts } from "../lockers/repo.server";
import { networkSettings } from "../lockers/settings";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=60",
};

// Locker types a shop offers, for the cart picker.
// GET /api/networks?shop=example.myshopify.com
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = new URL(request.url).searchParams.get("shop") ?? "";
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shop)) {
    return new Response(JSON.stringify({ error: "shop required" }), { status: 400, headers });
  }
  const { settings, currency } = getShopSettings(shop);
  if (!settings.enabled) return new Response(JSON.stringify({ enabled: false }), { headers });

  const present = new Set(networkCounts(settings.countries).map((c) => c.network));
  const networks = [...present]
    .filter((n) => networkSettings(settings, n).enabled)
    .sort()
    .map((network) => {
      const { label, price } = networkSettings(settings, network);
      return { network, label, price };
    });
  return new Response(
    JSON.stringify({ enabled: true, testMode: Boolean(settings.testMarker), countries: settings.countries, currency, networks }),
    { headers },
  );
};
