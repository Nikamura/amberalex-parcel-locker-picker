import type { LoaderFunctionArgs } from "react-router";
import { searchLockers } from "../lockers/repo.server";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300",
};

// Public locker search used by the cart picker and the thank-you page.
// GET /api/lockers?country=LT&network=omniva,dpd&q=savanoriu&zip=44100&limit=30
// or &near=54.68,25.28 to sort by distance from a point (browser geolocation).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const country = (url.searchParams.get("country") ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    return new Response(JSON.stringify({ error: "country required" }), { status: 400, headers });
  }
  const [lat, lng] = (url.searchParams.get("near") ?? "").split(",").map(Number);
  const near = url.searchParams.has("near") && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const results = await searchLockers({
    country,
    networks: (url.searchParams.get("network") ?? "").split(",").filter(Boolean),
    q: url.searchParams.get("q"),
    zip: url.searchParams.get("zip"),
    near,
    limit: Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 30)),
  });
  return new Response(JSON.stringify({ lockers: results }), { headers });
};
