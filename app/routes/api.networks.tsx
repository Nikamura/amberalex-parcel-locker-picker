import type { LoaderFunctionArgs } from "react-router";
import { widgetConfig } from "../lockers/widget-config.server";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=60",
};

// Locker types a shop offers, for the cart picker. The theme embed normally inlines
// this from an app-data metafield; this is the fallback until that is published.
// GET /api/networks?shop=example.myshopify.com
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = new URL(request.url).searchParams.get("shop") ?? "";
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shop)) {
    return new Response(JSON.stringify({ error: "shop required" }), { status: 400, headers });
  }
  return new Response(JSON.stringify(await widgetConfig(shop)), { headers });
};
