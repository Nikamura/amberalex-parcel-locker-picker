import type { LoaderFunctionArgs } from "react-router";
import { searchLockers } from "../lockers/repo.server";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300",
};

const CAPITALS: Record<string, { lat: number; lng: number }> = {
  LT: { lat: 54.6872, lng: 25.2797 },
  LV: { lat: 56.9496, lng: 24.1052 },
  EE: { lat: 59.437, lng: 24.7536 },
};

// Public locker search used by the cart picker and the thank-you page.
// GET /api/lockers?country=LT&network=omniva,dpd&q=savanoriu&zip=44100&limit=30
// or &near=54.68,25.28 to sort by distance from a point (browser geolocation).
// With no q/zip/near, results are sorted from the buyer's approximate IP location
// (Cloudflare), or the capital when that is unknown or abroad; `origin` echoes it.
export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const country = (url.searchParams.get("country") ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    return new Response(JSON.stringify({ error: "country required" }), { status: 400, headers });
  }
  const [lat, lng] = (url.searchParams.get("near") ?? "").split(",").map(Number);
  const q = url.searchParams.get("q");
  const zip = url.searchParams.get("zip");
  let near = url.searchParams.has("near") && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  let origin: "ip" | "capital" | null = null;
  if (!near && !q?.trim() && !zip?.trim()) {
    const cf = context.cloudflare?.cf;
    const ipLat = Number(cf?.latitude);
    const ipLng = Number(cf?.longitude);
    if (cf?.country === country && Number.isFinite(ipLat) && Number.isFinite(ipLng)) {
      near = { lat: ipLat, lng: ipLng };
      origin = "ip";
    } else if (CAPITALS[country]) {
      near = CAPITALS[country];
      origin = "capital";
    }
  }
  const results = await searchLockers({
    country,
    networks: (url.searchParams.get("network") ?? "").split(",").filter(Boolean),
    q,
    zip,
    near,
    limit: Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 30)),
  });
  if (origin) {
    // Depends on the caller's location, so never share it between buyers.
    const body = { lockers: results, origin: { ...near, kind: origin } };
    return new Response(JSON.stringify(body), { headers: { ...headers, "Cache-Control": "private, max-age=300" } });
  }
  return new Response(JSON.stringify({ lockers: results }), { headers });
};
